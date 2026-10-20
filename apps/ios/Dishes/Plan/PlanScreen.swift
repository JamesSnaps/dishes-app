// The meal planner, as the web's /meal-plan: week arrows and the orange +, a
// strip of seven day pills, the gradient action buttons, then the chosen day's
// meals as the web's entry cards — a combined meal as one card with its dishes.
//
// With room for it (≥1000pt: an iPad in landscape, or the 13-inch either way)
// the whole week shows at once instead — seven day columns, each with its
// meals and its own +. A layout the web could take up too.
//
// Read from the local store, so paging weeks needs no network. Adding and
// removing a dish are sync mutations (`meal_plan_entry.add` / `.delete`), so
// they work offline too; "Add N meals to list" calls the server, as on the
// web, because pantry stock decides what it adds; so does AI planning.

import AppIntents
import DishesCore
import SwiftUI

struct PlanScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @State private var week = Week.containing(Date())
    @State private var selectedDay = Week.todayIndex
    @State private var data = Observed(PlanData())
    @State private var adding = false
    @State private var generating = false
    @State private var sending = false
    @State private var pageWidth: CGFloat = 0
    /// The day column a dragged meal is over.
    @State private var dropTarget: Int?
    @State private var extras = PlanWeekExtras()

    private var wholeWeek: Bool { pageWidth >= 1000 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if wholeWeek {
                        actions.frame(maxWidth: 640)
                        weekStrips
                        weekGrid
                    } else {
                        dayStrip
                        actions
                        weekStrips
                        dayDetail
                    }
                }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.vertical, 18)
                .frame(maxWidth: wholeWeek ? .infinity : 900)
                .frame(maxWidth: .infinity)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
            .navigationDestination(for: MealLink.self) { link in
                if let meal = data.value.meals(on: link.day, in: link.week).first(where: { $0.id == link.id }) {
                    MealDetailView(meal: meal, isToday: Calendar.current.isDateInToday(link.week.day(link.day)),
                                   delete: delete, cook: cook)
                } else {
                    EmptyBox(message: "This meal isn’t on the plan any more")
                }
            }
            .environment(\.planActions, planActions)
            .sheet(isPresented: $generating) {
                PlanGeneratorSheet(week: week, planned: Set((0..<7).filter { day in
                    data.value.meals(on: day, in: week).contains { $0.mealType == "dinner" }
                }))
                .presentationSizing(.page)
            }
            .sheet(isPresented: $adding) {
                AddMealSheet(week: week, day: selectedDay, plan: data.value.plan(for: week))
            }
        }
        .task { await data.follow(app.store, PlanData.load) }
        // Dinner times and deliveries for the week, reloaded when its dinners change.
        .task(id: extrasKey) { await extras.load(week: week.key, dinnerRecipeIds: dinnerRecipes.flatMap { $0 }.map(\.id)) }
    }

    /// Each day's dinner dishes, Monday first.
    private var dinnerRecipes: [[Recipe]] {
        (0..<7).map { day in
            data.value.meals(on: day, in: week).filter { $0.mealType == "dinner" }.flatMap { $0.dishes.compactMap(\.recipe) }
        }
    }

    private var extrasKey: String {
        week.key + dinnerRecipes.map { $0.map(\.id).joined(separator: ",") }.joined(separator: "|")
            + "#\(data.value.entries(in: week).filter { $0.addedToShoppingListAt == nil }.count)"
    }

    private func reloadExtras() async {
        await extras.load(week: week.key, dinnerRecipeIds: dinnerRecipes.flatMap { $0 }.map(\.id))
    }

    /// Heart-healthy and next-order banners for the week.
    private var weekStrips: some View {
        PlanWeekStrips(extras: extras, reload: reloadExtras, swapped: reloadExtras)
    }

    /// The dinner-time and delivery chips for a day, when the server has them.
    @ViewBuilder private func dayChips(_ day: Int, compact: Bool = false) -> some View {
        if let dinner = extras.dinner?.days.first(where: { $0.dayOfWeek == day }) {
            DinnerTimeChip(date: week.day(day), day: dinner, dishes: dinnerRecipes[day],
                           estimates: extras.dinner?.estimates ?? [:], scheduled: extras.dinner?.scheduled?[String(day)],
                           compact: compact) { extras.update($0) }
        }
        if let panel = extras.deliveries, let delivery = panel.days.first(where: { $0.date == localDateKey(week.day(day)) }) {
            DeliveryDayChip(day: delivery, canEdit: panel.canEdit) {
                await extras.load(week: week.key, dinnerRecipeIds: dinnerRecipes.flatMap { $0 }.map(\.id))
            }
        }
    }

    // MARK: Header

    private var header: some View {
        let entries = data.value.entries(in: week)
        let minutes = entries.compactMap { $0.recipeId.flatMap { data.value.recipes[$0]?.totalMinutes } }.reduce(0, +)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                // Spring-loaded: drag a meal over an arrow and the week flips,
                // so it can be dropped into another week.
                Button { move(-1) } label: { Image(systemName: "chevron.left").font(.system(size: 17, weight: .medium)).frame(width: 36, height: 36).contentShape(Rectangle()) }
                    .springLoadingBehavior(.enabled)
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
                Button { move(1) } label: { Image(systemName: "chevron.right").font(.system(size: 17, weight: .medium)).frame(width: 36, height: 36).contentShape(Rectangle()) }
                    .springLoadingBehavior(.enabled)
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
            Button { generating = true } label: {
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
            FlowLayout(spacing: 8) { dayChips(selectedDay) }

            if meals.isEmpty {
                EmptyBox(message: "No meals planned for this day")
            }
            ForEach(meals) { meal in
                Group {
                    if meal.title != nil {
                        MealGroupCard(meal: meal, delete: delete, cook: cook)
                    } else if let dish = meal.dishes.first {
                        EntryCard(entry: dish.entry, recipe: dish.recipe, delete: delete) { cook(meal) }
                    }
                }
                .appEntityIdentifier(EntityIdentifier(for: PlannedMealEntity.self, identifier: meal.id))
            }

            Button { adding = true } label: { Label("Add meal", systemImage: "plus") }
                .buttonStyle(.gradient(.violetIndigo))
                .padding(.top, 4)
        }
    }

    // MARK: The whole week (wide screens)

    private var weekGrid: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(0..<7, id: \.self) { day in
                let date = week.day(day)
                let isToday = Calendar.current.isDateInToday(date)
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.5)
                            .foregroundStyle(isToday ? Theme.brand : Theme.mutedForeground)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(date.formatted(.dateTime.day()))
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(isToday ? Theme.brand : Theme.foreground)
                            if isToday {
                                Text("Today")
                                    .font(.system(size: 11, weight: .semibold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 1)
                                    .background(Theme.orange50, in: Capsule())
                                    .foregroundStyle(Theme.brandDeep)
                            }
                        }
                        VStack(alignment: .leading, spacing: 6) { dayChips(day, compact: true) }
                    }
                    .padding(.horizontal, 4)

                    ForEach(data.value.meals(on: day, in: week)) { meal in
                        WeekMealCard(meal: meal, link: MealLink(id: meal.id, week: week, day: day), delete: delete, cook: cook)
                            .draggable((meal.title == nil ? "entry:" : "group:") + meal.id)
                            // For Siri: "add this to the shopping list" about the card on screen.
                            .appEntityIdentifier(EntityIdentifier(for: PlannedMealEntity.self, identifier: meal.id))
                    }

                    Button {
                        selectedDay = day
                        adding = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .foregroundStyle(Theme.mutedForeground)
                            .background(Theme.muted.opacity(0.25), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add a meal on \(date.formatted(.dateTime.weekday(.wide)))")
                }
                .padding(10)
                // A week reads as a week even when it's mostly empty.
                .frame(maxWidth: .infinity, minHeight: 420, alignment: .top)
                .dropDestination(for: String.self) { items, _ in
                    drop(items, on: day)
                } isTargeted: { over in
                    dropTarget = over ? day : (dropTarget == day ? nil : dropTarget)
                }
                .overlay {
                    if dropTarget == day {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Theme.brand, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    }
                }
                .background(isToday ? Theme.orange50.opacity(0.5) : Theme.muted.opacity(0.3),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isToday ? Color(hex: 0xFDBA74).opacity(0.7) : .clear, lineWidth: 1.5))
            }
        }
    }

    /// A meal card dropped on a day column ("entry:<id>" or "group:<id>").
    private func drop(_ items: [String], on day: Int) -> Bool {
        dropTarget = nil
        guard let item = items.first else { return false }
        if item.hasPrefix("entry:"), let entry = data.value.entries.first(where: { $0.id == String(item.dropFirst(6)) }) {
            guard entry.dayOfWeek != day else { return false }
            moveEntry(entry, to: day, in: week)
            return true
        }
        if item.hasPrefix("group:") {
            let id = String(item.dropFirst(6))
            guard let meal = (0..<7).flatMap({ data.value.meals(on: $0, in: week) }).first(where: { $0.id == id }) else {
                // Dragged here from another week: the server moves a combined meal
                // within its own week only (meal_plan_group.update has no week).
                if data.value.groups.contains(where: { $0.id == id }) {
                    app.toast = "Combined meals move within their week for now — move its dishes one by one."
                }
                return false
            }
            moveGroup(meal, to: day)
            return true
        }
        return false
    }

    // MARK: Changes (sync mutations, so they work offline)

    private var planActions: PlanActions {
        PlanActions(week: week, move: moveEntry, setMealType: setMealType, setServings: setServings, moveGroup: moveGroup,
                    updateGroup: updateGroup, deleteGroup: deleteGroup)
    }

    /// An entry made offline has a placeholder id until it syncs; the server
    /// can't change what it hasn't seen yet.
    private func ready(_ id: String) -> Bool {
        if id.hasPrefix("temp-") { app.toast = "Still saving that one — try again in a moment."; return false }
        return true
    }

    private func moveEntry(_ entry: MealPlanEntry, to day: Int, in target: Week) {
        guard ready(entry.id) else { return }
        // Compare with the week the entry is in, not the one on screen: a drag
        // can flip the screen to another week before it drops.
        let entryWeek = data.value.plans.first { $0.id == entry.mealPlanId }?.weekStartDate
        let sameWeek = target.key == entryWeek
        var payload: [String: JSONValue] = ["entryId": .string(entry.id), "dayOfWeek": .number(Double(day))]
        if !sameWeek { payload["weekStartDate"] = .string(target.key) }
        Task {
            let current = try? await app.store.read { try $0.record(.mealPlanEntries, id: entry.id) }
            var optimistic: [OptimisticChange] = []
            if let current {
                if sameWeek {
                    optimistic = [.put(.mealPlanEntries, current.merging(.object(["dayOfWeek": .number(Double(day))])))]
                } else if let plan = data.value.plan(for: target) {
                    optimistic = [.put(.mealPlanEntries, current.merging(.object([
                        "dayOfWeek": .number(Double(day)), "mealPlanId": .string(plan.id), "groupId": .null])))]
                } else {
                    // No plan for that week on the device yet: it appears there after the sync.
                    optimistic = [.remove(.mealPlanEntries, id: entry.id)]
                }
            }
            await app.mutate("meal_plan_entry.update", payload: .object(payload), optimistic: optimistic)
            if !sameWeek { app.toast = "Moved to \(target.day(day).formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))." }
        }
    }

    private func setMealType(_ entry: MealPlanEntry, _ type: String) {
        guard ready(entry.id) else { return }
        patch(entry, ["mealType": .string(type)])
    }

    private func setServings(_ entry: MealPlanEntry, _ servings: Double?) {
        guard ready(entry.id) else { return }
        patch(entry, ["servings": servings.map { .number($0) } ?? .null])
    }

    private func patch(_ entry: MealPlanEntry, _ fields: [String: JSONValue]) {
        Task {
            let current = try? await app.store.read { try $0.record(.mealPlanEntries, id: entry.id) }
            await app.mutate("meal_plan_entry.update",
                             payload: JSONValue.object(["entryId": .string(entry.id)]).merging(.object(fields)),
                             optimistic: current.map { [.put(.mealPlanEntries, $0.merging(.object(fields)))] } ?? [])
        }
    }

    /// A combined meal moves as one; its dishes follow on the server.
    private func moveGroup(_ meal: PlannedMeal, to day: Int) {
        guard ready(meal.id) else { return }
        Task {
            var optimistic: [OptimisticChange] = []
            if let group = try? await app.store.read({ try $0.record(.mealPlanGroups, id: meal.id) }) {
                optimistic.append(.put(.mealPlanGroups, group.merging(.object(["dayOfWeek": .number(Double(day))]))))
            }
            for dish in meal.dishes {
                if let row = try? await app.store.read({ try $0.record(.mealPlanEntries, id: dish.entry.id) }) {
                    optimistic.append(.put(.mealPlanEntries, row.merging(.object(["dayOfWeek": .number(Double(day))]))))
                }
            }
            await app.mutate("meal_plan_group.update",
                             payload: .object(["groupId": .string(meal.id), "dayOfWeek": .number(Double(day))]),
                             optimistic: optimistic)
        }
    }

    private func updateGroup(_ meal: PlannedMeal, _ fields: [String: JSONValue]) {
        guard ready(meal.id) else { return }
        Task {
            var optimistic: [OptimisticChange] = []
            if let group = try? await app.store.read({ try $0.record(.mealPlanGroups, id: meal.id) }) {
                optimistic.append(.put(.mealPlanGroups, group.merging(.object(fields.filter { $0.key != "servings" }))))
            }
            // The dishes follow the meal's type and servings on the server.
            let follow = fields.filter { $0.key == "mealType" || $0.key == "servings" }
            if !follow.isEmpty {
                for dish in meal.dishes {
                    if let row = try? await app.store.read({ try $0.record(.mealPlanEntries, id: dish.entry.id) }) {
                        optimistic.append(.put(.mealPlanEntries, row.merging(.object(follow))))
                    }
                }
            }
            await app.mutate("meal_plan_group.update",
                             payload: JSONValue.object(["groupId": .string(meal.id)]).merging(.object(fields)),
                             optimistic: optimistic)
        }
    }

    private func deleteGroup(_ meal: PlannedMeal, keepRecipes: Bool) {
        guard ready(meal.id) else { return }
        Task {
            var optimistic: [OptimisticChange] = [.remove(.mealPlanGroups, id: meal.id)]
            for dish in meal.dishes {
                if keepRecipes {
                    if let row = try? await app.store.read({ try $0.record(.mealPlanEntries, id: dish.entry.id) }) {
                        optimistic.append(.put(.mealPlanEntries, row.merging(.object(["groupId": .null]))))
                    }
                } else {
                    optimistic.append(.remove(.mealPlanEntries, id: dish.entry.id))
                }
            }
            await app.mutate("meal_plan_group.delete",
                             payload: .object(["groupId": .string(meal.id), "keepRecipes": .bool(keepRecipes)]),
                             optimistic: optimistic)
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
        let dishes = CookDish.inStartOrder(meal.dishes.compactMap(\.recipe).filter { !$0.steps.isEmpty })
        guard !dishes.isEmpty else { return }
        nav.cooking = CookRequest(title: meal.title, groupId: meal.groupId, dishes: dishes)
    }
}

