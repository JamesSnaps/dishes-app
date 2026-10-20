// What an on-device answer must get right before it's used (AIChecks.swift):
// cases the recipe-card evaluation turned up.

import Foundation
import Testing
@testable import DishesCore

@Suite struct AIChecksTests {
    func recipe(_ ingredients: [GeneratedRecipe.Ingredient]) -> GeneratedRecipe {
        GeneratedRecipe(title: "Greek Salad", difficulty: "easy", ingredients: ingredients, steps: [.init(instruction: "Toss.")])
    }

    let page = """
        Greek Salad
        4 ripe tomatoes, cut into wedges
        6oml extra virgin olive oil
        4 celery sticks, chopped
        1 tsp dried oregano
        """

    @Test func vision0And1MisreadsAreForgiven() {
        // Vision read "60ml" as "6oml"; the model's "60 ml" is right.
        let r = recipe([.init(ingredientName: "extra virgin olive oil", amount: "60", unit: "ml")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).isEmpty)
    }

    @Test func aUnitThePageDoesntGiveIsRefused() {
        let r = recipe([.init(ingredientName: "ripe tomatoes", amount: "4", unit: "kg")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).contains { $0.contains("isn’t on the page") })
    }

    @Test func aUnitRepeatingTheNameIsRefused() {
        let r = recipe([.init(ingredientName: "celery sticks", amount: "4", unit: "sticks")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).contains { $0.contains("repeats the name") })
    }

    @Test func celerySticksArentImperial() {
        let r = recipe([.init(ingredientName: "celery", amount: "4", unit: "sticks")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).isEmpty)
    }

    @Test func cupsInAMetricHouseholdGoToTheServer() {
        let r = recipe([.init(ingredientName: "flour", amount: "2", unit: "cups")])
        #expect(!RecipeChecks.problems(r, metric: true).isEmpty)
        #expect(RecipeChecks.problems(r, metric: false).isEmpty)
    }

    @Test func amountsAreNumbersFractionsOrRanges() {
        for ok in ["", "2", "2.5", "1/2", "1 1/2", "1-2", "0.5 - 1"] { #expect(IngredientChecks.isAmount(ok), "\(ok)") }
        for bad in ["salt", "a few", "2 tbsp", "½"] { #expect(!IngredientChecks.isAmount(bad), "\(bad)") }
    }
}
