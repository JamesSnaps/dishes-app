// Typed views over the synced rows. Each is built from the record's JSON and
// reads only what the app shows; anything missing or malformed falls back to
// the same default the server applies, so one odd row can't break a screen
// (TODO_MOBILE.md, "the meal plan conversion": never trust a cast).
//
//   let items = try await store.read { try $0.records(.shoppingItems) }.compactMap(ShoppingItem.init)
//
// Postgres numerics arrive as strings ("4.00", "600.000"); `number(_:)` reads
// either form.

import Foundation

extension JSONValue {
    public func string(_ key: String) -> String? {
        if case .string(let s)? = self[key] { return s }
        return nil
    }

    public func number(_ key: String) -> Double? {
        switch self[key] {
        case .number(let n)?: n
        case .string(let s)?: Double(s)
        default: nil
        }
    }

    public func int(_ key: String) -> Int? { number(key).map { Int($0) } }

    public func bool(_ key: String) -> Bool? {
        if case .bool(let b)? = self[key] { return b }
        return nil
    }

    public func array(_ key: String) -> [JSONValue] {
        if case .array(let a)? = self[key] { return a }
        return []
    }

    public func strings(_ key: String) -> [String] {
        array(key).compactMap { if case .string(let s) = $0 { s } else { nil } }
    }

    /// The record's id, which every synced row has.
    public var id: String? { string("id") }

    /// An object from fields that may be nil; nil ones are left out (as
    /// `undefined` is in a JSON.stringify'd payload).
    public static func fields(_ fields: [String: JSONValue?]) -> JSONValue {
        .object(fields.compactMapValues { $0 })
    }
}

// MARK: Recipes

public struct Ingredient: Hashable, Sendable, Identifiable {
    public var id: String
    public var position: Int
    public var name: String
    public var amount: String?
    public var unit: String?
    public var preparation: String?
    public var isOptional: Bool
    public var groupLabel: String?

    init?(_ json: JSONValue) {
        guard let id = json.id else { return nil }
        self.id = id
        position = json.int("position") ?? 0
        name = json.string("ingredientName") ?? ""
        amount = json.string("amount")
        unit = json.string("unit")
        preparation = json.string("preparation")
        isOptional = json.bool("isOptional") ?? false
        groupLabel = json.string("groupLabel")
    }
}

public struct RecipeStep: Hashable, Sendable, Identifiable {
    public var id: String
    public var position: Int
    public var instruction: String
    public var durationMinutes: Int?
    public var timerLabel: String?
    public var ingredientIds: [String]
    public var groupLabel: String?

    init?(_ json: JSONValue) {
        guard let id = json.id else { return nil }
        self.id = id
        position = json.int("position") ?? 0
        instruction = json.string("instruction") ?? ""
        durationMinutes = json.int("durationMinutes")
        timerLabel = json.string("timerLabel")
        ingredientIds = json.strings("ingredientIds")
        groupLabel = json.string("groupLabel")
    }
}

public enum Difficulty: String, Sendable, CaseIterable {
    case easy, medium, hard
}

public struct Recipe: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var description: String?
    public var cuisine: String?
    public var prepTimeMinutes: Int?
    public var cookTimeMinutes: Int?
    public var servings: Double?
    public var servingsUnit: String?
    public var difficulty: Difficulty?
    public var mealRole: String?
    public var imageUrl: String?
    public var thumbnailUrl: String?
    public var isFavourite: Bool
    public var tags: [String]
    public var ingredients: [Ingredient]
    public var steps: [RecipeStep]
    public var calories: Double?
    public var createdAt: String?

    public var totalMinutes: Int? {
        let total = (prepTimeMinutes ?? 0) + (cookTimeMinutes ?? 0)
        return total > 0 ? total : nil
    }

    public init?(_ json: JSONValue) {
        guard let id = json.id else { return nil }
        self.id = id
        title = json.string("title") ?? "Untitled"
        description = json.string("description")
        cuisine = json.string("cuisine")
        prepTimeMinutes = json.int("prepTimeMinutes")
        cookTimeMinutes = json.int("cookTimeMinutes")
        servings = json.number("servings")
        servingsUnit = json.string("servingsUnit")
        difficulty = json.string("difficulty").flatMap(Difficulty.init(rawValue:))
        mealRole = json.string("mealRole")
        imageUrl = json.string("imageUrl")
        thumbnailUrl = json.string("thumbnailUrl")
        isFavourite = json.bool("isFavourite") ?? false
        tags = json.strings("tags")
        ingredients = json.array("ingredients").compactMap(Ingredient.init).sorted { $0.position < $1.position }
        steps = json.array("steps").compactMap(RecipeStep.init).sorted { $0.position < $1.position }
        calories = json.number("calories")
        createdAt = json.string("createdAt")
    }
}

