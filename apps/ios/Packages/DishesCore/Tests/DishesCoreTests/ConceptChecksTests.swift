// What the device's five ideas must get right (ConceptChecks): diets and
// dislikes of whoever's eating, five distinct ideas.

import Foundation
import Testing
@testable import DishesCore

@Suite struct ConceptChecksTests {
    func member(_ flags: [String] = [], dislikes: [String] = []) -> AIContext.Member {
        .init(id: "m", displayName: "Sam", role: "adult", birthYear: nil, dietaryFlags: flags, dislikes: dislikes, preferences: [], customNotes: nil)
    }
    func ideas(_ titles: String...) -> [APIClient.Concept] { titles.map { .init(title: $0, description: "A dish.") } }

    @Test func wordsAreFoundAtTheirStartAndNotAsStandIns() {
        #expect(ConceptChecks.mentions("Ham and leek pie", "ham"))
        #expect(!ConceptChecks.mentions("A shame to waste", "ham"))
        #expect(!ConceptChecks.mentions("Pizza with vegan mozzarella", "mozzarella"))
        #expect(ConceptChecks.mentions("Creamy mushroom risotto", "mushrooms"))
        #expect(!ConceptChecks.mentions("Chickpea curry", "chicken"))
    }

    @Test func aVegetarianGetsNoMeat() {
        let eating = [member(["Vegetarian"])]
        #expect(ConceptChecks.problems(ideas("Dal", "Chana masala", "Veggie chilli", "Halloumi wraps", "Lentil shepherd's pie"), eating: eating).isEmpty)
        #expect(ConceptChecks.problems(ideas("Dal", "Chicken korma", "Veggie chilli", "Halloumi wraps", "Lentil pie"), eating: eating)
            .contains { $0.contains("vegetarian") })
    }

    @Test func dislikesAndRepeatsAreRefused() {
        let p = ConceptChecks.problems(ideas("Mushroom risotto", "Pea risotto", "Pea risotto", "Squash risotto"), eating: [member(dislikes: ["mushrooms"])])
        #expect(p.contains { $0.contains("dislikes") })
        #expect(p.contains("the same idea twice"))
        #expect(p.contains("4 ideas, not five"))
    }
}
