// "When did you start?" for a scheduled meal in cooking mode: the same rules
// as apps/web/lib/meal-start.ts — change one, change both.
//
// People often start a meal before opening the app, so cooking mode asks once
// as the cook begins and keeps the schedule in step with the answer, never by
// watching which step is on screen (cooks read ahead).

import Foundation

public enum MealStart {
    public typealias Cue = APIClient.MealClock.Cue

    /// A start this close to the schedule counts as on time: nothing to move.
    public static let onTimeMinutes = 5
    /// Within this of the due time, the picker suggests the due time, not now.
    static let snapToDueMinutes = 10.0

    /// The schedule's first job: what it says to start, and when.
    public static func firstCue(_ cues: [Cue]) -> Cue? {
        cues.first { $0.id != "serve" && $0.recipeId != nil }
    }

    /// A date rounded down to the minute — times here are whole minutes.
    public static func toMinute(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 / 60).rounded(.down) * 60)
    }

    /// What "I started at…" suggests: now, or the due time if that's close.
    public static func suggestedStart(now: Date, due: Date) -> Date {
        abs(now.timeIntervalSince(due)) <= snapToDueMinutes * 60 ? due : toMinute(now)
    }

    /// Whole minutes the start is off the schedule: negative = early.
    public static func delta(startedAt: Date, due: Date) -> Int {
        Int((toMinute(startedAt).timeIntervalSince(toMinute(due)) / 60).rounded())
    }

    /// The step the schedule says the dish should be on `elapsed` seconds
    /// after it started: the last of its cues that has come round since the first.
    public static func step(after elapsed: TimeInterval, recipeId: String, in cues: [Cue]) -> Int {
        let own = cues.filter { $0.recipeId == recipeId && $0.stepIndex != nil }
        guard let start = own.first else { return 0 }
        var step = start.stepIndex ?? 0
        for cue in own where (cue.at - start.at) / 1000 <= elapsed { step = max(step, cue.stepIndex ?? 0) }
        return step
    }

    /// "Started early (or late), keep dinner at the same time" for one dish:
    /// the steps already under way move with the start, the ones that finish
    /// the dish stay anchored to serving. The dish's longest stretch (the
    /// slow-cooker's hours, the roast in the oven) absorbs the difference —
    /// its biggest gap from one cue to the next, the last to `serveAt`; that
    /// cue and every one before it move. Same as keepShift in meal-start.ts.
    public static func kept(_ cues: [Cue], by minutes: Int, recipeId: String, serveAt: Double?) -> [Cue] {
        guard minutes != 0 else { return cues }
        let own = cues.filter { $0.recipeId == recipeId }.sorted { $0.at < $1.at }
        guard !own.isEmpty else { return cues }
        var split = own.count - 1
        var widest = -1.0
        for (i, cue) in own.enumerated() {
            let next = i + 1 < own.count ? own[i + 1].at : (serveAt ?? cue.at)
            if next - cue.at > widest { widest = next - cue.at; split = i }
        }
        // Starting late can't squeeze the long stretch below nothing.
        let room = max(0, widest) / 60_000
        let move = minutes > 0 ? min(Double(minutes), room) : Double(minutes)
        let moved = Set(own.prefix(split + 1).map(\.id))
        return cues.map { cue in
            guard moved.contains(cue.id) else { return cue }
            var c = cue
            c.at += move * 60_000
            return c
        }
        .enumerated()
        .sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }
        .map(\.element)
    }

    /// The cues moved by `minutes` — all of them, or one dish's — in time order.
    public static func shifted(_ cues: [Cue], by minutes: Int, recipeId: String? = nil) -> [Cue] {
        guard minutes != 0 else { return cues }
        return cues.map { cue in
            guard recipeId == nil || cue.recipeId == recipeId else { return cue }
            var moved = cue
            moved.at += Double(minutes) * 60_000
            return moved
        }
        .enumerated()
        .sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }
        .map(\.element)
    }
}
