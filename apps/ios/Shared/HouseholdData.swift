// The week's meals and the shopping list as the screens show them, read from
// the store: compiled into the app and the widget extension both (D4), so a
// widget shows exactly what the Planner and Shopping tabs do.

import DishesCore
import Foundation

/// A Monday-to-Sunday week, keyed as the server keys meal plans ("yyyy-MM-dd").
struct Week: Hashable, Sendable {
    var monday: Date

    static func containing(_ date: Date) -> Week {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        let start = calendar.dateInterval(of: .weekOfYear, for: date)!.start
        return Week(monday: start)
    }

    /// Today as 0 (Monday) to 6 (Sunday).
    static var todayIndex: Int { dayIndex(of: Date()) }

    /// A date's day as 0 (Monday) to 6 (Sunday).
    static func dayIndex(of date: Date) -> Int { (Calendar(identifier: .iso8601).component(.weekday, from: date) + 5) % 7 }

    /// In the local calendar: an ISO-8601 formatter writes UTC, which turns
    /// midnight on a British Summer Time Monday into Sunday's date.
    var key: String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: monday)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    func day(_ index: Int) -> Date { Calendar.current.date(byAdding: .day, value: index, to: monday)! }
    func adding(_ weeks: Int) -> Week { Week(monday: Calendar.current.date(byAdding: .day, value: 7 * weeks, to: monday)!) }
    var isCurrent: Bool { self == Week.containing(Date()) }

    /// "This Week", or the range as the web shows it: "5 Oct – 11 Oct 2026".
    var title: String {
        if isCurrent { return "This Week" }
        let end = day(6)
        return "\(monday.formatted(.dateTime.day().month(.abbreviated))) – \(end.formatted(.dateTime.day().month(.abbreviated).year()))"
    }
}

/// One slot in a day: a combined meal with its dishes, or a single dish.
struct PlannedMeal: Identifiable {
    var id: String
    /// Set for a combined meal (`id` is then the group's); nil for a single dish.
    var groupId: String? = nil
    var mealType: String
    var title: String?
    var serveAt: String?
    var sourceMealId: String? = nil
    var dishes: [(entry: MealPlanEntry, recipe: Recipe?)]
    /// Its place in the day as arranged (0 until someone reorders).
    var position = 0

    /// One servings figure when every dish agrees on it.
    var servings: Double? {
        let values = Set(dishes.compactMap { $0.entry.servings ?? $0.recipe?.servings })
        return values.count == 1 ? values.first : nil
    }
}

struct PlanData: Sendable {
    var plans: [MealPlan] = []
    var entries: [MealPlanEntry] = []
    var groups: [MealPlanGroup] = []
    var recipes: [String: Recipe] = [:]

    @Sendable static func load(_ r: StoreReader) throws -> PlanData {
        PlanData(
            plans: try r.records(.mealPlans).compactMap(MealPlan.init),
            entries: try r.records(.mealPlanEntries).compactMap(MealPlanEntry.init),
            groups: try r.records(.mealPlanGroups).compactMap(MealPlanGroup.init),
            recipes: Dictionary(try r.records(.recipes).compactMap(Recipe.init).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }))
    }

    func plan(for week: Week) -> MealPlan? { plans.first { $0.weekStartDate == week.key } }

    func entries(in week: Week) -> [MealPlanEntry] {
        guard let plan = plan(for: week) else { return [] }
        return entries.filter { $0.mealPlanId == plan.id }
    }

    /// Today's meal of a type; nil asks for tonight's — dinner, or the last
    /// meal planned today (as the Recipes tab's Tonight card shows).
    func today(_ mealType: String?, now: Date = Date()) -> PlannedMeal? {
        let meals = meals(on: Week.dayIndex(of: now), in: Week.containing(now))
        if let mealType { return meals.first { $0.mealType == mealType } }
        return meals.first { $0.mealType == "dinner" } ?? meals.last
    }

    func meals(on day: Int, in week: Week) -> [PlannedMeal] {
        guard let plan = plan(for: week) else { return [] }
        let todays = entries.filter { $0.mealPlanId == plan.id && $0.dayOfWeek == day }
        var meals: [PlannedMeal] = []
        for group in groups where group.mealPlanId == plan.id && group.dayOfWeek == day {
            let dishes = todays.filter { $0.groupId == group.id }.map { ($0, $0.recipeId.flatMap { recipes[$0] }) }
            meals.append(PlannedMeal(id: group.id, groupId: group.id, mealType: group.mealType, title: group.title, serveAt: group.serveAt,
                                     sourceMealId: group.sourceMealId, dishes: dishes, position: group.position))
        }
        for entry in todays where entry.groupId == nil || !groups.contains(where: { $0.id == entry.groupId }) {
            meals.append(PlannedMeal(id: entry.id, mealType: entry.mealType, title: nil, serveAt: nil,
                                     dishes: [(entry, entry.recipeId.flatMap { recipes[$0] })], position: entry.position))
        }
        // As the household arranged the day, then by meal type — the only order
        // until someone reorders (the web sorts the same way).
        return meals.sorted {
            ($0.position, mealTypeOrder.firstIndex(of: $0.mealType) ?? 9, $0.id)
                < ($1.position, mealTypeOrder.firstIndex(of: $1.mealType) ?? 9, $1.id)
        }
    }
}

// MARK: Shopping

/// The web's CATEGORY_ORDER (shopping-list-client.tsx); anything else after, then uncategorised.
let shoppingCategories = ["Produce", "Dairy", "Meat", "Fish", "Bakery", "Pantry", "Frozen", "Drinks", "Cleaning", "Other"]

/// The active list and its items, grouped for display.
struct ShoppingData: Sendable {
    struct Group: Sendable { var name: String; var items: [ShoppingItem] }

    var list: ShoppingList?
    var all: [ShoppingItem] = []
    var groups: [Group] = []
    var checked: [ShoppingItem] = []
    var recipeTitles: [String: String] = [:]

    @Sendable static func load(_ r: StoreReader) throws -> ShoppingData {
        let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
        let list = lists.first { $0.status == "active" }
        let items = try r.records(.shoppingItems).compactMap(ShoppingItem.init)
            // Items on the active list, plus any added before a list existed.
            .filter { $0.listId == list?.id || $0.listId == "pending" }
            .sorted { ($0.position, $0.name) < ($1.position, $1.name) }

        var data = ShoppingData(list: list, all: items)
        let open = items.filter { !$0.isChecked }
        let byCategory = Dictionary(grouping: open) { $0.category?.isEmpty == false ? $0.category! : "" }
        func rank(_ name: String) -> (Int, String) {
            if name.isEmpty { return (2, "") }
            if let i = shoppingCategories.firstIndex(of: name) { return (0, String(format: "%02d", i)) }
            return (1, name)
        }
        data.groups = byCategory.keys.sorted { rank($0) < rank($1) }
            .map { Group(name: $0.isEmpty ? "Uncategorised" : $0, items: byCategory[$0]!) }
        data.checked = items.filter(\.isChecked)
        let ids = Set(items.compactMap(\.recipeId))
        if !ids.isEmpty {
            data.recipeTitles = Dictionary(try r.records(.recipes).compactMap(Recipe.init)
                .filter { ids.contains($0.id) }.map { ($0.id, $0.title) }, uniquingKeysWith: { a, _ in a })
        }
        return data
    }
}
