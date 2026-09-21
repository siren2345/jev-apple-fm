import Foundation
import FoundationModels

func jsonString(_ value: Any) throws -> String {
    if let string = value as? String { return string }
    return String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
}

func display(_ value: Any?) -> String {
    guard let value else { return "" }
    if let string = value as? String { return string }
    return (try? jsonString(value)) ?? ""
}

func emit(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func optionKeys(_ criteria: [String: Any]) -> [String] {
    criteria.keys.sorted()
}

func userPrompt(questions: [String: [String: Any]], names: [String]) -> String {
    var lines: [String] = ["QUESTIONS:"]
    for name in names {
        guard let question = questions[name], let criteria = question["criteria"] as? [String: Any] else { continue }
        lines.append("- \(name): \(display(question["instructions"]))")
        lines.append("  Allowed identifiers:")
        for key in optionKeys(criteria) { lines.append("  - \(key): \(display(criteria[key]))") }
    }
    lines.append("")
    lines.append("Compare the options against the state in the system message. Then pick exactly one allowed identifier per question. Option order is not a ranking. Axes are independent unless a question says otherwise.")
    return lines.joined(separator: "\n")
}

func decide(_ request: [String: Any], model: SystemLanguageModel) async throws -> [String: String] {
    guard let questionData = request["questions"] as? [String: [String: Any]], !questionData.isEmpty else {
        throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected non-empty questions"])
    }
    let names = questionData.keys.sorted()
    var properties: [DynamicGenerationSchema.Property] = [
        .init(name: "rationale", description: "Short comparison of the options against the state, then the intended picks.", schema: DynamicGenerationSchema(type: String.self))
    ]
    for name in names {
        guard let question = questionData[name], let criteria = question["criteria"] as? [String: Any], !criteria.isEmpty else {
            throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Each question needs non-empty Choice criteria"])
        }
        let keys = optionKeys(criteria)
        let optionText = keys.map { key in "\(key) = \(display(criteria[key]))" }.joined(separator: "; ")
        properties.append(.init(name: name, description: "\(display(question["instructions"])) Pick one identifier. Options: \(optionText)", schema: DynamicGenerationSchema(type: String.self, guides: [.anyOf(keys)])))
    }
    let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "DecisionFrame", description: "Compare options, then choose one allowed identifier per question.", properties: properties), dependencies: [])
    // Fresh transcript per request preserves the HTTP API's stateless semantics.
    // Match jev-single-decode's chat split: system holds state, user holds the questions.
    let session = LanguageModelSession(model: model, instructions: try jsonString(request["state"] ?? ""))
    let response = try await session.respond(to: userPrompt(questions: questionData, names: names), schema: schema, options: GenerationOptions(sampling: .greedy))
    return try Dictionary(uniqueKeysWithValues: names.map { name in (name, try response.content.value(forProperty: name) as String) })
}

@main
struct FMWorker {
    static func main() async {
        let model = SystemLanguageModel()
        guard model.isAvailable else { emit(["id": "startup", "error": "Foundation Models unavailable"]); return }
        // Prewarm model resources once; individual sessions remain fresh to avoid transcript leakage.
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
