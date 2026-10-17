// The week's meals, from the local store, so paging between weeks needs no
// network at all (the web gets the same from the sync store, Phase B). Days
// are cards — a column at iPhone width, a grid on iPad — and a combined meal
// (meal_plan_groups) shows as one card with its dishes inside.
//
// Removing a dish is a `meal_plan_entry.delete` mutation. Adding, moving and
// saved meals come next (C3; saved meals need the C0 sync work).

import DishesCore
import SwiftUI

struct PlanScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @State private var week = Week.containing(Date())
    @State private var data = Observed(PlanData())

    var body: some View {
        NavigationStack {
            ScrollView {
                let columns = width == .regular
                    ? [GridItem(.adaptive(minimum: 280), spacing: 18, alignment: .top)]
                    : [GridItem(.flexible())]
                LazyVGrid(columns: columns, alignment: .leading, spacing: width == .regular ? 18 : 12) {
                    ForEach(0..<7, id: \.self) { day in
                        DayCard(date: week.day(day), isToday: Calendar.current.isDateInToday(week.day(day)),
                                meals: data.value.meals(on: day, in: week), delete: delete)
                    }
                }
                .padding(width == .regular ? 20 : 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(week.title)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Previous week", systemImage: "chevron.left") { week = week.adding(-1) }
                    if !week.isCurrent {
                        Button("This week") { week = Week.containing(Date()) }
                    }
                    Button("Next week", systemImage: "chevron.right") { week = week.adding(1) }
                }
            }
            .refreshable { await app.syncNow() }
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
        }
        .task { await data.follow(app.store, PlanData.load) }
    }

    private func delete(_ entry: MealPlanEntry) {
        Task {
            await app.mutate("meal_plan_entry.delete", payload: .object(["entryId": .string(entry.id)]),
                             optimistic: [.remove(.mealPlanEntries, id: entry.id)])
        }
    }
}

/// A Monday-to-Sunday week, keyed as the server keys meal plans ("yyyy-MM-dd").
struct Week: Hashable {
    var monday: Date

    static func containing(_ date: Date) -> Week {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        let start = calendar.dateInterval(of: .weekOfYear, for: date)!.start
        return Week(monday: start)
    }

    /// In the local calendar: an ISO-8601 formatter writes UTC, which turns
    /// midnight on a British Summer Time Monday into Sunday's date.
    var key: String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: monday)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    func day(_ index: Int) -> Date { Calendar.current.date(byAdding: .day, value: index, to: monday)! }
    func adding(_ weeks: Int) -> Week { Week(monday: Calendar.current.date(byAdding: .day, value: 7 * weeks, to: monday)!) }
    var isCurrent: Bool { self == Week.containing(Date()) }

    var title: String {
        if isCurrent { return "This week" }
        if self == Week.containing(Date()).adding(1) { return "Next week" }
        if self == Week.containing(Date()).adding(-1) { return "Last week" }
        return "w/c " + monday.formatted(.dateTime.day().month(.abbreviated))
    }
}

/// One slot in a day: a combined meal with its dishes, or a single dish.
struct PlannedMeal: Identifiable {
    var id: String
    var mealType: String
    var title: String?
    var serveAt: String?
    var dishes: [(entry: MealPlanEntry, recipe: Recipe?)]
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

    func meals(on day: Int, in week: Week) -> [PlannedMeal] {
        guard let plan = plans.first(where: { $0.weekStartDate == week.key }) else { return [] }
        let todays = entries.filter { $0.mealPlanId == plan.id && $0.dayOfWeek == day }
        var meals: [PlannedMeal] = []
        for group in groups where group.mealPlanId == plan.id && group.dayOfWeek == day {
            let dishes = todays.filter { $0.groupId == group.id }.map { ($0, $0.recipeId.flatMap { recipes[$0] }) }
            meals.append(PlannedMeal(id: group.id, mealType: group.mealType, title: group.title, serveAt: group.serveAt,
                                     dishes: dishes))
        }
        for entry in todays where entry.groupId == nil || !groups.contains(where: { $0.id == entry.groupId }) {
            meals.append(PlannedMeal(id: entry.id, mealType: entry.mealType, title: nil, serveAt: nil,
                                     dishes: [(entry, entry.recipeId.flatMap { recipes[$0] })]))
        }
        return meals.sorted {
            (mealTypeOrder.firstIndex(of: $0.mealType) ?? 9, $0.id) < (mealTypeOrder.firstIndex(of: $1.mealType) ?? 9, $1.id)
        }
    }
}

struct DayCard: View {
    let date: Date
    let isToday: Bool
    let meals: [PlannedMeal]
    let delete: (MealPlanEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(date.formatted(.dateTime.weekday(.wide)))
                    .font(.title3.bold())
                Text(date.formatted(.dateTime.day().month(.abbreviated)))
                    .foregroundStyle(.secondary)
                Spacer()
                if isToday {
                    Text("Today")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Theme.brandGradient, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            if meals.isEmpty {
                Text("Nothing planned")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
            ForEach(meals) { meal in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(meal.mealType.capitalized)
                            .font(.caption.weight(.bold))
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.brandDeep)
                        if let title = meal.title { Text("· \(title)").font(.caption.weight(.semibold)) }
                        if let serveAt = meal.serveAt {
                            Label(serveAt, systemImage: "clock").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(meal.dishes, id: \.entry.id) { dish in
                        dishRow(dish.entry, dish.recipe)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(tint: isToday ? Theme.brand : .gray)
    }

    @ViewBuilder
    private func dishRow(_ entry: MealPlanEntry, _ recipe: Recipe?) -> some View {
        let label = HStack(spacing: 10) {
            if let recipe {
                RecipeImage(recipe: recipe)
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            Text(recipe?.title ?? entry.notes ?? "A meal")
                .font(.body.weight(.medium))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button("Remove from plan", systemImage: "trash", role: .destructive) { delete(entry) }
        }
        if let recipe {
            NavigationLink(value: recipe.id) { label }.buttonStyle(.plain)
        } else {
            label
        }
    }
}
