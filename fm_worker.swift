import Foundation
import FoundationModels

func jsonString(_ value: Any) throws -> String {
    if let string = value as? String { return string }
    return String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
}

func emit(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func options(from question: [String: Any]) throws -> [(letter: String, text: String)] {
    guard let items = question["options"] as? [[String: Any]], !items.isEmpty else {
        throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Each question needs non-empty A-Z options"])
    }
    return try items.map { item in
        guard let letter = item["letter"] as? String, let text = item["text"] as? String, !letter.isEmpty else {
            throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Each option needs letter and text"])
        }
        return (letter, text)
    }
}

func userPrompt(questions: [String: [String: Any]], names: [String]) throws -> String {
    var lines: [String] = []
    for name in names {
        guard let question = questions[name] else { continue }
        let instructions = question["instructions"] as? String ?? ""
        if names.count > 1 { lines.append("Question \(name):") }
        if !instructions.isEmpty { lines.append(instructions); lines.append("") }
        lines.append("Options:")
        for option in try options(from: question) { lines.append("\(option.letter). \(option.text)") }
        lines.append("")
        lines.append("Answer:")
        lines.append("")
    }
    return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

func decide(_ request: [String: Any], model: SystemLanguageModel) async throws -> [String: String] {
    guard let questionData = request["questions"] as? [String: [String: Any]], !questionData.isEmpty else {
        throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected non-empty questions"])
    }
    let names = questionData.keys.sorted()
    var properties: [DynamicGenerationSchema.Property] = []
    for name in names {
        let letters = try options(from: questionData[name] ?? [:]).map(\.letter)
        properties.append(.init(name: name, description: "The letter of the chosen option.", schema: DynamicGenerationSchema(type: String.self, guides: [.anyOf(letters)])))
    }
    let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "DecisionFrame", description: "One option letter per question.", properties: properties), dependencies: [])
    // Fresh transcript per request preserves the HTTP API's stateless semantics.
    // Internal A/B/C prompt; HTTP criteria keys are mapped back by the Node layer.
    let session = LanguageModelSession(model: model, instructions: try jsonString(request["state"] ?? ""))
    let response = try await session.respond(to: try userPrompt(questions: questionData, names: names), schema: schema, options: GenerationOptions(sampling: .greedy))
    return try Dictionary(uniqueKeysWithValues: names.map { name in (name, try response.content.value(forProperty: name) as String) })
}

@main
struct FMWorker {
    static func main() async {
        let model = SystemLanguageModel()
        guard model.isAvailable else { emit(["id": "startup", "error": "Foundation Models unavailable"]); return }
        LanguageModelSession(model: model, instructions: "{}").prewarm()
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = request["id"] as? String else {
                emit(["id": "unknown", "error": "Invalid JSONL request"]); continue
            }
            let started = ContinuousClock.now
            do {
                let choices = try await decide(request, model: model)
                let duration = started.duration(to: .now).components
                let elapsed = Double(duration.seconds) * 1_000 + Double(duration.attoseconds) / 1e15
                emit(["id": id, "choices": choices, "worker_ms": elapsed])
            }
            catch { emit(["id": id, "error": error.localizedDescription]) }
        }
    }
}
