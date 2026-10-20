// Dragging shopping items (TODO_MOBILE.md, D6): within an aisle to reorder
// them, onto another aisle to change their category. What changes is worked
// out here, so the screen only sends it.
//
// Positions are one sequence across the whole list, and the screen groups by
// category, so an aisle's order is its items' positions. A drop renumbers only
// the aisle it lands in, reusing the positions its items already hold (made
// distinct), so a drag sends as few updates as it can.
//
//   let changes = ShoppingReorder.changes(aisles, moving: ["milk"], to: "Dairy", before: "eggs")

import Foundation

public enum ShoppingReorder {
    public struct Change: Hashable, Sendable {
        public var itemId: String
        public var position: Int
        /// Set when the item moved aisle: the new category, nil for uncategorised.
        public var category: String??
    }

    /// The aisle items without a category show under.
    public static let uncategorised = "Uncategorised"

    /// `aisles`: the open items by aisle, in screen order. `before`: the item
    /// they're dropped in front of, nil for the end of the aisle.
    public static func changes(_ aisles: [(name: String, items: [ShoppingItem])], moving ids: [String], to aisle: String,
                               before: String?) -> [Change] {
        let all = aisles.flatMap(\.items)
        let moving = ids.compactMap { id in all.first { $0.id == id } }
        guard !moving.isEmpty else { return [] }
        let staying = (aisles.first { $0.name == aisle }?.items ?? []).filter { !ids.contains($0.id) }
        let at = before.flatMap { b in staying.firstIndex { $0.id == b } } ?? staying.count
        let order = Array(staying[..<at]) + moving + Array(staying[at...])

        var positions = order.map(\.position).sorted()
        for n in positions.indices.dropFirst() where positions[n] <= positions[n - 1] { positions[n] = positions[n - 1] + 1 }

        let category: String? = aisle == uncategorised ? nil : aisle
        return zip(order, positions).compactMap { item, position in
            let movedAisle = (item.category?.isEmpty == false ? item.category : nil) != category && ids.contains(item.id)
            guard item.position != position || movedAisle else { return nil }
            return Change(itemId: item.id, position: position, category: movedAisle ? .some(category) : .none)
        }
    }
}
