// The meal planner, as the web's /meal-plan: week arrows and the orange +, a
// strip of seven day pills, the gradient action buttons, then the chosen day's
// meals as the web's entry cards — a combined meal as one card with its dishes.
//
// Read from the local store, so paging weeks needs no network. Adding and
// removing a dish are sync mutations (`meal_plan_entry.add` / `.delete`), so
// they work offline too; "Add N meals to list" calls the server, as on the
// web, because pantry stock decides what it adds. AI planning stays on the web.

import DishesCore
import SwiftUI

struct PlanScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.openURL) private var openURL
    @State private var week = Week.containing(Date())
    @State private var selectedDay = Week.todayIndex
    @State private var data = Observed(PlanData())
    @State private var adding = false
    @State private var sending = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    dayStrip
                    actions
                    dayDetail
                }
                .padding(.horizontal, width == .regular ? 28 : 16)
                .padding(.vertical, 18)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
            .sheet(isPresented: $adding) {
                AddMealSheet(week: week, day: selectedDay, plan: data.value.plan(for: week))
            }
        }
        .task { await data.follow(app.store, PlanData.load) }
    }

    // MARK: Header

    private var header: some View {
        let entries = data.value.entries(in: week)
        let minutes = entries.compactMap { $0.recipeId.flatMap { data.value.recipes[$0]?.totalMinutes } }.reduce(0, +)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Button { move(-1) } label: { Image(systemName: "chevron.left").font(.system(size: 17, weight: .medium)) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Previous week")
                Text(week.title)
                    .font(.system(size: 22, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if !week.isCurrent {
                    Button("Today") { week = Week.containing(Date()); selectedDay = Week.todayIndex }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.brand)
                }
                Spacer(minLength: 4)
                Button { move(1) } label: { Image(systemName: "chevron.right").font(.system(size: 17, weight: .medium)) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Next week")
                RoundAddButton { adding = true }
            }
            .foregroundStyle(Theme.foreground)
            Text(entries.isEmpty
                 ? "Nothing planned yet"
                 : "\(entries.count) meal\(entries.count == 1 ? "" : "s")" + (Format.shortMinutes(minutes).map { " · \($0) cooking" } ?? ""))
                .font(.system(size: 14))
                .foregroundStyle(Theme.mutedForeground)
                .padding(.leading, 28)
        }
    }

    private func move(_ weeks: Int) {
        week = week.adding(weeks)
        selectedDay = week.isCurrent ? Week.todayIndex : 0
    }

    // MARK: Day strip (week-planner.tsx DayChip)

    private var dayStrip: some View {
        HStack(spacing: width == .regular ? 10 : 6) {
            ForEach(0..<7, id: \.self) { day in
                let date = week.day(day)
                let isToday = Calendar.current.isDateInToday(date)
                let selected = day == selectedDay
                let count = data.value.meals(on: day, in: week).count
                Button { selectedDay = day } label: {
                    VStack(spacing: 4) {
                        Text(date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(0.4)
                            .foregroundStyle(selected || isToday ? Theme.brand : Theme.mutedForeground)
                        Text(date.formatted(.dateTime.day()))
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(selected ? Theme.brand : isToday ? Theme.brand.opacity(0.8) : Theme.foreground)
                        Text(count > 0 ? "\(count)" : " ")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.brandDeep)
                            .frame(minWidth: 16, minHeight: 14)
                            .background(count > 0 ? Theme.brand.opacity(0.15) : .clear, in: Capsule())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(selected || isToday ? Theme.orange50.opacity(selected ? 1 : 0.6) : Theme.muted.opacity(0.4),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(selected ? Color(hex: 0xFB923C) : isToday ? Color(hex: 0xFDBA74).opacity(0.6) : .clear,
                                      lineWidth: 2))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Actions

    private var actions: some View {
        let plan = data.value.plan(for: week)
        let notOnList = data.value.entries(in: week).filter { $0.addedToShoppingListAt == nil }.count
        return HStack(spacing: 10) {
            Button {
                openURL(AppModel.serverURL.appendingPathComponent("meal-plan"))
            } label: {
                Label("Generate plan", systemImage: "sparkles")
            }
            .buttonStyle(.gradient(.violetOrange))

            Button {
                guard let plan else { return }
                Task { await addToList(plan) }
            } label: {
                Label(sending ? "Adding…" : notOnList > 0 ? "Add \(notOnList) meal\(notOnList == 1 ? "" : "s") to list" : "All on the list",
                      systemImage: "cart")
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .buttonStyle(.gradient(.blueSky))
            .disabled(plan == nil || notOnList == 0 || sending)
            .opacity(plan == nil || notOnList == 0 ? 0.6 : 1)
        }
    }

    private func addToList(_ plan: MealPlan) async {
        sending = true
        defer { sending = false }
        do {
            let result = try await app.api.addWeekToShopping(mealPlanId: plan.id)
            app.toast = result.added + result.merged == 0
                ? "Everything’s already on the list."
                : "Added \(result.added) item\(result.added == 1 ? "" : "s")" + (result.merged > 0 ? ", topped up \(result.merged)" : "") + "."
            await app.syncNow()
        } catch {
            app.toast = app.online ? "Couldn’t add the week to the list." : "You’re offline — adding the week needs a connection."
        }
    }

    // MARK: The chosen day

    private var dayDetail: some View {
        let date = week.day(selectedDay)
        let meals = data.value.meals(on: selectedDay, in: week)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(Calendar.current.isDateInToday(date) ? Theme.brand : Theme.foreground)
                if Calendar.current.isDateInToday(date) {
                    Text("Today")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.orange50, in: Capsule())
                        .overlay(Capsule().strokeBorder(Color(hex: 0xFED7AA)))
                        .foregroundStyle(Theme.brandDeep)
                }
            }
            .padding(.top, 6)

            if meals.isEmpty {
                EmptyBox(message: "No meals planned for this day")
            }
            ForEach(meals) { meal in
                if meal.title != nil {
                    MealGroupCard(meal: meal, delete: delete, cook: cook)
                } else if let dish = meal.dishes.first {
                    EntryCard(entry: dish.entry, recipe: dish.recipe, delete: delete) { cook(meal) }
                }
            }

            Button { adding = true } label: { Label("Add meal", systemImage: "plus") }
                .buttonStyle(.gradient(.violetIndigo))
                .padding(.top, 4)
        }
    }

    private func delete(_ entry: MealPlanEntry) {
        Task {
            await app.mutate("meal_plan_entry.delete", payload: .object(["entryId": .string(entry.id)]),
                             optimistic: [.remove(.mealPlanEntries, id: entry.id)])
        }
    }

    /// A meal cooks as one: every dish as a tab, timers pooled.
    private func cook(_ meal: PlannedMeal) {
        let dishes = meal.dishes.compactMap(\.recipe).filter { !$0.steps.isEmpty }.map { CookDish(recipe: $0) }
        guard !dishes.isEmpty else { return }
        nav.cooking = CookRequest(title: meal.title, dishes: dishes)
    }
}

// MARK: Cards (meal-plan/_components/entry-card.tsx, meal-group-card.tsx)

/// The web's entry card: photo on the left, meal-type pill, bold title, time
/// and servings, and a menu on a divided strip at the right.
struct EntryCard: View {
    let entry: MealPlanEntry
    let recipe: Recipe?
    let delete: (MealPlanEntry) -> Void
    let cook: () -> Void
    var showsType = true

    var body: some View {
        HStack(spacing: 0) {
            NavigationLink(value: recipe?.id ?? "") {
                HStack(spacing: 0) {
                    Group {
                        if let recipe {
                            RecipeImage(recipe: recipe)
                        } else {
                            ZStack { Theme.muted; Text("🍽").font(.system(size: 28)).opacity(0.4) }
                        }
                    }
                    .frame(width: 96, height: 96)
                    .clipped()

                    VStack(alignment: .leading, spacing: 5) {
                        if showsType { MealTypePill(type: entry.mealType) }
                        if entry.addedToShoppingListAt != nil {
                            Label("On list", systemImage: "checkmark")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Theme.emerald100, in: Capsule())
                                .foregroundStyle(Theme.emerald700)
                                .labelStyle(TightLabel())
                        }
                        Text(recipe?.title ?? entry.notes ?? "A meal")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 12) {
                            if let time = Format.shortMinutes(recipe?.totalMinutes) {
                                Label(time, systemImage: "clock")
                            }
                            if let servings = entry.servings ?? recipe?.servings {
                                Label("Serves \(Format.amount(String(servings)) ?? "")", systemImage: "person.2")
                            }
                        }
                        .labelStyle(TightLabel())
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .buttonStyle(.plain)
            .disabled(recipe == nil)

            Rectangle().fill(Theme.border).frame(width: 1)
            Menu {
                if recipe?.steps.isEmpty == false {
                    Button("Cook", systemImage: "frying.pan", action: cook)
                }
                Button("Remove from plan", systemImage: "trash", role: .destructive) { delete(entry) }
            } label: {
                Image(systemName: "ellipsis")
                    .rotationEffect(.degrees(90))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 40, height: 96)
                    .contentShape(Rectangle())
            }
        }
        .frame(height: 96)
        .card()
    }
}

/// bg-{meal}-50 text-{meal}-500 rounded-full with the meal's icon.
struct MealTypePill: View {
    let type: String

    var body: some View {
        Label(type.capitalized, systemImage: Theme.mealIcon(type))
            .labelStyle(TightLabel())
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Theme.mealBackground(type), in: Capsule())
            .foregroundStyle(Theme.mealColor(type))
    }
}

/// A combined meal: its name, meal type and serve-at time, Cook, then each dish.
struct MealGroupCard: View {
    let meal: PlannedMeal
    let delete: (MealPlanEntry) -> Void
    let cook: (PlannedMeal) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                MealTypePill(type: meal.mealType)
                Text(meal.title ?? "Meal").font(.system(size: 16, weight: .bold))
                if let serveAt = meal.serveAt {
                    Label(serveAt, systemImage: "alarm")
                        .labelStyle(TightLabel())
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.amber50, in: Capsule())
                        .foregroundStyle(Color(hex: 0xB45309))
                }
                Spacer()
                if meal.dishes.contains(where: { $0.recipe?.steps.isEmpty == false }) {
                    Button { cook(meal) } label: {
                        Label("Cook", systemImage: "frying.pan").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(GradientButtonStyle(gradient: .brand, height: 32))
                    .fixedSize()
                }
            }
            ForEach(meal.dishes, id: \.entry.id) { dish in
                EntryCard(entry: dish.entry, recipe: dish.recipe, delete: delete, cook: { cook(meal) }, showsType: false)
            }
        }
        .padding(12)
        .callout(Theme.orange50, Theme.rose50, border: Color(hex: 0xFED7AA).opacity(0.7))
    }
}

