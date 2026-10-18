// A scheduled meal cooked as one sequence: every dish's steps (and the
// schedule's notes and combined prep steps) in schedule order, walked with
// Next and Back whichever dish each belongs to. The same rules as
// apps/web/lib/meal-sequence.ts — change one, change both.

import Foundation

public enum MealSequence {
    public typealias Cue = APIClient.MealClock.Cue
    public typealias Step = APIClient.MealClock.CueStep

    /// Two cues this close together count as "also now" for each other.
    public static let alsoNowMs = 2.0 * 60_000

    /// The recipe steps a cue does: its own, or a combined prep cue's (or the
    /// serve cue's: each dish's last step when that's only serving it).
    public static func steps(of cue: Cue) -> [Step] {
        if let covers = cue.covers, !covers.isEmpty { return covers }
        if let id = cue.recipeId, let step = cue.stepIndex { return [Step(recipeId: id, stepIndex: step)] }
        return []
    }

    /// The dish whose page a cue is shown on: its own, the first a combined
    /// step covers, else (a note, serving) the nearest dish before it, then after.
    public static func anchor(_ cues: [Cue], at index: Int) -> String? {
        func own(_ c: Cue) -> String? { c.recipeId ?? c.covers?.first?.recipeId }
        guard !cues.isEmpty else { return nil }
        let i = min(max(index, 0), cues.count - 1)
        for j in stride(from: i, through: 0, by: -1) { if let id = own(cues[j]) { return id } }
        for j in (i + 1)..<max(cues.count, i + 1) { if let id = own(cues[j]) { return id } }
        return nil
    }

    /// Where a dish's step sits in the sequence.
    public static func index(ofStep step: Int, recipeId: String, in cues: [Cue]) -> Int? {
        cues.firstIndex { steps(of: $0).contains { $0.recipeId == recipeId && $0.stepIndex == step } }
    }

    /// The place in the sequence: the stored cue, else the start.
    public static func index(of position: String?, in cues: [Cue]) -> Int {
        position.flatMap { id in cues.firstIndex { $0.id == id } } ?? 0
    }

    /// The step the clock says you're on: the last cue due by `now` (ms), never serving early.
    public static func position(at now: Double, in cues: [Cue]) -> Cue? {
        cues.last { $0.at <= now && $0.id != "serve" } ?? cues.first
    }

    /// Other steps due at the same time as the one at `index` — two dishes at once.
    public static func alsoNow(_ cues: [Cue], at index: Int) -> [(cue: Cue, index: Int)] {
        guard cues.indices.contains(index) else { return [] }
        let here = cues[index]
        return cues.enumerated()
            .filter { $0.offset != index && $0.element.id != "serve" && abs($0.element.at - here.at) <= alsoNowMs }
            .map { ($0.element, $0.offset) }
    }

    public enum Tone: Sendable { case ahead, now, late }

    /// "in 25 min", "Now", "10 min late" — how a step's time stands against the clock (ms).
    public static func due(_ at: Double, now: Double) -> (text: String, tone: Tone) {
        let mins = Int(((at - now) / 60_000).rounded())
        if mins > 0 { return ("in \(span(mins))", .ahead) }
        if mins >= -5 { return ("Now", .now) }
        return ("\(span(-mins)) late", .late)
    }

    static func span(_ m: Int) -> String {
        let h = m / 60
        return h > 0 ? "\(h) h" + (m % 60 > 0 ? " \(m % 60) min" : "") : "\(m) min"
    }
}