// MARK: Actions shared by every card

/// What a card can do to the plan, passed down by PlanScreen.
struct PlanActions {
    var week: Week
    var move: (MealPlanEntry, Int, Week) -> Void
    var setMealType: (MealPlanEntry, String) -> Void
    var setServings: (MealPlanEntry, Double?) -> Void
    var moveGroup: (PlannedMeal, Int) -> Void
    /// Title, meal type or servings for a whole meal (`meal_plan_group.update`).
    var updateGroup: (PlannedMeal, [String: JSONValue]) -> Void
    /// Remove a meal, or split it back into separate dishes (`keepRecipes`).
    var deleteGroup: (PlannedMeal, Bool) -> Void
}

extension EnvironmentValues {
    @Entry var planActions: PlanActions?
}

/// Move to another day (this week or the next), change the meal, set servings —
/// the web entry card's menu.
struct EntryMenuItems: View {
    @Environment(\.planActions) private var actions
    let entry: MealPlanEntry
    var recipeServings: Double?

    var body: some View {
        if let actions {
            Menu("Move to", systemImage: "arrow.right.circle") {
                Section("This week") {
                    ForEach(0..<7, id: \.self) { day in
                        Button(actions.week.day(day).formatted(.dateTime.weekday(.wide))) { actions.move(entry, day, actions.week) }
                            .disabled(day == entry.dayOfWeek)
                    }
                }
                Section("Next week") {
                    ForEach(0..<7, id: \.self) { day in
                        let next = actions.week.adding(1)
                        Button(next.day(day).formatted(.dateTime.weekday(.wide).day().month(.abbreviated))) { actions.move(entry, day, next) }
                    }
                }
            }
            Menu("Meal", systemImage: Theme.mealIcon(entry.mealType)) {
                ForEach(mealTypeOrder, id: \.self) { type in
                    Button(type.capitalized, systemImage: entry.mealType == type ? "checkmark" : Theme.mealIcon(type)) {
                        actions.setMealType(entry, type)
                    }
                }
            }
            Menu("Servings", systemImage: "person.2") {
                Button("Recipe’s own" + (recipeServings.map { " (\(Format.amount(String($0)) ?? ""))" } ?? ""),
                       systemImage: entry.servings == nil ? "checkmark" : "arrow.uturn.backward") {
                    actions.setServings(entry, nil)
                }
                ForEach([1, 2, 3, 4, 5, 6, 8, 10], id: \.self) { n in
                    Button("\(n)", systemImage: entry.servings == Double(n) ? "checkmark" : "") { actions.setServings(entry, Double(n)) }
                }
            }
        }
    }
}