// MARK: Adding a meal

/// Pick a meal type and a recipe; the entry is added offline with a temporary
/// id (and a temporary plan, when the week has none yet) that the next sync
/// replaces with the server's — the temp-id flow from Phase B.
struct AddMealSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let week: Week
    let day: Int
    let plan: MealPlan?
    @State private var recipes = Observed<[Recipe]>([])
    @State private var search = ""
    @State private var mealType = "dinner"

    private var shown: [Recipe] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        return recipes.value.filter { r in
            words.isEmpty || words.allSatisfy(([r.title, r.cuisine ?? ""] + r.tags).joined(separator: " ").lowercased().contains)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Meal", selection: $mealType) {
                    ForEach(mealTypeOrder, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                SearchField(prompt: "Search recipes…", text: $search)
                List(shown) { recipe in
                    Button { add(recipe) } label: {
                        HStack(spacing: 12) {
                            RecipeImage(recipe: recipe)
                                .frame(width: 52, height: 52)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(recipe.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.foreground)
                                Text([recipe.cuisine, Format.shortMinutes(recipe.totalMinutes)].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                            Image(systemName: "plus.circle.fill").foregroundStyle(Theme.brand).font(.system(size: 20))
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                }
                .listStyle(.plain)
            }
            .padding(16)
            .background(Theme.background)
            .navigationTitle("Add to \(week.day(day).formatted(.dateTime.weekday(.wide)))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .task {
            await recipes.follow(app.store) { r in
                try r.records(.recipes).compactMap(Recipe.init)
                    .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
        }
    }

    private func add(_ recipe: Recipe) {
        let planId = plan?.id ?? "temp-plan-\(UUID().uuidString.lowercased())"
        var optimistic: [OptimisticChange] = []
        if plan == nil {
            optimistic.append(.put(.mealPlans, .object(["id": .string(planId), "weekStartDate": .string(week.key)]),
                                   temporary: true))
        }
        optimistic.append(.put(.mealPlanEntries, .object([
            "id": .string("temp-entry-\(UUID().uuidString.lowercased())"),
            "mealPlanId": .string(planId), "recipeId": .string(recipe.id),
            "dayOfWeek": .number(Double(day)), "mealType": .string(mealType),
        ]), temporary: true))
        Task {
            await app.mutate("meal_plan_entry.add",
                             payload: .object(["weekStartDate": .string(week.key), "recipeId": .string(recipe.id),
                                               "dayOfWeek": .number(Double(day)), "mealType": .string(mealType)]),
                             optimistic: optimistic)
            app.toast = "Added \(recipe.title)."
            dismiss()
        }
    }
}

// MARK: Data

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
    static var todayIndex: Int { (Calendar(identifier: .iso8601).component(.weekday, from: Date()) + 5) % 7 }

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

    func plan(for week: Week) -> MealPlan? { plans.first { $0.weekStartDate == week.key } }

    func entries(in week: Week) -> [MealPlanEntry] {
        guard let plan = plan(for: week) else { return [] }
        return entries.filter { $0.mealPlanId == plan.id }
    }

    func meals(on day: Int, in week: Week) -> [PlannedMeal] {
        guard let plan = plan(for: week) else { return [] }
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
