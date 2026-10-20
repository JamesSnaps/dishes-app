// Applying the on-device model's edits to a recipe (RecipeTweaker.apply):
// what isn't edited stays exactly as it was.

import Foundation
import Testing
@testable import DishesCore

@Suite struct RecipeTweakerTests {
    let bolognese = GeneratedRecipe(
        title: "Classic Beef Bolognese", servings: "8",
        ingredients: [.init(ingredientName: "olive oil", amount: "45", unit: "ml"),
                      .init(ingredientName: "beef mince", amount: "500", unit: "g"),
                      .init(ingredientName: "pork mince", amount: "500", unit: "g"),
                      .init(ingredientName: "bay leaves", amount: "2", groupLabel: "")],
        steps: [.init(instruction: "Soften the vegetables."),
                .init(instruction: "Brown the beef and pork mince.", durationMinutes: "12", timerLabel: "Brown"),
                .init(instruction: "Simmer for 2–3 hours.")])

    @Test func changesRemovesAndAddsInPlace() {
        let tweak = RecipeTweaker.apply(.init(
            summary: "I've swapped the meat for lentils and mushrooms.",
            title: "Lentil Bolognese",
            ingredients: [.init(.change, 2, quantity: "400g", name: "green lentils", preparation: "rinsed"),
                          .init(.remove, 3),
                          .init(.add, 2, quantity: "250g", name: "chestnut mushrooms", preparation: "chopped")],
            steps: [.init(.change, 2, instruction: "Brown the mushrooms, then add the lentils.")]), to: bolognese)
        #expect(tweak.recipe.title == "Lentil Bolognese")
        #expect(tweak.recipe.ingredients.map(\.ingredientName) == ["olive oil", "green lentils", "chestnut mushrooms", "bay leaves"])
        #expect(tweak.recipe.ingredients[1].amount == "400" && tweak.recipe.ingredients[1].unit == "g")
        #expect(tweak.recipe.steps[1].instruction == "Brown the mushrooms, then add the lentils.")
        #expect(tweak.recipe.steps[1].durationMinutes == "12", "a changed step keeps its timer")
        #expect(tweak.recipe.steps[0] == bolognese.steps[0] && tweak.recipe.steps[2] == bolognese.steps[2])
        #expect(tweak.changed && tweak.nutritionStale && tweak.misplaced.isEmpty)
        #expect(TweakChecks.problems(tweak, original: bolognese, metric: true).isEmpty)
    }

    @Test func addsAtTheTopAndAfterTheLast() {
        let tweak = RecipeTweaker.apply(.init(summary: "Added two.", ingredients: [.init(.add, 0, name: "salt"), .init(.add, 4, quantity: "1", name: "lemon")],
                                              steps: [.init(.add, 3, instruction: "Serve with lemon.")]), to: bolognese)
        #expect(tweak.recipe.ingredients.first?.ingredientName == "salt")
        #expect(tweak.recipe.ingredients.last?.ingredientName == "lemon")
        #expect(tweak.recipe.steps.last?.instruction == "Serve with lemon.")
    }

    @Test func aMethodOnlyChangeKeepsTheNutrition() {
        let tweak = RecipeTweaker.apply(.init(summary: "Quicker.", steps: [.init(.change, 3, instruction: "Simmer for 45 minutes.")]), to: bolognese)
        #expect(tweak.changed && !tweak.nutritionStale)
    }

    @Test func editsThatMissOrChangeNothingAreRefused() {
        let missed = RecipeTweaker.apply(.init(summary: "Hm.", ingredients: [.init(.remove, 9)]), to: bolognese)
        #expect(TweakChecks.problems(missed, original: bolognese, metric: true).contains { $0.contains("ingredient 9") })
        #expect(TweakChecks.problems(missed, original: bolognese, metric: true).contains("nothing changed"))
        let workaround = RecipeTweaker.apply(.init(summary: "Vegetarian.", steps: [.init(.change, 2, instruction: "Skip the mince.")]), to: bolognese)
        #expect(TweakChecks.problems(workaround, original: bolognese, metric: true).contains { $0.contains("works around") })
    }
}
