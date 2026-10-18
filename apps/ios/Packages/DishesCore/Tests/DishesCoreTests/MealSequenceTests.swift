import Testing
@testable import DishesCore

struct MealSequenceTests {
    typealias Cue = APIClient.MealClock.Cue
    let cues: [Cue] = [
        Cue(id: "lamb:0", at: 0, recipeId: "lamb", stepIndex: 0, dish: "Lamb", text: "Season"),
        Cue(id: "combo:0", at: 60_000, recipeId: nil, stepIndex: nil, dish: nil, text: "Chop 3 onions",
            covers: [.init(recipeId: "gravy", stepIndex: 0), .init(recipeId: "stuffing", stepIndex: 1)]),
        Cue(id: "note:0", at: 600_000, recipeId: nil, stepIndex: nil, dish: nil, text: "Oven up to 200°C"),
        Cue(id: "spuds:0", at: 600_000, recipeId: "spuds", stepIndex: 0, dish: "Potatoes", text: "Potatoes in"),
        Cue(id: "serve", at: 3_600_000, recipeId: nil, stepIndex: nil, dish: nil, text: "Serve"),
    ]

    @Test func anchorsNotesAndCombosOnADish() {
        #expect(MealSequence.anchor(cues, at: 1) == "gravy")
        #expect(MealSequence.anchor(cues, at: 2) == "gravy")
        #expect(MealSequence.anchor(cues, at: 4) == "spuds")
    }

    @Test func findsCoveredSteps() {
        #expect(MealSequence.index(ofStep: 1, recipeId: "stuffing", in: cues) == 1)
        #expect(MealSequence.index(ofStep: 0, recipeId: "spuds", in: cues) == 3)
        #expect(MealSequence.index(ofStep: 5, recipeId: "spuds", in: cues) == nil)
    }

    @Test func alsoNowIsTheSameTime() {
        #expect(MealSequence.alsoNow(cues, at: 2).map(\.index) == [3])
        #expect(MealSequence.alsoNow(cues, at: 0).map(\.index) == [1])
    }

    @Test func positionNeverServesEarly() {
        #expect(MealSequence.position(at: 700_000, in: cues)?.id == "spuds:0")
        #expect(MealSequence.position(at: 9_999_999, in: cues)?.id == "spuds:0")
    }

    @Test func dueLabels() {
        #expect(MealSequence.due(25 * 60_000, now: 0).text == "in 25 min")
        #expect(MealSequence.due(0, now: 2 * 60_000).text == "Now")
        #expect(MealSequence.due(0, now: 70 * 60_000).text == "1 h 10 min late")
    }
}

struct KeptStartTests {
    typealias Cue = APIClient.MealClock.Cue
    let min = 60_000.0
    // Lamb: season 08:20, slow-cook 08:30 (8 h), gravy 16:30, carve 16:55; serve 17:00.
    var cues: [Cue] {
        [Cue(id: "l0", at: 500 * min, recipeId: "lamb", stepIndex: 0, dish: "Lamb", text: "Season"),
         Cue(id: "l1", at: 510 * min, recipeId: "lamb", stepIndex: 1, dish: "Lamb", text: "Slow cook"),
         Cue(id: "c0", at: 960 * min, recipeId: "cauli", stepIndex: 0, dish: "Cauli", text: "Oven on"),
         Cue(id: "l2", at: 990 * min, recipeId: "lamb", stepIndex: 2, dish: "Lamb", text: "Gravy"),
         Cue(id: "l3", at: 1015 * min, recipeId: "lamb", stepIndex: 3, dish: "Lamb", text: "Carve")]
    }

    @Test func earlyStartMovesOnlyTheStepsBeforeTheLongStretch() {
        let out = MealStart.kept(cues, by: -40, recipeId: "lamb", serveAt: 1020 * min)
        let at = Dictionary(uniqueKeysWithValues: out.map { ($0.id, $0.at / min) })
        #expect(at["l0"] == 460)
        #expect(at["l1"] == 470)
        #expect(at["l2"] == 990)   // still anchored to serving
        #expect(at["l3"] == 1015)
        #expect(at["c0"] == 960)   // other dishes untouched
    }

    @Test func lateStartCantSqueezeBelowNothing() {
        let out = MealStart.kept(cues, by: 600, recipeId: "lamb", serveAt: 1020 * min)
        let at = Dictionary(uniqueKeysWithValues: out.map { ($0.id, $0.at / min) })
        #expect(at["l1"] == 990)
        #expect(at["l3"] == 1015)
    }
}
