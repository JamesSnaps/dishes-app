// "When did you start?" rules — the same as apps/web/lib/meal-start.ts.

import Foundation
import Testing
@testable import DishesCore

@Suite struct MealStartTests {
    typealias Cue = APIClient.MealClock.Cue
    let base = Date(timeIntervalSince1970: 1_800_000_000 - 1_800_000_000.truncatingRemainder(dividingBy: 60))

    func cue(_ id: String, _ minutes: Double, _ recipe: String?, _ step: Int?) -> Cue {
        Cue(id: id, at: (base.timeIntervalSince1970 + minutes * 60) * 1000, recipeId: recipe, stepIndex: step, dish: nil, text: id)
    }

    var cues: [Cue] {
        [cue("lamb:0", 0, "lamb", 0), cue("lamb:1", 8, "lamb", 1), cue("veg:0", 10, "veg", 0),
         cue("lamb:2", 13, "lamb", 2), cue("serve", 30, nil, nil)]
    }

    @Test func firstCueIsTheFirstDishStep() {
        #expect(MealStart.firstCue(cues)?.id == "lamb:0")
        #expect(MealStart.firstCue([cue("serve", 0, nil, nil)]) == nil)
    }

    @Test func suggestsTheDueTimeWhenClose() {
        #expect(MealStart.suggestedStart(now: base.addingTimeInterval(7 * 60), due: base) == base)
        let later = base.addingTimeInterval(25 * 60 + 30)
        #expect(MealStart.suggestedStart(now: later, due: base) == base.addingTimeInterval(25 * 60))
    }

    @Test func deltaInWholeMinutes() {
        #expect(MealStart.delta(startedAt: base.addingTimeInterval(-20 * 60), due: base) == -20)
        #expect(MealStart.delta(startedAt: base.addingTimeInterval(30 * 60 + 40), due: base) == 30)
    }

    @Test func stepByElapsedTime() {
        #expect(MealStart.step(after: 0, recipeId: "lamb", in: cues) == 0)
        #expect(MealStart.step(after: 9 * 60, recipeId: "lamb", in: cues) == 1)
        #expect(MealStart.step(after: 60 * 60, recipeId: "lamb", in: cues) == 2)
        #expect(MealStart.step(after: 60 * 60, recipeId: "none", in: cues) == 0)
    }

    @Test func shiftingOneDishKeepsTimeOrder() {
        let kept = MealStart.shifted(cues, by: 12, recipeId: "veg")
        #expect(kept.map(\.id) == ["lamb:0", "lamb:1", "lamb:2", "veg:0", "serve"])
        let moved = MealStart.shifted(cues, by: -20)
        #expect(moved.first?.at == cues.first!.at - 20 * 60_000)
        #expect(moved.last?.id == "serve")
    }
}
