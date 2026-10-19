// Add-field autocomplete — the same rules as apps/web/lib/shopping-suggestions.ts.

import Foundation
import Testing
@testable import DishesCore

@Suite struct ShoppingSuggestionsTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func item(_ name: String, _ category: String? = nil, daysAgo: Double? = nil,
              list: String = "old", checked: Bool = false) -> JSONValue {
        var fields: [String: JSONValue] = ["id": .string(UUID().uuidString), "ingredientName": .string(name),
                                           "listId": .string(list), "isChecked": .bool(checked)]
        if let category { fields["category"] = .string(category) }
        if let daysAgo {
            fields["createdAt"] = .string(now.addingTimeInterval(-daysAgo * 86_400)
                .formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
        }
        return .object(fields)
    }

    func recipe(_ names: String...) -> JSONValue {
        .object(["id": .string(UUID().uuidString),
                 "ingredients": .array(names.map { .object(["ingredientName": .string($0)]) })])
    }

    var index: ShoppingSuggestionIndex {
        ShoppingSuggestionIndex(
            history: [
                item("Milk", "Dairy", daysAgo: 2), item("milk", daysAgo: 9),
                item("Mince", "Meat", daysAgo: 200), item("Mince", daysAgo: 210), item("Mince", daysAgo: 220),
                item("Eggs", "Dairy", daysAgo: 1), item("Almond milk"),
            ],
            recipes: [recipe("Mushrooms", "Milk", "eggplant"), recipe("Mushroom", "mushrooms")],
            now: now)
    }

    func names(_ typed: String) -> [String] { index.suggestions(for: typed).map(\.name) }

    @Test func boughtBeforeComesFirstThenRecipes() {
        #expect(names("m") == ["Milk", "Mince", "Mushrooms", "Almond milk"])
    }

    @Test func recentBeatsOftenLongAgo() {
        // Mince three times, half a year back, scores under Milk twice this week.
        #expect(names("mi") == ["Milk", "Mince", "Almond milk"])
    }

    @Test func newestSpellingAndCategoryWin() {
        let milk = index.suggestions(for: "milk").first
        #expect(milk == ShoppingSuggestion(name: "Milk", source: .history, count: 2, category: "Dairy"))
    }

    @Test func pluralsAreOneItem() {
        #expect(names("eggs") == ["Eggs"])
        #expect(names("egg") == ["Eggs", "eggplant"])
        // Mushroom and Mushrooms: two recipes, counted once each.
        #expect(index.suggestions(for: "mush").first?.count == 2)
    }

    @Test func oneLetterOnlyMatchesWordStarts() {
        #expect(names("a") == ["Almond milk"])
        #expect(names("ilk") == ["Milk", "Almond milk"])
    }

    @Test func emptyQueryAndItemsOnTheListAreLeftOut() {
        #expect(names("  ").isEmpty)
        var i = index
        i.onList = [ShoppingSuggestionIndex.key("Milk")]
        #expect(i.suggestions(for: "m").map(\.name) == ["Mince", "Mushrooms", "Almond milk"])
    }
}
