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

    @Test func anIngredientThatIsntOnThePageIsRefused() {
        let r = recipe([.init(ingredientName: "nutmeg", preparation: "to taste")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).contains { $0.contains("“nutmeg” isn’t on the page") })
    }

    @Test func visionsOneLetterSlipsInNamesAreForgiven() {
        let r = recipe([.init(ingredientName: "dried oreganu", amount: "1", unit: "tsp"),
                        .init(ingredientName: "ripe tomato", amount: "4")])
        #expect(RecipeChecks.problems(r, metric: true, pageText: page).isEmpty)
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

    @Test func aCookAssistAnswerMustBeShortAndNotPointBackAtTheRecipe() {
        #expect(CookAssistChecks.problems("Simmer it for 2–3 hours on the lowest heat, stirring now and then.").isEmpty)
        #expect(CookAssistChecks.problems("  ") == ["no answer"])
        #expect(!CookAssistChecks.problems("Check the recipe for the timing.").isEmpty)
        #expect(!CookAssistChecks.problems("I'm sorry, I can't help with that.").isEmpty)
        #expect(!CookAssistChecks.problems(Array(repeating: "stir", count: 200).joined(separator: " ")).isEmpty)
    }

    @Test func theCookAssistConversationBecomesOnePrompt() {
        #expect(CookAssist.question([.init(role: "user", content: "How long?")]) == "How long?")
        let q = CookAssist.question([.init(role: "user", content: "How long?"), .init(role: "assistant", content: "Two hours."),
                                     .init(role: "user", content: "How long?")])
        #expect(q == "Earlier in this conversation:\nCook: How long?\nYou: Two hours.\n\nTheir question now: How long?")
    }

    @Test func substitutionsAreToldApart() {
        for q in ["What can I use instead?", "I'm out of baking soda. What can I use?", "I've got no red wine",
                  "Can I substitute butter?", "Any alternative to pecorino?", "I don't have a wok"] {
            #expect(CookAssist.isSubstitution(q), "\(q)")
        }
        for q in ["How long does this need to simmer?", "How do I get it out of the tin?", "Do I leave the bay leaves in?",
                  "What comes next?"] {
            #expect(!CookAssist.isSubstitution(q), "\(q)")
        }
    }

    @Test func aDroppedNameIsReadBackFromThePage() {
        let page = "Ingredients\n600g beef mince, 80/20\nsalt, to taste\nblack pepper, to taste"
        let r = RecipeReader.recoverNames(recipe([.init(ingredientName: "beef mince", amount: "600", unit: "g"),
                                                  .init(ingredientName: "", preparation: "to taste"),
                                                  .init(ingredientName: "", preparation: "to taste")]), from: page)
        #expect(r.ingredients.map(\.ingredientName) == ["beef mince", "salt", "black pepper"])
    }
}
