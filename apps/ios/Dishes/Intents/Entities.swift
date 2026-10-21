// The household's things as App Intents entities, so Siri, Shortcuts and
// Spotlight can name them (TODO_MOBILE.md, Phase D1): recipes, planned meals,
// shopping items, saved meals, and the step cooking mode is on.
//
// Every query reads this device's database, never the network, so all of it
// works offline. Recipes are also in Spotlight's index (SpotlightIndex), and a
// tap on one opens it (OpenRecipeIntent). The rest are for Siri and Shortcuts:
// planned meals and shopping items come and go too quickly to index, and a
// saved meal has no screen of its own to open on.
//
// No AppSchema conformances: the iOS 27.1 SDK's domains (mail, photos,
// reminders, notes, journal…) have nothing for recipes, meal plans or a
// shopping list. "Reminders" is the closest and is exactly the grammar that
// made Siri look for a Reminders list called "Dishes shopping" (ShoppingIntents).

import AppIntents
import CoreSpotlight
import DishesCore
import Foundation

// MARK: Recipes

struct RecipeEntity: IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Recipe", numericFormat: "\(placeholder: .int) recipes")
    }
    static var defaultQuery: RecipeQuery { RecipeQuery() }

    var id: String
    @Property(title: "Title") var title: String
    @Property(title: "Cuisine") var cuisine: String?
    @Property(title: "Tags") var tags: [String]
    @Property(title: "Ingredients") var ingredients: [String]
    @Property(title: "Total time in minutes") var totalMinutes: Int?
    /// main, side, sauce or other.
    @Property(title: "Course") var mealRole: String?
    @Property(title: "Favourite") var isFavourite: Bool
    @Property(title: "Last cooked") var lastCooked: Date?
    var description: String?
    var thumbnail: URL?

    init(_ recipe: Recipe, lastCooked: Date?, thumbnail: URL?) {
        id = recipe.id
        description = recipe.description
        self.thumbnail = thumbnail
        self.title = recipe.title
        self.cuisine = recipe.cuisine
        self.tags = recipe.tags
        self.ingredients = recipe.ingredients.map(\.name)
        self.totalMinutes = recipe.totalMinutes
        self.mealRole = recipe.mealRole
        self.isFavourite = recipe.isFavourite
        self.lastCooked = lastCooked
    }

    private var subtitle: String {
        [cuisine, Format.minutes(totalMinutes), isFavourite ? "Favourite" : nil].compactMap { $0 }.joined(separator: " · ")
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)",
                              image: thumbnail.map { .init(url: $0) } ?? .init(systemName: "fork.knife"))
    }

    /// What Spotlight's semantic search reads: "that chicken thing we had last
    /// week" matches on the ingredients and the last cook.
    var attributeSet: CSSearchableItemAttributeSet {
        let set = defaultAttributeSet
        set.displayName = title
        set.contentDescription = [description, subtitle, ingredients.prefix(12).joined(separator: ", ")]
            .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: "\n")
        set.keywords = [cuisine].compactMap { $0 } + tags + ingredients
        set.lastUsedDate = lastCooked
        return set
    }
}

struct RecipeQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [RecipeEntity] {
        let wanted = Set(identifiers)
        return try await IntentData.recipes().filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [RecipeEntity] {
        let words = string.lowercased().split(separator: " ").map(String.init)
        return try await IntentData.recipes().filter { recipe in
            let text = ([recipe.title, recipe.cuisine ?? ""] + recipe.tags + recipe.ingredients).joined(separator: " ").lowercased()
            return words.allSatisfy(text.contains)
        }
    }

    /// Favourites and the recently cooked first: what Siri offers when asked "which recipe?".
    func suggestedEntities() async throws -> [RecipeEntity] {
        try await IntentData.recipes()
            .sorted { ($0.isFavourite ? 1 : 0, $0.lastCooked ?? .distantPast) > ($1.isFavourite ? 1 : 0, $1.lastCooked ?? .distantPast) }
            .prefix(30).map { $0 }
    }
}