// MARK: Shopping

public struct ShoppingList: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var status: String

    public init?(_ json: JSONValue) {
        guard let id = json.id else { return nil }
        self.id = id
        name = json.string("name") ?? "Shopping"
        status = json.string("status") ?? "active"
    }
}

public struct ShoppingItem: Hashable, Sendable, Identifiable {
    public var id: String
    public var listId: String
    public var recipeId: String?
    public var name: String
    public var amount: String?
    public var unit: String?
    public var notes: String?
    public var isChecked: Bool
    public var position: Int
    public var category: String?

    public init?(_ json: JSONValue) {
        guard let id = json.id, let listId = json.string("listId") else { return nil }
        self.id = id
        self.listId = listId
        recipeId = json.string("recipeId")
        name = json.string("ingredientName") ?? ""
        amount = json.string("amount")
        unit = json.string("unit")
        notes = json.string("notes")
        isChecked = json.bool("isChecked") ?? false
        position = json.int("position") ?? 0
        category = json.string("category")
    }
}

// MARK: Meal plan

public struct MealPlan: Hashable, Sendable, Identifiable {
    public var id: String
    /// "yyyy-MM-dd", always a Monday.
    public var weekStartDate: String

    public init?(_ json: JSONValue) {
        guard let id = json.id, let week = json.string("weekStartDate") else { return nil }
        self.id = id
        weekStartDate = week
    }
}

public struct MealPlanEntry: Hashable, Sendable, Identifiable {
    public var id: String
    public var mealPlanId: String
    public var recipeId: String?
    /// 0 = Monday.
    public var dayOfWeek: Int
    public var mealType: String
    public var servings: Double?
    public var notes: String?
    public var groupId: String?
    public var mealRole: String?
    /// Set once the entry's ingredients have gone onto the shopping list.
    public var addedToShoppingListAt: String?

    public init?(_ json: JSONValue) {
        guard let id = json.id, let plan = json.string("mealPlanId") else { return nil }
        self.id = id
        mealPlanId = plan
        addedToShoppingListAt = json.string("addedToShoppingListAt")
        recipeId = json.string("recipeId")
        dayOfWeek = json.int("dayOfWeek") ?? 0
        mealType = json.string("mealType") ?? "dinner"
        servings = json.number("servings")
        notes = json.string("notes")
        groupId = json.string("groupId")
        mealRole = json.string("mealRole")
    }
}

public struct MealPlanGroup: Hashable, Sendable, Identifiable {
    public var id: String
    public var mealPlanId: String
    public var title: String
    public var dayOfWeek: Int
    public var mealType: String
    /// "HH:mm"
    public var serveAt: String?

    public init?(_ json: JSONValue) {
        guard let id = json.id, let plan = json.string("mealPlanId") else { return nil }
        self.id = id
        mealPlanId = plan
        title = json.string("title") ?? "Meal"
        dayOfWeek = json.int("dayOfWeek") ?? 0
        mealType = json.string("mealType") ?? "dinner"
        serveAt = json.string("serveAt")
    }
}

/// The order meal types appear in a day, as on the web planner.
public let mealTypeOrder = ["breakfast", "lunch", "dinner", "dessert", "snack"]
