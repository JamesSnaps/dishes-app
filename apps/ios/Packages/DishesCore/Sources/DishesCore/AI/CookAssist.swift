// "Ask about this step" on the device (TODO_MOBILE.md, D3): the cook-assist
// answer from Apple's on-device model, streamed as it's written, with the
// server's prompt (Prompts.cookAssist). The router sends it to the server
// when the device can't answer or the answer fails CookAssistChecks.
//
//   for try await event in CookAssist.ask(context, serverReady: true, server: { CookAssist.onServer(context, api: api) }) { … }

import Foundation
import FoundationModels

public enum CookAssist {
    /// The answer, on the device first and the server when it has to be.
    /// `serverReady`: the household has a key (AIContext.configured), so a
    /// substitution can go straight there.
    public static func ask(
        _ context: APIClient.CookAssistContext,
        serverReady: Bool,
        server: @escaping @Sendable () -> AsyncThrowingStream<String, Error>
    ) -> AsyncThrowingStream<AIStreamEvent, Error> {
        let question = context.messages.last { $0.role == "user" }?.content ?? ""
        let substitution = serverReady && isSubstitution(question)
        return AIRouter.stream(.cookAssist,
                               onDevice: { onDevice(context) },
                               check: CookAssistChecks.problems,
                               fallback: server,
                               skipDevice: substitution ? "Substitutions go to the household’s AI" : nil)
    }

    /// "What can I use instead?", "I'm out of baking soda", "no red wine":
    /// the evaluation's on-device answers to these were confidently wrong
    /// ("use 480 ml red wine + red wine concentrate"), where questions about
    /// the recipe itself — timings, doneness, what's next — were right.
    public static func isSubstitution(_ question: String) -> Bool {
        question.lowercased().contains(
            /\b(instead|substitut\w*|swap\w*|replace\w*|alternative\w*|in place of|(i'm|i am|we're|we are|run|ran) out of|run out|ran out|(have|got|i've) no|don't have|haven't got)\b/)
    }

    /// The on-device model's answer, chunk by chunk.
    public static func onDevice(_ context: APIClient.CookAssistContext) -> AsyncThrowingStream<String, Error> {
        guard #available(iOS 27, macOS 27, *) else {
            return AsyncThrowingStream { $0.finish(throwing: DeviceAIUnavailable()) }
        }
        return answer(context, model: SystemLanguageModel.default)
    }

    /// The household's AI's answer, through the same session code
    /// (DishesServerModel, D5) — the server's prompt, so the same answer the
    /// web's cooking mode gets.
    public static func onServer(_ context: APIClient.CookAssistContext, api: APIClient) -> AsyncThrowingStream<String, Error> {
        guard #available(iOS 27, macOS 27, *) else { return api.cookAssist(context) }
        return answer(context, model: DishesServerModel(api: api))
    }

    @available(iOS 27, macOS 27, *)
    static func answer(_ context: APIClient.CookAssistContext, model: some LanguageModel) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let session = LanguageModelSession(model: model, instructions: Prompts.cookAssist(context))
                    var sent = ""
                    for try await snapshot in session.streamResponse(to: question(context.messages)) {
                        let text = snapshot.content
                        if text.hasPrefix(sent), text.count > sent.count { continuation.yield(String(text.dropFirst(sent.count))) }
                        sent = text
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The conversation as one prompt: the question, after what was said
    /// before it. The server sends the turns as chat messages; for one short
    /// session on the device, a single prompt does the same.
    static func question(_ messages: [APIClient.AssistMessage]) -> String {
        guard let at = messages.lastIndex(where: { $0.role == "user" }) else { return "" }
        let (last, earlier) = (messages[at], messages[..<at])
        guard !earlier.isEmpty else { return last.content }
        let said = earlier.map { "\($0.role == "user" ? "Cook" : "You"): \($0.content)" }.joined(separator: "\n")
        return "Earlier in this conversation:\n\(said)\n\nTheir question now: \(last.content)"
    }
}

/// What a cook-assist answer from the device must get right before it's kept.
public enum CookAssistChecks {
    /// Most answers are 2–4 sentences; past this it isn't the quick answer asked for.
    static let maxWords = 140

    public static func problems(_ answer: String) -> [String] {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return ["no answer"] }
        var problems: [String] = []
        let lower = text.lowercased()
        if lower.contains(/(check|refer to|look at|consult) the recipe/) { problems.append("tells them to check the recipe") }
        if lower.contains(/^(i'm sorry|i am sorry|sorry, i|i can't|i cannot|as an ai)/) { problems.append("declined") }
        let words = text.split(whereSeparator: \.isWhitespace).count
        if words > maxWords { problems.append("\(words) words, more than \(maxWords)") }
        return problems
    }
}