// MARK: Planned meals

/// A meal on a day of the plan: a combined meal (its group) or a single dish (its entry).
struct PlannedMealEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Planned Meal", numericFormat: "\(placeholder: .int) planned meals")
    }
    static var defaultQuery: PlannedMealQuery { PlannedMealQuery() }

    var id: String
    @Property(title: "Title") var title: String
    @Property(title: "Date") var date: Date
    /// breakfast, lunch, dinner, dessert or snack.
    @Property(title: "Meal") var mealType: String
    /// "18:30", when the meal has a serve time.
    @Property(title: "Serve time") var serveAt: String?
    @Property(title: "Dishes") var dishes: [String]
    @Property(title: "On the shopping list") var onShoppingList: Bool
    var recipeIds: [String]
    /// Set for a combined meal.
    var groupId: String?

    init(_ meal: PlannedMeal, on date: Date) {
        id = meal.id
        groupId = meal.groupId
        recipeIds = meal.dishes.compactMap { $0.recipe?.id }
        let titles = meal.dishes.compactMap { $0.recipe?.title }
        self.title = meal.title ?? titles.first ?? meal.dishes.first?.entry.notes ?? "A meal"
        self.date = date
        self.mealType = meal.mealType
        self.serveAt = meal.serveAt
        self.dishes = titles
        self.onShoppingList = !meal.dishes.isEmpty && meal.dishes.allSatisfy { $0.entry.addedToShoppingListAt != nil }
    }

    var displayRepresentation: DisplayRepresentation {
        let when = [date.formatted(.dateTime.weekday(.wide)), mealType.capitalized, serveAt].compactMap { $0 }.joined(separator: " · ")
        return DisplayRepresentation(title: "\(title)", subtitle: "\(when)", image: .init(systemName: "calendar"))
    }
}

struct PlannedMealQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [PlannedMealEntity] {
        let wanted = Set(identifiers)
        return try await IntentData.plannedMeals(weeks: -4...8).filter { wanted.contains($0.id) }
    }

    /// From today to the end of next week.
    func suggestedEntities() async throws -> [PlannedMealEntity] {
        let today = Calendar.current.startOfDay(for: Date())
        return try await IntentData.plannedMeals(weeks: 0...1).filter { $0.date >= today }
    }
}

// MARK: Shopping items

struct ShoppingItemEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Shopping Item", numericFormat: "\(placeholder: .int) shopping items")
    }
    static var defaultQuery: ShoppingItemQuery { ShoppingItemQuery() }

    var id: String
    @Property(title: "Name") var name: String
    /// "500 g", or nil.
    @Property(title: "Amount") var amount: String?
    @Property(title: "Aisle") var category: String?
    @Property(title: "Ticked off") var isChecked: Bool

    init(_ item: ShoppingItem) {
        id = item.id
        self.name = item.name
        let quantity = Format.quantity(item.amount, item.unit)
        self.amount = quantity.isEmpty ? nil : quantity
        self.category = item.category
        self.isChecked = item.isChecked
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: amount.map { "\($0)" },
                              image: .init(systemName: isChecked ? "checkmark.circle.fill" : "circle"))
    }
}

struct ShoppingItemQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ShoppingItemEntity] {
        let wanted = Set(identifiers)
        return try await IntentData.shoppingItems().filter { wanted.contains($0.id) }
    }

    /// Still to buy, matching what was said ("milk" finds "Semi-skimmed milk").
    func entities(matching string: String) async throws -> [ShoppingItemEntity] {
        let wanted = string.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return try await IntentData.shoppingItems().filter { !$0.isChecked && $0.name.lowercased().contains(wanted) }
    }

    func suggestedEntities() async throws -> [ShoppingItemEntity] {
        try await IntentData.shoppingItems().filter { !$0.isChecked }
    }
}

