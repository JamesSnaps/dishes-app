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

    public var firstTry: AIEngine {
        switch self {
        case .ingredientLine: .device
        case .scanRecipe: .device
        }
    }

    /// Where it goes when the device doesn't answer.
    public var fallback: AIEngine {
        switch self {
        case .ingredientLine: .rules
        case .scanRecipe: .server
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
}
