// Hands-free cooking's commands (CookCommand): short plain phrases, nothing
// from ordinary talk.

import Testing
@testable import DishesCore

@Suite struct CookCommandTests {
    @Test func navigation() {
        #expect(CookCommand("Next") == .next)
        #expect(CookCommand("next step please") == .next)
        #expect(CookCommand("Go back.") == .back)
        #expect(CookCommand("previous step") == .back)
        #expect(CookCommand("Read it again") == .read)
        #expect(CookCommand("say that again") == .read)
        #expect(CookCommand("start the timer") == .startTimer)
        #expect(CookCommand("Timer") == .startTimer)
    }

    @Test func howMuch() {
        #expect(CookCommand("How much butter?") == .howMuch("butter"))
        #expect(CookCommand("how many of the eggs do I need") == .howMuch("eggs"))
        #expect(CookCommand("OK how much garlic goes in") == .howMuch("garlic"))
        #expect(CookCommand("how much longer") == nil)
    }

    @Test func talkInTheKitchenIsIgnored() {
        #expect(CookCommand("I think we should go back to that shop next week sometime") == nil)
        #expect(CookCommand("can you pass me the salt") == nil)
        #expect(CookCommand("") == nil)
    }

    @Test func findsTheIngredientMeant() {
        let names = ["unsalted butter", "plain flour", "onions", "garlic cloves"]
        #expect(CookCommand.ingredient(matching: "butter", in: names) == 0)
        #expect(CookCommand.ingredient(matching: "the onion", in: names) == 2)
        #expect(CookCommand.ingredient(matching: "garlic", in: names) == 3)
        #expect(CookCommand.ingredient(matching: "saffron", in: names) == nil)
    }
}
