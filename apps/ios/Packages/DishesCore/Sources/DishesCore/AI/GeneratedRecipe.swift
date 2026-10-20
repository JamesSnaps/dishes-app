// A recipe as an AI writes it: the Swift twin of `GeneratedRecipe` in
// apps/web/lib/ai/recipe-generation.ts, field for field, so a recipe read on
// the device goes to POST /api/v1/recipes/generated exactly as the server's
// own AI would have produced it (TODO_MOBILE.md, Phase D2).
//
// fixtures/wire/generated-recipe.json is decoded here (GeneratedRecipeTests)
// and parsed by the server's schema (scripts/check-ai-context.ts), so the two
// can't drift apart unnoticed.

import Foundation

public struct GeneratedRecipe: Codable, Hashable, Sendable {
    public struct Ingredient: Codable, Hashable, Sendable {
        public var ingredientName: String
        /// "2", "1/2", "1-2" or "" — text, as the server stores it.
        public var amount: String
        public var unit: String
        public var preparation: String
        public var isOptional: Bool
        public var groupLabel: String

        public init(ingredientName: String, amount: String = "", unit: String = "", preparation: String = "",
                    isOptional: Bool = false, groupLabel: String = "") {
            self.ingredientName = ingredientName
            self.amount = amount
            self.unit = unit
            self.preparation = preparation
            self.isOptional = isOptional
            self.groupLabel = groupLabel
        }
    }

    public struct Step: Codable, Hashable, Sendable {
        public var instruction: String
        /// Whole minutes as text, or "".
        public var durationMinutes: String
        public var timerLabel: String
        public var groupLabel: String

        public init(instruction: String, durationMinutes: String = "", timerLabel: String = "", groupLabel: String = "") {
            self.instruction = instruction
            self.durationMinutes = durationMinutes
            self.timerLabel = timerLabel
            self.groupLabel = groupLabel
        }
    }

    public var title: String
    public var description: String
    public var cuisine: String
    /// easy, medium or hard.
    public var difficulty: String
    public var prepTimeMinutes: Int?
    public var cookTimeMinutes: Int?
    public var servings: String
    public var servingsUnit: String
    /// main, side, sauce or other; nil when unsure.
    public var mealRole: String?
    public var mealTypes: [String]
    public var tags: [String]
    public var ingredients: [Ingredient]
    public var steps: [Step]
    public var notes: String?
    /// For POST /api/v1/recipes/generated: omitted, the server suggests one;
    /// null files it nowhere. Not part of what a model writes.
    public var collectionId: String??

    public init(title: String, description: String = "", cuisine: String = "", difficulty: String = "medium",
                prepTimeMinutes: Int? = nil, cookTimeMinutes: Int? = nil, servings: String = "4",
                servingsUnit: String = "servings", mealRole: String? = nil, mealTypes: [String] = [], tags: [String] = [],
                ingredients: [Ingredient], steps: [Step], notes: String? = nil) {
        self.title = title
        self.description = description
        self.cuisine = cuisine
        self.difficulty = difficulty
        self.prepTimeMinutes = prepTimeMinutes
        self.cookTimeMinutes = cookTimeMinutes
        self.servings = servings
        self.servingsUnit = servingsUnit
        self.mealRole = mealRole
        self.mealTypes = mealTypes
        self.tags = tags
        self.ingredients = ingredients
        self.steps = steps
        self.notes = notes
    }

    private enum CodingKeys: String, CodingKey {
        case title, description, cuisine, difficulty, prepTimeMinutes, cookTimeMinutes, servings, servingsUnit,
             mealRole, mealTypes, tags, ingredients, steps, notes, collectionId
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        cuisine = try c.decodeIfPresent(String.self, forKey: .cuisine) ?? ""
        difficulty = try c.decodeIfPresent(String.self, forKey: .difficulty) ?? "medium"
        prepTimeMinutes = try c.decodeIfPresent(Int.self, forKey: .prepTimeMinutes)
        cookTimeMinutes = try c.decodeIfPresent(Int.self, forKey: .cookTimeMinutes)
        servings = try c.decodeIfPresent(String.self, forKey: .servings) ?? "4"
        servingsUnit = try c.decodeIfPresent(String.self, forKey: .servingsUnit) ?? "servings"
        mealRole = try c.decodeIfPresent(String.self, forKey: .mealRole)
        mealTypes = try c.decodeIfPresent([String].self, forKey: .mealTypes) ?? []
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        ingredients = try c.decode([Ingredient].self, forKey: .ingredients)
        steps = try c.decode([Step].self, forKey: .steps)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        collectionId = c.contains(.collectionId) ? .some(try c.decodeIfPresent(String.self, forKey: .collectionId)) : .none
    }

    /// The server's schema is strict: every key it knows is sent (null where
    /// empty), and none it doesn't.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(cuisine, forKey: .cuisine)
        try c.encode(difficulty, forKey: .difficulty)
        try c.encode(prepTimeMinutes, forKey: .prepTimeMinutes)
        try c.encode(cookTimeMinutes, forKey: .cookTimeMinutes)
        try c.encode(servings, forKey: .servings)
        try c.encode(servingsUnit, forKey: .servingsUnit)
        try c.encode(mealRole, forKey: .mealRole)
        try c.encode(mealTypes, forKey: .mealTypes)
        try c.encode(tags, forKey: .tags)
        try c.encode(ingredients, forKey: .ingredients)
        try c.encode(steps, forKey: .steps)
        try c.encode(notes, forKey: .notes)
        if let collectionId { try c.encode(collectionId, forKey: .collectionId) }
    }
}