// MARK: Cards (meal-plan/_components/entry-card.tsx, meal-group-card.tsx)

/// A meal in a week column: the photo on top, then the meal-type pill, the
/// title and the time — the entry card stood upright for a narrow column.
/// A combined meal lists its dishes. Long-press for Cook and Remove.
/// Where a combined meal's card leads: its own page, not its first dish.
struct MealLink: Hashable {
    var id: String
    var week: Week
    var day: Int
}

struct WeekMealCard: View {
    @Environment(\.planActions) private var actions
    let meal: PlannedMeal
    let link: MealLink
    let delete: (MealPlanEntry) -> Void
    let cook: (PlannedMeal) -> Void

    private var lead: Recipe? {
        meal.dishes.first(where: { $0.recipe?.imageUrl != nil })?.recipe ?? meal.dishes.first?.recipe
    }

    /// The card is the link's own label (not a link laid over it), so a long
    /// press can lift it for dragging between days.
    var body: some View {
        Group {
            if meal.title != nil {
                NavigationLink(value: link) { content }.buttonStyle(.plain)
            } else if let lead {
                NavigationLink(value: lead.id) { content }.buttonStyle(.plain)
            } else {
                content
            }
        }
        .contextMenu { menu }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let lead {
                Color.clear
                    .frame(height: 92)
                    .overlay { RecipeImage(recipe: lead) }
                    .clipped()
            }
            VStack(alignment: .leading, spacing: 5) {
                MealTypePill(type: meal.mealType)
                if let title = meal.title {
                    Text(title).font(.system(size: 14, weight: .bold)).lineLimit(2)
                    ForEach(meal.dishes, id: \.entry.id) { dish in
                        Text("· \(dish.recipe?.title ?? "A dish")")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.mutedForeground)
                            .lineLimit(1)
                    }
                } else if let dish = meal.dishes.first {
                    Text(dish.recipe?.title ?? dish.entry.notes ?? "A meal")
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(3)
                    if let time = Format.shortMinutes(dish.recipe?.totalMinutes) {
                        Label(time, systemImage: "clock")
                            .labelStyle(TightLabel())
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
            }
            .foregroundStyle(Theme.foreground)
            .padding(9)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(radius: 10)
    }

    @ViewBuilder private var menu: some View {
            if meal.dishes.contains(where: { $0.recipe?.steps.isEmpty == false }) {
                Button("Cook", systemImage: "frying.pan") { cook(meal) }
            }
            if meal.title == nil, let dish = meal.dishes.first {
                EntryMenuItems(entry: dish.entry, recipeServings: dish.recipe?.servings)
            } else if let actions {
                Menu("Move to", systemImage: "arrow.right.circle") {
                    ForEach(0..<7, id: \.self) { day in
                        Button(actions.week.day(day).formatted(.dateTime.weekday(.wide))) { actions.moveGroup(meal, day) }
                    }
                }
            }
            Divider()
            ForEach(meal.dishes, id: \.entry.id) { dish in
                Button("Remove \(dish.recipe?.title ?? "dish")", systemImage: "trash", role: .destructive) { delete(dish.entry) }
            }
    }
}

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
                EntryMenuItems(entry: entry, recipeServings: recipe?.servings)
                Divider()
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
                MealMenu(meal: meal)
            }
            ForEach(meal.dishes, id: \.entry.id) { dish in
                EntryCard(entry: dish.entry, recipe: dish.recipe, delete: delete, cook: { cook(meal) }, showsType: false)
            }
        }
        .padding(12)
        .callout(Theme.orange50, Theme.rose50, border: Color(hex: 0xFED7AA).opacity(0.7))
    }
}