// MARK: Saved meals

struct SavedMealEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Saved Meal", numericFormat: "\(placeholder: .int) saved meals")
    }
    static var defaultQuery: SavedMealQuery { SavedMealQuery() }

    var id: String
    @Property(title: "Title") var title: String
    @Property(title: "Meal") var mealType: String
    /// Each slot's default dish: what planning it picks unless told otherwise.
    @Property(title: "Dishes") var dishes: [String]

    init(_ meal: SavedMeal) {
        id = meal.id
        self.title = meal.title
        self.mealType = meal.defaultMealType
        self.dishes = meal.slots.flatMap(\.defaults).map(\.title)
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(dishes.joined(separator: ", "))",
                              image: .init(systemName: "square.stack"))
    }
}

struct SavedMealQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [SavedMealEntity] {
        let wanted = Set(identifiers)
        return try await IntentData.savedMeals().filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [SavedMealEntity] {
        let wanted = string.lowercased()
        return try await IntentData.savedMeals().filter {
            $0.title.lowercased().contains(wanted) || $0.dishes.contains { $0.lowercased().contains(wanted) }
        }
    }

    func suggestedEntities() async throws -> [SavedMealEntity] { try await IntentData.savedMeals() }
}

// MARK: The step being cooked

/// A step of a recipe at the scale it's being cooked at — what cooking mode
/// shows, so "how much butter?" is answered at the scaled amount.
/// The id carries all three: "<recipe id>|<step index>|<scale>".
struct CookingStepEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Recipe Step" }
    static var defaultQuery: CookingStepQuery { CookingStepQuery() }

    var id: String
    @Property(title: "Recipe") var recipe: String
    @Property(title: "Step number") var number: Int
    @Property(title: "Instruction") var instruction: String
    /// "250 g butter, softened" for each ingredient the step uses.
    @Property(title: "Ingredients for this step") var stepIngredients: [String]
    @Property(title: "All the recipe's ingredients") var allIngredients: [String]
    @Property(title: "Timer in minutes") var timerMinutes: Int?
    var recipeId: String
    var stepIndex: Int
    var timerLabel: String?

    static func id(recipeId: String, stepIndex: Int, scale: Double) -> String { "\(recipeId)|\(stepIndex)|\(scale)" }

    init?(_ recipe: Recipe, stepIndex: Int, scale: Double) {
        guard recipe.steps.indices.contains(stepIndex) else { return nil }
        let step = recipe.steps[stepIndex]
        func line(_ i: Ingredient) -> String {
            [Format.quantity(i.amount, i.unit, scale: scale), i.name].filter { !$0.isEmpty }.joined(separator: " ")
                + (i.preparation?.isEmpty == false ? ", \(i.preparation!)" : "")
        }
        id = Self.id(recipeId: recipe.id, stepIndex: stepIndex, scale: scale)
        recipeId = recipe.id
        self.stepIndex = stepIndex
        timerLabel = step.timerLabel
        self.recipe = recipe.title
        self.number = stepIndex + 1
        self.instruction = step.instruction
        self.stepIngredients = recipe.ingredients.filter { step.ingredientIds.contains($0.id) }.map(line)
        self.allIngredients = recipe.ingredients.map(line)
        self.timerMinutes = step.durationMinutes.flatMap { $0 > 0 ? $0 : nil }
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "Step \(number) of \(recipe)", subtitle: "\(instruction)", image: .init(systemName: "list.number"))
    }
}

struct CookingStepQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [CookingStepEntity] {
        let recipes = try await IntentData.recipesById()
        return identifiers.compactMap { id in
            let parts = id.split(separator: "|").map(String.init)
            guard parts.count == 3, let recipe = recipes[parts[0]], let index = Int(parts[1]), let scale = Double(parts[2]) else { return nil }
            return CookingStepEntity(recipe, stepIndex: index, scale: scale)
        }
    }
}
