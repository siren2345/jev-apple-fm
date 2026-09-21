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

func envInt(_ name: String, _ fallback: Int) -> Int {
    guard let raw = ProcessInfo.processInfo.environment[name], let value = Int(raw), value > 0 else { return fallback }
    return value
}

let roleInstructions = """
You are a multiple-choice decision function.
Pick exactly one letter from Options.
Use only STATE in the user message.
If STATE does not determine the answer, pick the uncertainty option.
Do not use world knowledge or stereotypes.
"""

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

func userPrompt(state: Any, questions: [String: [String: Any]], names: [String]) throws -> String {
    var lines: [String] = ["STATE:", try jsonString(state), ""]
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

func letter(from content: GeneratedContent, allowed: [String]) throws -> String {
    if let value = try? content.value(String.self), allowed.contains(value) { return value }
    if case .string(let value) = content.kind, allowed.contains(value) { return value }
    let trimmed = content.jsonString.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    if allowed.contains(trimmed) { return trimmed }
    throw NSError(domain: "fm-worker", code: 1, userInfo: [NSLocalizedDescriptionKey: "native decision returned an invalid option"])
}

func generate(session: LanguageModelSession, prompt: String, questions: [String: [String: Any]], names: [String]) async throws -> [String: String] {
    if names.count == 1 {
        let name = names[0]
        let letters = try options(from: questions[name] ?? [:]).map(\.letter)
        let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "Answer", description: "The letter of the chosen option.", anyOf: letters), dependencies: [])
        let response = try await session.respond(to: prompt, schema: schema, includeSchemaInPrompt: false, options: GenerationOptions(sampling: .greedy))
        return [name: try letter(from: response.content, allowed: letters)]
    }
    var properties: [DynamicGenerationSchema.Property] = []
    for name in names {
        let letters = try options(from: questions[name] ?? [:]).map(\.letter)
        properties.append(.init(name: name, description: "The letter of the chosen option.", schema: DynamicGenerationSchema(type: String.self, guides: [.anyOf(letters)])))
    }
    let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "DecisionFrame", description: "One option letter per question.", properties: properties), dependencies: [])
    let response = try await session.respond(to: prompt, schema: schema, options: GenerationOptions(sampling: .greedy))
    return try Dictionary(uniqueKeysWithValues: names.map { name in (name, try response.content.value(forProperty: name) as String) })
}

@main
struct FMWorker {
    static func main() async {
        let model = SystemLanguageModel()
        guard model.isAvailable else { emit(["id": "startup", "error": "Foundation Models unavailable"]); return }
        let maxTurns = envInt("JEV_SESSION_TURNS", 8)
        var session: LanguageModelSession?
        var turns = 0
        func freshSession() -> LanguageModelSession {
            let next = LanguageModelSession(model: model, instructions: roleInstructions)
            next.prewarm()
            session = next
            turns = 0
            return next
        }
        _ = freshSession()
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = request["id"] as? String else {
                emit(["id": "unknown", "error": "Invalid JSONL request"]); continue
            }
            guard let questionData = request["questions"] as? [String: [String: Any]], !questionData.isEmpty else {
                emit(["id": id, "error": "Expected non-empty questions"]); continue
            }
            let names = questionData.keys.sorted()
            let started = ContinuousClock.now
            do {
                let prompt = try userPrompt(state: request["state"] ?? "", questions: questionData, names: names)
                if turns >= maxTurns { _ = freshSession() }
                let active = session ?? freshSession()
                let choices: [String: String]
                do {
                    choices = try await generate(session: active, prompt: prompt, questions: questionData, names: names)
                } catch {
                    let retry = freshSession()
                    choices = try await generate(session: retry, prompt: prompt, questions: questionData, names: names)
                }
                turns += 1
                let duration = started.duration(to: .now).components
                let elapsed = Double(duration.seconds) * 1_000 + Double(duration.attoseconds) / 1e15
                emit(["id": id, "choices": choices, "worker_ms": elapsed])
            }
            catch { session = nil; turns = 0; emit(["id": id, "error": error.localizedDescription]) }
        }
    }
}
