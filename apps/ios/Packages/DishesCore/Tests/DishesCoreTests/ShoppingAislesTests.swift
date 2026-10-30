import Testing
@testable import DishesCore

struct ShoppingAislesTests {
    @Test(arguments: [
        ("Carrots", "Produce"), ("Cherry tomatoes", "Produce"), ("Red peppers", "Produce"), ("Sweet potato", "Produce"),
        ("Semi-skimmed milk", "Dairy"), ("Free range eggs", "Dairy"), ("Greek yoghurt", "Dairy"), ("Crème fraîche", "Dairy"),
        ("Chicken thighs", "Meat"), ("Beef mince", "Meat"), ("Salmon fillets", "Fish"), ("Sourdough loaf", "Bakery"),
        ("Chicken stock", "Pantry"), ("Chopped tomatoes", "Pantry"), ("Butter beans", "Pantry"), ("Peanut butter", "Pantry"),
        ("Coconut milk", "Pantry"), ("Black pepper", "Pantry"), ("Chilli flakes", "Pantry"), ("Fish sauce", "Pantry"),
        ("Frozen peas", "Frozen"), ("Frozen prawns", "Frozen"), ("Ice cream", "Frozen"), ("Fish fingers", "Frozen"),
        ("Orange juice", "Drinks"), ("Toilet rolls", "Cleaning"), ("Kitchen roll", "Cleaning"), ("Toothpaste", "Other"),
    ])
    func rules(_ name: String, _ aisle: String) {
        #expect(ShoppingAisles.rule(name) == aisle)
    }

    @Test func unknownIsLeftForTheModel() {
        #expect(ShoppingAisles.rule("Gochujang") == nil)
        #expect(ShoppingAisles.rule("") == nil)
        // A word inside another word isn't a match.
        #expect(ShoppingAisles.rule("Hamachi") == nil)
    }

    @Test func historyRemembersTheAisle() {
        let index = ShoppingSuggestionIndex(history: [
            .fields(["ingredientName": .string("Gochujang"), "category": .string("Pantry")]),
        ], recipes: [])
        #expect(index.category(for: "gochujang") == "Pantry")
        #expect(index.category(for: "Halloumi") == nil)
    }
}
