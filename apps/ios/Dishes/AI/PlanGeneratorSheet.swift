// "Generate plan", as the web's planner: pick the days, say what you fancy,
// and get a draft week — recipes from the library where they fit, new ideas
// where they don't. Drop anything you don't want, then add the rest; new ideas
// are written out as full recipes on the way in.

import DishesCore
import SwiftUI

struct PlanGeneratorSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let week: Week
    /// Days that already have this meal type planned, left unticked to start with.
    let planned: Set<Int>
    /// From "Add meal" → "Suggest with AI": just this day and meal, with the
    /// request box ready for what they fancy.
    var day: Int? = nil
    var meal: String? = nil

    enum Stage: Equatable { case asking, drafting, draft, adding, failed(String) }

    @State private var stage = Stage.asking
    @State private var days: Set<Int> = []
    @State private var mealType = "dinner"
    @State private var preferences = ""
    @State private var favouritesOnly = false
    @State private var eating: Set<String> = []
    @State private var heartHealthy = false
    @State private var draft: [APIClient.PlanSlot] = []
    // While it drafts (Components/AIWait PlanReels): the planner's facts, photos
    // to spin through, and the meals written so far.
    @State private var facts: [String] = []
    @State private var reelPhotos: [URL] = []
    @State private var landed: [APIClient.PlanSlot] = []
    /// Library recipes' photos by id, for library picks the server sent no photo for.
    @State private var libraryPhotos: [String: URL] = [:]
    /// While it adds: how each new idea's writing is going, by its index in `draft`.
    @State private var writing: [Int: Writing] = [:]
    @FocusState private var askingFocused: Bool

    enum Writing: Equatable { case writing(RecipeProgress?), written, failed }

    private static let dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Theme.inkForeground)
                            .frame(width: 44, height: 44)
                            .background(Theme.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Plan the week").font(.system(size: 22, weight: .bold))
                            Text("Week of \(week.monday.formatted(.dateTime.day().month(.wide)))")
                                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    switch stage {
                    case .asking: form
                    case .drafting:
                        PlanReels(rows: days.sorted().map { .init(dayOfWeek: $0, mealType: mealType) }, photos: reelPhotos,
                                  slots: landed, facts: facts, photo: photo)
                    case .draft: draftList
                    case .adding: addingList
                    case .failed(let message): failed(message)
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .interactiveDismissDisabled(stage == .drafting || stage == .adding)
        .onAppear {
            if let day {
                days = [day]
                mealType = meal ?? mealType
                askingFocused = true
            } else {
                days = Set((0..<7).filter { !planned.contains($0) })
            }
        }
    }

    /// Breakfast, lunch and dinner, plus a snack or dessert sent from Add
    /// meal, so the chosen one still shows as chosen.
    private var mealTypes: [String] {
        let usual = ["breakfast", "lunch", "dinner"]
        guard let meal, !usual.contains(meal) else { return usual }
        return usual + [meal]
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            field("Days") {
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { day in
                        pill(Self.dayNames[day], on: days.contains(day)) {
                            if days.contains(day) { days.remove(day) } else { days.insert(day) }
                        }
                    }
                }
            }
            field("Meal") {
                HStack(spacing: 8) {
                    ForEach(mealTypes, id: \.self) { type in
                        pill(type.capitalized, on: mealType == type) { mealType = type }
                    }
                }
            }
            field("Anything in particular?") {
                TextField("e.g. one fish night, nothing too heavy, use the slow cooker on Sunday", text: $preferences, axis: .vertical)
                    .lineLimit(2...5)
                    .focused($askingFocused)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
            }
            if !app.members.isEmpty {
                field("Who’s eating?") {
                    FlowLayout(spacing: 8) {
                        ForEach(app.members) { member in
                            pill(member.displayName, on: eating.contains(member.id)) {
                                if eating.contains(member.id) { eating.remove(member.id) } else {
                                    eating.insert(member.id)
                                    // Someone on a cholesterol-lowering diet switches it on, as on the web.
                                    if member.cholesterolDiet == true { heartHealthy = true }
                                }
                            }
                        }
                    }
                }
            }
            Toggle("Only from our favourites", isOn: $favouritesOnly).tint(Theme.brand).font(.system(size: 15))
            Toggle("Heart-healthy (lower saturated fat)", isOn: $heartHealthy).tint(Theme.brand).font(.system(size: 15))
            Button { Task { await makeDraft() } } label: {
                Label("Draft \(days.count) \(days.count == 1 ? mealType : Self.plural(mealType))", systemImage: "sparkles")
            }
            .buttonStyle(.wide(.ink))
            .disabled(days.isEmpty)
        }
    }

    private var draftList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Here’s the draft — remove anything you don’t want")
                .font(.system(size: 15, weight: .semibold))
            ForEach(draft) { slot in
                HStack(alignment: .top, spacing: 12) {
                    Text(Self.dayNames[slot.dayOfWeek])
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.brand)
                        .frame(width: 40, alignment: .leading)
                    DishPlate(url: photo(slot), isNew: slot.recipeId == nil, size: 44)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(slot.title).font(.system(size: 16, weight: .semibold))
                        Text(slot.description).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                        FlowLayout(spacing: 6) {
                            BadgeView(text: slot.recipeId == nil ? "New idea" : "From your recipes",
                                      style: slot.recipeId == nil ? .secondary : .outline)
                            BadgeView(text: slot.cuisine, style: .outline)
                        }
                    }
                    Spacer(minLength: 0)
                    Button { draft.removeAll { $0.id == slot.id } } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .frame(width: 30, height: 30)
                            .background(Theme.muted, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(slot.title)")
                }
                .padding(14)
                .card()
            }
            let fresh = draft.filter { $0.recipeId == nil }.count
            Button { Task { await add() } } label: {
                Label("Add \(draft.count) to the plan", systemImage: "calendar.badge.plus")
            }
            .buttonStyle(.wide(.ink))
            .disabled(draft.isEmpty)
            if fresh > 0 {
                Text("\(fresh) new \(fresh == 1 ? "idea is" : "ideas are") written out as full recipes when added.")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            Button { stage = .asking } label: { Label("Start again", systemImage: "arrow.uturn.left") }
                .buttonStyle(.secondary)
        }
    }

    /// A slot's photo: the one the server sent, or the local recipe's.
    private func photo(_ slot: APIClient.PlanSlot) -> URL? {
        app.imageURL(slot.imageUrl) ?? slot.recipeId.flatMap { libraryPhotos[$0] }
    }

    /// Adding the draft: library dishes go straight in; each new idea is
    /// written out as a recipe first, its ring filling as the server says
    /// how far it's got.
    private var addingList: some View {
        let fresh = draft.filter { $0.recipeId == nil }.count
        let written = writing.values.filter { $0 == .written }.count
        return VStack(alignment: .leading, spacing: 4) {
            Text(fresh == 0 ? "Adding to the plan…" : "Writing \(fresh) new \(fresh == 1 ? "recipe" : "recipes")…")
                .font(Theme.serif(20))
            Text(fresh == 0 ? "Putting the week in the plan."
                 : "\(written) of \(fresh) done. New ideas are written out in full before they go in the plan, about a minute each.")
                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                .contentTransition(.numericText())
            VStack(spacing: 0) {
                ForEach(Array(draft.enumerated()), id: \.element.id) { i, slot in
                    HStack(spacing: 12) {
                        Text(Self.dayNames[slot.dayOfWeek]).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.brand)
                            .frame(width: 40, alignment: .leading)
                        Group {
                            if slot.recipeId != nil {
                                DishPlate(url: photo(slot), size: 48)
                            } else {
                                switch writing[i] {
                                case .writing(let progress): WritingRing(progress: progress, size: 48)
                                case .written: DishPlate(url: nil, size: 48).overlay(alignment: .bottomTrailing) { tick(Theme.success, "checkmark") }
                                case .failed: DishPlate(url: nil, size: 48).overlay(alignment: .bottomTrailing) { tick(Theme.destructive, "exclamationmark") }
                                case nil: EmptyPlate(size: 48, delay: Double(i) * 0.3)
                                }
                            }
                        }
                        .frame(width: 52, height: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(slot.title).font(Theme.serif(16)).lineLimit(1)
                            Text(addingStatus(slot, writing[i])).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                    if i < draft.count - 1 { Divider().overlay(Theme.border) }
                }
            }
            .padding(.top, 6)
            .animation(.easeOut(duration: 0.3), value: writing)
        }
    }

    private func tick(_ colour: Color, _ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.card)
            .frame(width: 20, height: 20).background(colour, in: Circle())
            .overlay(Circle().strokeBorder(Theme.background, lineWidth: 2))
    }

    private func addingStatus(_ slot: APIClient.PlanSlot, _ state: Writing?) -> String {
        if slot.recipeId != nil { return "From your recipes" }
        switch state {
        case .writing(let progress): return progress?.label ?? "Starting on the ingredients"
        case .written: return "Written and saved"
        case .failed: return "Couldn’t write this one; it goes in as a title"
        case nil: return "Waiting its turn"
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("That didn’t work", systemImage: "exclamationmark.triangle")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.destructive)
            Text(message).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            Button("Try again") { stage = draft.isEmpty ? .asking : .draft }.buttonStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func field(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.system(size: 12, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            content()
        }
    }

    /// "lunches", not "lunchs".
    static func plural(_ mealType: String) -> String {
        mealType.hasSuffix("ch") || mealType.hasSuffix("sh") ? mealType + "es" : mealType + "s"
    }

    private func pill(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 12)
                .frame(height: 34)
                .foregroundStyle(on ? .white : Theme.foreground)
                .background(on ? Theme.brand : Theme.background, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
    }

    private func makeDraft() async {
        facts = []
        landed = []
        stage = .drafting
        let (api, store) = (app.api, app.store)
        // The household's own photos to spin through while it works (the server
        // may send the ones it's actually choosing from), and each recipe's photo.
        if let recipes = try? await store.read({ r in try r.records(.recipes).compactMap(Recipe.init) }) {
            let withPhotos = recipes.compactMap { r in r.thumbnailURL.map { (r.id, $0) } }
            libraryPhotos = Dictionary(withPhotos, uniquingKeysWith: { a, _ in a })
            reelPhotos = Array(withPhotos.map(\.1).shuffled().prefix(16))
        }
        let context = AIContext.cached
        let ask = MealPlanDrafter.Ask(weekStartDate: week.key, slots: days.sorted().map { .init(dayOfWeek: $0, mealType: mealType) },
                                      preferences: preferences, memberIds: Array(eating), favouritesOnly: favouritesOnly,
                                      heartHealthy: heartHealthy)
        do {
            // On the device first, from what's in the local store
            // (MealPlanDrafter), unless there's a request typed in; adding
            // the draft still goes to the server.
            let run = try await AIRouter.run(
                .mealPlan,
                onDevice: { () async throws -> (slots: [APIClient.PlanSlot], problems: [String]) in
                    guard #available(iOS 27, *) else { throw CancellationError() }
                    let household = try await store.read { r in
                        MealPlanDrafter.Household(recipes: try r.records(.recipes).compactMap(Recipe.init),
                                                  plans: try r.records(.mealPlans).compactMap(MealPlan.init),
                                                  entries: try r.records(.mealPlanEntries).compactMap(MealPlanEntry.init),
                                                  cooks: try r.records(.cookHistory).compactMap(CookEntry.init))
                    }
                    let eating = (context?.members ?? []).filter { ask.memberIds.contains($0.id) }
                    let slots = try await MealPlanDrafter.draft(ask, household: household, context: context)
                    let library = MealPlanDrafter.library(ask, household: household, eating: eating.map(\.displayName), today: .now,
                                                          diets: eating.flatMap(\.dietaryFlags))
                    return (slots, PlanChecks.problems(slots, ask: ask, library: library, eating: eating))
                },
                check: { $0.problems },
                fallback: {
                    // Streamed: the facts it's weighing, then each meal as it's written.
                    let events = api.draftMealPlanStream(.init(
                        weekStartDate: ask.weekStartDate, slots: ask.slots.map { ($0.dayOfWeek, $0.mealType) },
                        preferences: ask.preferences, memberIds: ask.memberIds.isEmpty ? nil : ask.memberIds,
                        favouritesOnly: ask.favouritesOnly ? true : nil, heartHealthy: ask.heartHealthy ? true : nil))
                    for try await event in events {
                        switch event {
                        case .facts(let said, let photos):
                            withAnimation { facts = said }
                            let urls = photos.compactMap { app.imageURL($0) }
                            if !urls.isEmpty { reelPhotos = urls }
                        case .slot(let slot):
                            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { landed.append(slot) }
                        case .done(let slots):
                            return (slots, [])
                        case .error(let message):
                            throw APIError.http(status: 422, code: "ai_error", message: message)
                        case .unknown:
                            break
                        }
                    }
                    throw APIError.http(status: 502, code: "bad_response", message: "The plan stopped part way. Please try again.")
                },
                // The device model loses a request in your own words ("pasta,
                // no tomato sauce" → oven cod), so those go to the server.
                skipDevice: ask.preferences.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? nil : "A request in your own words goes to the server")
            draft = run.value.slots.sorted { $0.dayOfWeek < $1.dayOfWeek }
            guard !draft.isEmpty else { stage = .failed("No meals came back. Try fewer constraints."); return }
            // Whatever hasn't landed yet (all of it, when it was drafted on the
            // device) comes down a day at a time, then the draft takes over.
            for slot in draft where !landed.contains(where: { $0.id == slot.id }) {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { landed.append(slot) }
                try? await Task.sleep(for: .milliseconds(250))
            }
            try? await Task.sleep(for: .milliseconds(800))
            stage = .draft
        } catch {
            stage = .failed(ConciergeSheet.explain(error))
        }
    }

    private func add() async {
        writing = [:]
        stage = .adding
        do {
            // Streamed, so each new idea's ring fills as it's written.
            let events = app.api.applyMealPlanStream(weekStartDate: week.key, slots: draft, memberIds: eating.isEmpty ? nil : Array(eating),
                                                     heartHealthy: heartHealthy ? true : nil)
            var finished = false
            for try await event in events {
                switch event {
                case .writing(let index, let progress): writing[index] = .writing(progress)
                case .written(let index, _): writing[index] = .written
                case .failed(let index): writing[index] = .failed
                case .done: finished = true
                case .error(let message): throw APIError.http(status: 422, code: "ai_error", message: message)
                case .unknown: break
                }
            }
            guard finished else { throw APIError.http(status: 502, code: "bad_response", message: "Adding stopped part way. Check the plan, then try again.") }
            await app.syncNow()
            app.toast = "Added \(draft.count) meals to the plan"
            dismiss()
        } catch {
            stage = .failed(ConciergeSheet.explain(error))
        }
    }
}