/// A combined meal's page, from the whole-week grid: the meal card as the day
/// view shows it, with Cook starting every dish together.
struct MealDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    let meal: PlannedMeal
    let isToday: Bool
    let delete: (MealPlanEntry) -> Void
    let cook: (PlannedMeal) -> Void
    @State private var onLockScreen = false
    @State private var starting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                MealGroupCard(meal: meal, delete: delete, cook: cook)
                MealScheduleSection(groupId: meal.id)
                SaveAsMealButton(groupId: meal.id, title: meal.title ?? "Meal")
                // Tonight's schedule, step by step on the Lock Screen.
                // The serve-at time may come from the day's dinner time, which
                // only the server knows, so it's asked for when tapped.
                if isToday {
                    if onLockScreen {
                        Button { Task { await toggleLockScreen() } } label: {
                            Label("Remove from Lock Screen", systemImage: "lock.slash")
                        }
                        .buttonStyle(.outline)
                    } else {
                        Button { Task { await toggleLockScreen() } } label: {
                            Label(meal.serveAt.map { "Show schedule on Lock Screen · ready \($0)" } ?? "Show schedule on Lock Screen",
                                  systemImage: "lock.iphone")
                        }
                        .buttonStyle(.gradient(.orangeRose))
                        .disabled(starting)
                    }
                }
            }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.vertical, 18)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(meal.title ?? "Meal")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { onLockScreen = MealScheduleActivity.shared.isShowing(meal.id) }
    }

    private func toggleLockScreen() async {
        if onLockScreen {
            MealScheduleActivity.shared.end(meal.id)
            onLockScreen = false
            return
        }
        starting = true
        defer { starting = false }
        if let problem = await MealScheduleActivity.shared.start(groupId: meal.id) {
            app.toast = problem
        } else {
            onLockScreen = true
            app.toast = "On the Lock Screen until it’s served."
        }
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
    @State private var source = Source.recipes
    @State private var savedMeals = Observed<[SavedMeal]>([])
    @State private var choosing: SavedMeal?

    enum Source { case recipes, saved }

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
                Picker("From", selection: $source) {
                    Text("Recipes").tag(Source.recipes)
                    Text("Saved meals").tag(Source.saved)
                }
                .pickerStyle(.segmented)
                if source == .saved {
                    savedList
                } else {
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
            }
            .padding(16)
            .background(Theme.background)
            .navigationTitle("Add to \(week.day(day).formatted(.dateTime.weekday(.wide)))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .navigationDestination(item: $choosing) { meal in
                SavedMealChooser(meal: meal) { optionIds in add(meal, optionIds: optionIds) }
            }
        }
        .task {
            await savedMeals.follow(app.store) { r in
                try r.records(.meals).compactMap(SavedMeal.init)
                    .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
        }
        .task {
            await recipes.follow(app.store) { r in
                try r.records(.recipes).compactMap(Recipe.init)
                    .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
        }
    }

    @ViewBuilder private var savedList: some View {
        if savedMeals.loaded && savedMeals.value.isEmpty {
            EmptyBox(emoji: "🍽", message: "No saved meals yet — save one from a combined meal, or make one in Settings → Saved meals")
            Spacer()
        } else {
            List(savedMeals.value) { meal in
                Button {
                    mealType = meal.defaultMealType
                    choosing = meal
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "square.stack.3d.up.fill")
                            .foregroundStyle(Theme.brand)
                            .frame(width: 52, height: 52)
                            .background(Theme.orange50, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(meal.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.foreground)
                            Text(meal.slots.map { $0.label ?? $0.role?.capitalized ?? "Dish" }.joined(separator: " · "))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.mutedForeground)
                                .lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.mutedForeground)
                    }
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
            }
            .listStyle(.plain)
        }
    }

    /// Plans a saved meal with the chosen options: a temporary group and one
    /// temporary entry per dish until the sync brings the server's.
    private func add(_ meal: SavedMeal, optionIds: [String]) {
        let planId = plan?.id ?? "temp-plan-\(UUID().uuidString.lowercased())"
        let groupId = "temp-group-\(UUID().uuidString.lowercased())"
        var optimistic: [OptimisticChange] = []
        if plan == nil {
            optimistic.append(.put(.mealPlans, .object(["id": .string(planId), "weekStartDate": .string(week.key)]),
                                   temporary: true))
        }
        optimistic.append(.put(.mealPlanGroups, .object([
            "id": .string(groupId), "mealPlanId": .string(planId), "title": .string(meal.title),
            "dayOfWeek": .number(Double(day)), "mealType": .string(mealType),
        ]), temporary: true))
        let options = meal.slots.flatMap(\.options).filter { optionIds.contains($0.id) }
        for option in options {
            optimistic.append(.put(.mealPlanEntries, .object([
                "id": .string("temp-entry-\(UUID().uuidString.lowercased())"), "mealPlanId": .string(planId),
                "recipeId": .string(option.recipeId), "dayOfWeek": .number(Double(day)),
                "mealType": .string(mealType), "groupId": .string(groupId),
            ]), temporary: true))
        }
        Task {
            await app.mutate("meal_plan_group.add_from_meal",
                             payload: .object(["mealId": .string(meal.id), "weekStartDate": .string(week.key),
                                               "dayOfWeek": .number(Double(day)), "mealType": .string(mealType),
                                               "optionIds": .array(optionIds.map { .string($0) })]),
                             optimistic: optimistic)
            app.toast = "Added \(meal.title)."
            dismiss()
        }
    }

    private func add(_ recipe: Recipe) {
        Task {
            await app.planRecipe(recipe.id, week: week, day: day, mealType: mealType)
            app.toast = "Added \(recipe.title)."
            dismiss()
        }
    }
}

