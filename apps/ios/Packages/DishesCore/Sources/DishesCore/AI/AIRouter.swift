// Where each AI job runs (TODO_MOBILE.md, Phase D2): one place that decides,
// so features don't each decide for themselves.
//
//   1. On the device — Apple's on-device model (iOS 27), when Apple
//      Intelligence is there and the job's evaluation has passed
//   2. The server — the household's own AI key, the way the app worked before
//
// No Private Cloud Compute (James, 20 Oct 2026). The device's answer is used
// only if it passes the job's checks; otherwise, or if the model throws
// (context too small, guardrails, a refusal, a timeout), the job goes to the
// server once, with no prompt to the person. The answer says where it ran.
//
//   let run = try await AIRouter.run(.scanRecipe, onDevice: { … }, check: { … }, fallback: { … })
//   run.engine   // .device or .server, for the "Read on this iPad" label

import Foundation
import os

public enum AIEngine: String, Sendable, Codable {
    /// Apple's on-device model.
    case device
    /// The household's AI key, on the server.
    case server
    /// The app's own rules, no AI (the ingredient-line job's fallback).
    case rules
}

/// The jobs the router knows, and where each starts. A job starts on the
/// device only once its evaluation has passed (DishesCoreTests/Evaluations);
/// change `firstTry` with the evaluation's result, not by hand.
public enum AITask: String, CaseIterable, Sendable {
    /// "2 tbsp finely chopped parsley" → amount, unit, name, preparation. The
    /// "server" here is the rules: the server's paste import uses the same ones.
    case ingredientLine
    /// A photo of a cookbook page or recipe card → a recipe to review.
    case scanRecipe
    /// Which collection a new recipe belongs in, from the cached names.
    case fileRecipe
    /// Shared or pasted text → a recipe.
    case readText
    /// "Ask about this step" in cooking mode: a short answer, streamed.
    case cookAssist
    /// "Improve with AI": a recipe changed as asked (not heart-healthy, which
    /// rests on nutrition targets the server checks and revises against).
    case improveRecipe
    /// The concierge's five ideas (writing the chosen one stays on the server).
    case recipeIdeas
    /// A draft week from the library on the device (adding it stays on the server).
    case mealPlan
    /// Which aisle a shopping item goes in, for a name the rules don't know.
    /// The "server" here is the rules too: nothing is sent anywhere for this.
    case shoppingAisle

    public var firstTry: AIEngine {
        switch self {
        case .ingredientLine: .device
        case .scanRecipe: .device
        case .fileRecipe: .device
        case .readText: .device
        case .cookAssist: .device
        // 0.776 and every check passed (20 Oct), but the edits read badly —
        // the bananas swapped for avocado to leave out walnuts — and the
        // checks that now catch those fail 6 of the 13. The server's model
        // rewrites the whole recipe and does it well.
        case .improveRecipe: .server
        // 0.64–0.68 (20 Oct): the request got lost under the household's
        // preferences ("a risotto" → five spicy dishes), and the guardrails
        // stopped a child's breakfast. Restating the request made it worse.
        case .recipeIdeas: .server
        case .mealPlan: .device
        // Not evaluated yet (needs macOS 27): it only sees names the rules
        // don't know, and can only answer one of the aisles or "not sure".
        case .shoppingAisle: .device
        }
    }

    /// Where it goes when the device doesn't answer.
    public var fallback: AIEngine {
        switch self {
        case .ingredientLine, .shoppingAisle: .rules
        case .scanRecipe, .fileRecipe, .readText, .cookAssist, .improveRecipe, .recipeIdeas, .mealPlan: .server
        }
    }
}

/// An answer and where it came from.
public struct AIRun<Value: Sendable>: Sendable {
    public var value: Value
    public var engine: AIEngine
    /// Why the device didn't answer, when it was tried and the fallback did.
    public var fallbackReason: String?

    public init(value: Value, engine: AIEngine, fallbackReason: String? = nil) {
        self.value = value
        self.engine = engine
        self.fallbackReason = fallbackReason
    }
}

public enum AIRouter {
    static let log = Logger(subsystem: "uk.collco.dishes", category: "ai")

    /// Runs `task` where it should run. `check` lists what's wrong with a
    /// device answer (empty: it's fine); `fallback` is the task's fallback
    /// engine (the server, or the rules). Runs on the caller's actor, so a
    /// screen can pass closures that touch its state.
    public static func run<Value: Sendable>(
        _ task: AITask,
        isolation: isolated (any Actor)? = #isolation,
        onDevice: () async throws -> Value,
        check: (Value) -> [String] = { _ in [] },
        fallback: () async throws -> Value
    ) async throws -> AIRun<Value> {
        var reason: String?
        if task.firstTry == .device {
            if let unavailable = DeviceAI.unavailableReason {
                reason = unavailable
            } else {
                do {
                    let value = try await onDevice()
                    let problems = check(value)
                    if problems.isEmpty {
                        log.info("\(task.rawValue, privacy: .public): on the device")
                        return AIRun(value: value, engine: .device)
                    }
                    reason = "The answer didn’t pass its checks: " + problems.joined(separator: "; ")
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    reason = DeviceAI.describe(error)
                }
            }
            log.info("\(task.rawValue, privacy: .public): to \(task.fallback.rawValue, privacy: .public) — \(reason ?? "", privacy: .public)")
        }
        return AIRun(value: try await fallback(), engine: task.fallback, fallbackReason: reason)
    }

    /// `run` for an answer that streams. The device's answer shows as it's
    /// written; if the model throws partway or the whole answer fails `check`,
    /// `.restart` says to clear what's shown and the server's answer follows.
    /// `skipDevice`: why this one goes straight to the fallback.
    public static func stream(
        _ task: AITask,
        onDevice: @escaping @Sendable () -> AsyncThrowingStream<String, Error>,
        check: @escaping @Sendable (String) -> [String] = { _ in [] },
        fallback: @escaping @Sendable () -> AsyncThrowingStream<String, Error>,
        skipDevice: String? = nil
    ) -> AsyncThrowingStream<AIStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let work = Task {
                do {
                    var reason: String?
                    if task.firstTry == .device {
                        if let skipDevice {
                            reason = skipDevice
                        } else if let unavailable = DeviceAI.unavailableReason {
                            reason = unavailable
                        } else {
                            continuation.yield(.engine(.device))
                            var answer = ""
                            do {
                                for try await chunk in onDevice() {
                                    answer += chunk
                                    continuation.yield(.text(chunk))
                                }
                                let problems = check(answer)
                                if problems.isEmpty {
                                    log.info("\(task.rawValue, privacy: .public): on the device")
                                    continuation.finish()
                                    return
                                }
                                reason = "The answer didn’t pass its checks: " + problems.joined(separator: "; ")
                            } catch {
                                if Task.isCancelled || error is CancellationError { throw CancellationError() }
                                reason = DeviceAI.describe(error)
                            }
                            if !answer.isEmpty { continuation.yield(.restart) }
                        }
                        log.info("\(task.rawValue, privacy: .public): to \(task.fallback.rawValue, privacy: .public) — \(reason ?? "", privacy: .public)")
                    }
                    continuation.yield(.engine(task.fallback, fallbackReason: reason))
                    for try await chunk in fallback() { continuation.yield(.text(chunk)) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }
}

/// What `AIRouter.stream` sends: where the answer is coming from, the answer
/// a piece at a time, and `.restart` when the device's is being replaced.
public enum AIStreamEvent: Sendable, Equatable {
    case engine(AIEngine, fallbackReason: String? = nil)
    case text(String)
    case restart
}
