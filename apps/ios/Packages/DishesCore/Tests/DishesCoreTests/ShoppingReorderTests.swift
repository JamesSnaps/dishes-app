// Dragging shopping items within and between aisles (ShoppingReorder).

import Foundation
import Testing
@testable import DishesCore

@Suite struct ShoppingReorderTests {
    func item(_ id: String, _ position: Int, _ category: String?) -> ShoppingItem {
        ShoppingItem(.object(["id": .string(id), "listId": .string("l"), "ingredientName": .string(id),
                              "position": .number(Double(position)), "category": category.map(JSONValue.string) ?? .null]))!
    }
    var aisles: [(name: String, items: [ShoppingItem])] {
        [("Dairy", [item("milk", 0, "Dairy"), item("butter", 3, "Dairy"), item("eggs", 5, "Dairy")]),
         ("Produce", [item("leeks", 1, "Produce"), item("lemons", 2, "Produce")]),
         ("Uncategorised", [item("foil", 4, nil)])]
    }

    @Test func reorderingWithinAnAisleUsesItsOwnPositions() {
        let changes = ShoppingReorder.changes(aisles, moving: ["eggs"], to: "Dairy", before: "milk")
        #expect(changes == [.init(itemId: "eggs", position: 0, category: .none),
                            .init(itemId: "milk", position: 3, category: .none),
                            .init(itemId: "butter", position: 5, category: .none)])
    }

    @Test func movingToTheEndOfAnotherAisleChangesTheCategory() {
        let changes = ShoppingReorder.changes(aisles, moving: ["foil"], to: "Produce", before: nil)
        #expect(changes == [.init(itemId: "foil", position: 4, category: .some("Produce"))])
    }

    @Test func movingToUncategorisedClearsIt() {
        let changes = ShoppingReorder.changes(aisles, moving: ["lemons"], to: "Uncategorised", before: "foil")
        #expect(changes.first { $0.itemId == "lemons" }?.category == .some(nil))
    }

    @Test func droppingWhereItAlreadyIsChangesNothing() {
        #expect(ShoppingReorder.changes(aisles, moving: ["butter"], to: "Dairy", before: "eggs").isEmpty)
    }

    @Test func clashingPositionsAreMadeDistinct() {
        let tied: [(name: String, items: [ShoppingItem])] = [("Dairy", [item("a", 2, "Dairy"), item("b", 2, "Dairy")])]
        let changes = ShoppingReorder.changes(tied, moving: ["b"], to: "Dairy", before: "a")
        #expect(changes == [.init(itemId: "a", position: 3, category: .none)])
    }
}