/// Choose a dish for each slot of a saved meal — defaults ticked — then add it.
struct SavedMealChooser: View {
    let meal: SavedMeal
    let add: ([String]) -> Void
    @State private var chosen: Set<String> = []

    var body: some View {
        List {
            ForEach(meal.slots) { slot in
                Section {
                    ForEach(slot.options) { option in
                        Button { toggle(option, in: slot) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: chosen.contains(option.id)
                                      ? (slot.allowMultiple ? "checkmark.square.fill" : "largecircle.fill.circle")
                                      : (slot.allowMultiple ? "square" : "circle"))
                                    .foregroundStyle(chosen.contains(option.id) ? Theme.brand : Theme.mutedForeground)
                                    .font(.system(size: 19))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(option.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.foreground)
                                    if let time = Format.shortMinutes(option.totalMinutes) {
                                        Text(time).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(slot.label ?? slot.role?.capitalized ?? "Dish")
                } footer: {
                    if slot.allowMultiple { Text("Pick any") }
                }
            }
        }
        .navigationTitle(meal.title)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button { add(Array(chosen)) } label: {
                Label("Add \(meal.title)", systemImage: "plus")
            }
            .buttonStyle(.brand)
            .disabled(chosen.isEmpty)
            .padding(16)
            .background(.bar)
        }
        .onAppear { chosen = Set(meal.slots.flatMap { $0.defaults.isEmpty ? Array($0.options.prefix(1)) : $0.defaults }.map(\.id)) }
    }

    private func toggle(_ option: SavedMeal.Option, in slot: SavedMeal.Slot) {
        if slot.allowMultiple {
            if chosen.contains(option.id) { chosen.remove(option.id) } else { chosen.insert(option.id) }
        } else {
            for other in slot.options { chosen.remove(other.id) }
            chosen.insert(option.id)
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

    func meals(on day: Int, in week: Week) -> [PlannedMeal] {
        guard let plan = plan(for: week) else { return [] }
        let todays = entries.filter { $0.mealPlanId == plan.id && $0.dayOfWeek == day }
        var meals: [PlannedMeal] = []
        for group in groups where group.mealPlanId == plan.id && group.dayOfWeek == day {
            let dishes = todays.filter { $0.groupId == group.id }.map { ($0, $0.recipeId.flatMap { recipes[$0] }) }
            meals.append(PlannedMeal(id: group.id, groupId: group.id, mealType: group.mealType, title: group.title, serveAt: group.serveAt,
                                     sourceMealId: group.sourceMealId, dishes: dishes))
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
