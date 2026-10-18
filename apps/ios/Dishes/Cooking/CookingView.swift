// Cooking mode, designed for the iPad propped up in the kitchen first
// (TODO_MOBILE.md, C4 tier 1):
//
//   iPad landscape   ingredients rail | the current step, large | timers rail
//   iPad portrait    the step above; ingredients and timers side by side below
//   iPhone           the step, a strip of running timers, ingredients in a sheet
//
// Big targets for floury fingers: tap the step to go on, swipe either way, or
// use ← → and space on a keyboard. The screen stays on while it's open. A
// combined meal shows its dishes as tabs, and every dish's timers sit in one
// pool. The ingredients a step names are picked out in its text and in the
// list (StepMatch), following the step's section when the recipe has them.
//
// A cook is a CookSession that outlives the screen: Minimise goes back to the
// app with a resume bar (CookingBar), as the web's mini bar; Exit ends it.
//
//   nav.cooking = CookRequest(…)   // starts (or resumes) and shows it

import DishesCore
import SwiftUI
import UIKit

/// One dish to cook, at the scale chosen on the recipe page.
struct CookDish: Hashable {
    var recipe: Recipe
    var scale: Double = 1

    /// A meal's dishes in the order to start them: the longest first, as the
    /// simple cooking schedule does, so the first tab is the first job.
    static func inStartOrder(_ recipes: [Recipe]) -> [CookDish] {
        recipes.enumerated()
            .sorted { ($0.element.totalMinutes ?? 0, -$0.offset) > ($1.element.totalMinutes ?? 0, -$1.offset) }
            .map { CookDish(recipe: $0.element) }
    }
}

struct CookRequest: Identifiable {
    let id = UUID()
    var title: String?
    /// The planned combined meal being cooked, for its cooking schedule.
    var groupId: String? = nil
    var dishes: [CookDish]
}

/// Where a cook has got to: kept while it's minimised, gone on Exit.
@MainActor @Observable
final class CookSession {
    let request: CookRequest
    var dishIndex = 0
    /// Current step per dish, by recipe id, so switching tabs keeps your place.
    var steps: [String: Int] = [:]
    /// Ingredients ticked off as they go in, by ingredient id.
    var used: Set<String> = []
    /// Scale per dish, by recipe id; starts at the recipe page's.
    var scales: [String: Double]
    /// Dishes finished (Finish, then the debrief), by recipe id.
    var finished: Set<String> = []
    /// For "How long did it take?" in the debrief; minimised time counts.
    let startedAt = Date()
    /// The meal's cooking schedule as clock times, once fetched (scheduled meals only).
    var clock: APIClient.MealClock?
    /// "I started earlier, keep dinner at 17:00": that dish's cues shown this
    /// many minutes off the schedule, here only (MealStartSheet).
    var startShift: (recipeId: String, minutes: Int)?
    /// "When did you start?" has been asked as this cook began.
    var askedStart = false

    init(request: CookRequest) {
        self.request = request
        scales = Dictionary(request.dishes.map { ($0.recipe.id, $0.scale) }, uniquingKeysWith: { a, _ in a })
    }

    var title: String { request.title ?? request.dishes.first?.recipe.title ?? "Cooking" }

    var dish: CookDish {
        var dish = request.dishes[min(dishIndex, request.dishes.count - 1)]
        dish.scale = scales[dish.recipe.id] ?? dish.scale
        return dish
    }

    var stepIndex: Int { steps[dish.recipe.id] ?? 0 }

    /// The schedule's cues as cooking mode shows them, a kept-dinner start applied.
    var cues: [APIClient.MealClock.Cue] {
        guard let clock else { return [] }
        guard let shift = startShift else { return clock.cues }
        return MealStart.shifted(clock.cues, by: shift.minutes, recipeId: shift.recipeId)
    }

    /// The same dishes, in any order: tapping Cook again resumes rather than restarts.
    func isCooking(_ other: CookRequest) -> Bool {
        Set(request.dishes.map(\.recipe.id)) == Set(other.dishes.map(\.recipe.id))
    }
}

struct CookingView: View {
    @Environment(AppNav.self) private var nav
    @Bindable var session: CookSession

    @State private var showIngredients = false
    @State private var stepChanges = 0
    /// Finish offers to log the cook (the dish on screen), then ends it.
    @State private var logging: Recipe?
    @State private var confirmExit = false
    @State private var asking = false
    @State private var addingTimer = false
    /// "When did you start?" for a scheduled meal (MealStartSheet).
    @State private var startPrompt: MealStartPrompt?
    @FocusState private var keys: Bool
    @Environment(\.horizontalSizeClass) private var width

    private var request: CookRequest { session.request }
    private var dish: CookDish { session.dish }
    private var stepIndex: Int { session.stepIndex }
    private var step: RecipeStep? { dish.recipe.steps.indices.contains(stepIndex) ? dish.recipe.steps[stepIndex] : nil }
    private var isLast: Bool { stepIndex >= dish.recipe.steps.count - 1 }

    /// The step's section ("For the sauce"), when its ingredients are split the same way.
    private var section: String? {
        guard let label = step?.groupLabel?.trimmingCharacters(in: .whitespaces), !label.isEmpty else { return nil }
        return dish.recipe.ingredients.contains { $0.groupLabel?.trimmingCharacters(in: .whitespaces) == label } ? label : nil
    }

    /// Who the step's text can name: the section's ingredients plus any it links to, else all of them.
    private var match: StepMatch {
        let all = dish.recipe.ingredients
        let linked = Set(step?.ingredientIds ?? [])
        let candidates = section.map { label in
            all.filter { $0.groupLabel?.trimmingCharacters(in: .whitespaces) == label || linked.contains($0.id) }
        } ?? all
        return StepMatch(step?.instruction ?? "", candidates: candidates)
    }

    /// The ingredients in use now: linked to the step, or named in it.
    private var inUse: Set<String> { Set(step?.ingredientIds ?? []).union(match.ids) }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let wide = geo.size.width > geo.size.height && geo.size.width >= 900
                let regular = geo.size.width >= 700
                Group {
                    if wide {
                        HStack(spacing: 0) {
                            ingredientsPanel
                                .frame(width: min(330, geo.size.width * 0.27))
                            Divider()
                            stepPane(size: 42)
                            Divider()
                            TimersPanel(dish: dish.recipe.title) { addingTimer = true }
                                .frame(width: min(300, geo.size.width * 0.24))
                        }
                    } else if regular {
                        VStack(spacing: 0) {
                            stepPane(size: 38)
                            Divider()
                            HStack(spacing: 0) {
                                ingredientsPanel
                                Divider()
                                TimersPanel(dish: dish.recipe.title) { addingTimer = true }
                            }
                            .frame(height: geo.size.height * 0.38)
                        }
                    } else {
                        VStack(spacing: 0) {
                            stepPane(size: 28)
                            TimerStrip { addingTimer = true }
                        }
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .sheet(isPresented: $showIngredients) {
                NavigationStack {
                    ingredientsPanel
                        .navigationTitle("Ingredients")
                        .toolbar { Button("Done") { showIngredients = false } }
                }
                .presentationDetents([.medium, .large])
            }
        }
        // ← → for the step, space for its timer, from a keyboard case. Key
        // presses, not button shortcuts: those don't reach a full-screen cover.
        .focusable()
        .focused($keys)
        .focusEffectDisabled()
        .onKeyPress(.rightArrow) { move(1); return .handled }
        .onKeyPress(.leftArrow) { move(-1); return .handled }
        .onKeyPress(.space) {
            if let step, let minutes = step.durationMinutes, minutes > 0 { startTimer(step, minutes: minutes) } else { move(1) }
            return .handled
        }
        .onKeyPress(.escape) { minimise(); return .handled }
        .overlay(alignment: .top) { RingingBanner() }
        .sheet(isPresented: $asking) {
            CookAssistSheet(dish: dish, stepIndex: stepIndex)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $addingTimer) {
            CustomTimerSheet(dish: dish.recipe.title)
                .presentationDetents([.large])
        }
        .sheet(item: $startPrompt) { prompt in
            MealStartSheet(session: session, prompt: prompt)
                .presentationDetents([.large])
        }
        .task { await loadSchedule() }
        .sheet(item: $logging) { recipe in
            CookReviewSheet(recipe: recipe,
                            mode: .afterCooking(minutes: Int(Date().timeIntervalSince(session.startedAt) / 60),
                                                servings: recipe.servings.map { $0 * dish.scale })) {
                finish(recipe)
            }
            .presentationSizing(.page)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: stepChanges)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            keys = true
            showActivity()
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        // The Live Activity follows the step, the dish tab and the timers.
        .onChange(of: stepIndex) { showActivity() }
        .onChange(of: session.dishIndex) { showActivity() }
        .onChange(of: CookTimers.shared.timers) { showActivity() }
        // A sheet takes the keyboard; have it back when they close.
        .onChange(of: asking || addingTimer || logging != nil || showIngredients || startPrompt != nil) { _, open in if !open { keys = true } }
    }

    /// A scheduled meal's clock, fresh each time cooking mode opens. The first
    /// time, as the cook begins on the day, it asks when you started — single
    /// dishes and resumed cooks never do.
    private func loadSchedule() async {
        guard let groupId = request.groupId else { return }
        let first = !session.askedStart
        session.askedStart = true
        guard let clock = try? await AppModel.shared.api.mealClock(groupId: groupId) else { return }
        session.clock = clock
        let serve = Date(timeIntervalSince1970: clock.serveAt / 1000)
        if first, MealStart.firstCue(clock.cues) != nil, Calendar.current.isDateInToday(serve) {
            startPrompt = .start
        }
    }

    /// This cook's timers that haven't gone off (every dish in a meal).
    private var mealTimers: [CookTimer] {
        let dishes = Set(request.dishes.map(\.recipe.title))
        return CookTimers.shared.timers.filter { $0.state != .finished && $0.dish.map(dishes.contains) == true }
    }

    /// A dish is done (saved or "Review later"): its timers go. In a meal the
    /// next unfinished dish comes up; after the last, the cook ends.
    private func finish(_ recipe: Recipe) {
        for timer in CookTimers.shared.timers where timer.dish == recipe.title { CookTimers.shared.cancel(timer) }
        session.finished.insert(recipe.id)
        if let next = request.dishes.firstIndex(where: { !session.finished.contains($0.recipe.id) }) {
            withAnimation { session.dishIndex = next }
        } else {
            end()
        }
    }

    /// Back to the app, the cook kept: the resume bar brings it back.
    private func minimise() { nav.cookingShown = false }

    /// The cook is over: every dish of a meal at once.
    private func end() {
        CookingActivity.shared.end()
        nav.cooking = nil
    }

    /// Exit ends the cook; only running timers make it ask, since they'd ring after you've gone.
    private func exit() {
        if mealTimers.isEmpty { end() } else { confirmExit = true }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Exit", systemImage: "xmark") { exit() }
                .confirmationDialog("Stop cooking?", isPresented: $confirmExit, titleVisibility: .visible) {
                    Button("End cooking and cancel timers", role: .destructive) {
                        for timer in mealTimers { CookTimers.shared.cancel(timer) }
                        end()
                    }
                    Button("End cooking, keep timers") { end() }
                    Button("Minimise instead") { minimise() }
                } message: {
                    Text(mealTimers.count == 1 ? "A timer is still running." : "\(mealTimers.count) timers are still running.")
                }
        }
        ToolbarItem(placement: .principal) {
            if request.dishes.count > 1 {
                let picker = Picker("Dish", selection: $session.dishIndex) {
                    ForEach(request.dishes.indices, id: \.self) { i in
                        let done = session.finished.contains(request.dishes[i].recipe.id)
                        Text((done ? "✓ " : "") + request.dishes[i].recipe.title).tag(i)
                    }
                }
                // Tabs while the titles fit (a few dishes on iPad); otherwise a
                // menu headed by the current dish, so a big meal stays readable.
                if width == .regular && request.dishes.count <= 4 {
                    picker.pickerStyle(.segmented).frame(maxWidth: 520)
                } else {
                    Menu {
                        ForEach(request.dishes.indices, id: \.self) { i in
                            let title = request.dishes[i].recipe.title
                            Button { session.dishIndex = i } label: {
                                if i == session.dishIndex {
                                    Label(title, systemImage: "checkmark")
                                } else if session.finished.contains(request.dishes[i].recipe.id) {
                                    Label(title, systemImage: "checkmark.circle")
                                } else {
                                    Text(title)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            VStack(spacing: 0) {
                                Text(dish.recipe.title).font(.headline).lineLimit(1)
                                Text("Dish \(session.dishIndex + 1) of \(request.dishes.count)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(Theme.foreground)
                    }
                }
            } else {
                Text(dish.recipe.title).font(.headline).lineLimit(1)
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            // On iPad the ingredients are always on screen.
            if width == .compact {
                Button("Ingredients", systemImage: "list.bullet") { showIngredients = true }
            }
            if session.clock != nil {
                Menu {
                    Button("Started at a different time…", systemImage: "clock.arrow.circlepath") { startPrompt = .later }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
            Button { minimise() } label: {
                Label("Minimise", systemImage: "chevron.down")
            }
            .help("Minimise — keep cooking and go back to the app")
        }
    }

    // MARK: The step

    private func stepPane(size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            progress
            if !session.cues.isEmpty { MealCueLine(session: session) }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let label = step?.groupLabel {
                        Text(label)
                            .font(.headline)
                            .foregroundStyle(Theme.brandDeep)
                            .textCase(.uppercase)
                    }
                    Text(step.map { _ in match.highlighted(color: Theme.brandDeep) } ?? AttributedString("This recipe has no steps."))
                        .font(.system(size: size, weight: .medium, design: .rounded))
                        .lineSpacing(size * 0.18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        // Tap the words to go on: no aiming needed.
                        .onTapGesture { move(1) }
                    stepIngredients(size: size)
                    if step != nil {
                        Button { asking = true } label: {
                            Label("Ask about this step", systemImage: "bubble.left.and.text.bubble.right")
                                .font(.system(size: 15, weight: .semibold))
                        }
                        .buttonStyle(.outline)
                    }
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            navigation
        }
        .padding(size > 30 ? 32 : 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .gesture(DragGesture(minimumDistance: 40).onEnded { drag in
            guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
            move(drag.translation.width < 0 ? 1 : -1)
        })
    }

    private var progress: some View {
        let count = max(dish.recipe.steps.count, 1)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Step \(min(stepIndex + 1, count)) of \(count)")
                .font(.headline)
                .foregroundStyle(.secondary)
            GeometryReader { geo in
                Capsule().fill(Color.secondary.opacity(0.15))
                    .overlay(alignment: .leading) {
                        Capsule().fill(Theme.brandGradient)
                            .frame(width: geo.size.width * CGFloat(stepIndex + 1) / CGFloat(count))
                    }
            }
            .frame(height: 8)
            .animation(.easeOut, value: stepIndex)
        }
    }

    /// The ingredients in use, scaled, in recipe order.
    private func stepIngredients(size: CGFloat) -> some View {
        let ingredients = dish.recipe.ingredients.filter { inUse.contains($0.id) }
        return Group {
            if !ingredients.isEmpty {
                FlowLayout(spacing: 10) {
                    ForEach(ingredients) { ingredient in
                        let quantity = Format.quantity(ingredient.amount, ingredient.unit, scale: dish.scale)
                        Text(quantity.isEmpty ? ingredient.name : "\(quantity) \(ingredient.name)")
                            .font(.system(size: max(17, size * 0.5), weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Theme.brand.opacity(0.15), in: Capsule())
                            .foregroundStyle(Theme.brandDeep)
                    }
                }
            }
        }
    }

    private var ingredientsPanel: some View {
        IngredientsPanel(dish: dish, inUse: inUse, section: section, used: $session.used,
                         scale: Binding(get: { dish.scale }, set: { session.scales[dish.recipe.id] = $0 }))
    }

    private func startTimer(_ step: RecipeStep, minutes: Int) {
        Task {
            await CookTimers.shared.start(label: step.timerLabel ?? "Step \(stepIndex + 1)",
                                          dish: dish.recipe.title, seconds: TimeInterval(minutes * 60))
        }
    }

    private func timerButton(_ step: RecipeStep, minutes: Int) -> some View {
        Button { startTimer(step, minutes: minutes) } label: {
            Label("\(step.timerLabel ?? "Timer") · \(Format.minutes(minutes) ?? "")", systemImage: "timer")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.brand)
    }

    /// Fixed below the step, never scrolled away: the timer for this step, then Back and Next.
    private var navigation: some View {
        VStack(spacing: 14) {
            if let step, let minutes = step.durationMinutes, minutes > 0 {
                timerButton(step, minutes: minutes)
            }
            backNext
        }
    }

    private var backNext: some View {
        HStack(spacing: 16) {
            Button {
                move(-1)
            } label: {
                Label("Back", systemImage: "chevron.left")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(stepIndex == 0 ? Theme.mutedForeground.opacity(0.5) : Theme.foreground)
                    .frame(maxWidth: .infinity, minHeight: 60)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.border, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
            .disabled(stepIndex == 0)

            Button {
                if isLast { logging = dish.recipe } else { move(1) }
            } label: {
                Label(isLast ? "Finish" : "Next", systemImage: isLast ? "checkmark" : "chevron.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(.system(size: 19, weight: .bold))
            }
            .buttonStyle(GradientButtonStyle(gradient: .brand, height: 60))
        }
    }

    private func showActivity() {
        CookingActivity.shared.show(
            title: session.title, dish: dish.recipe.title,
            step: min(stepIndex + 1, max(dish.recipe.steps.count, 1)), of: max(dish.recipe.steps.count, 1),
            instruction: step?.instruction ?? "")
    }

    private func move(_ by: Int) {
        let next = stepIndex + by
        guard dish.recipe.steps.indices.contains(next) else { return }
        withAnimation(.snappy) { session.steps[dish.recipe.id] = next }
        stepChanges += 1
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) { configuration.title; configuration.icon }
    }
}

// MARK: Ingredients

/// The dish's photo, servings, and every ingredient — grouped by section, the
/// ones in use highlighted, other sections faded while you're in one. Tap an
/// ingredient to tick it off as it goes in.
struct IngredientsPanel: View {
    let dish: CookDish
    let inUse: Set<String>
    let section: String?
    @Binding var used: Set<String>
    @Binding var scale: Double

    private var groups: [(label: String?, items: [Ingredient])] {
        var out: [(label: String?, items: [Ingredient])] = []
        for ingredient in dish.recipe.ingredients {
            let label = ingredient.groupLabel?.trimmingCharacters(in: .whitespaces).nilIfBlank
            if let last = out.last, last.label == label { out[out.count - 1].items.append(ingredient) }
            else { out.append((label, [ingredient])) }
        }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if dish.recipe.imageUrl != nil {
                    Color.clear
                        .frame(height: 150)
                        .overlay { RecipeImage(recipe: dish.recipe) }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                servings
                ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                    let current = section == nil || group.label == section
                    VStack(alignment: .leading, spacing: 8) {
                        if let label = group.label {
                            HStack(spacing: 6) {
                                PanelLabel(text: label)
                                if section != nil && group.label == section {
                                    Text("NOW").font(.system(size: 10, weight: .bold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Theme.brand, in: Capsule())
                                        .foregroundStyle(.white)
                                }
                            }
                        } else {
                            PanelLabel(text: "Ingredients")
                        }
                        VStack(spacing: 0) {
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { index, ingredient in
                                if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                                row(ingredient)
                            }
                        }
                        .card()
                    }
                    .opacity(current ? 1 : 0.55)
                }
            }
            .padding(16)
        }
        .background(Theme.muted.opacity(0.35))
    }

    /// "Serves 4 − +": rescales every amount here and in the step.
    private var servings: some View {
        let base = dish.recipe.servings ?? 0
        let serves = base > 0 ? base * scale : nil
        return HStack(spacing: 10) {
            Image(systemName: "person.2").foregroundStyle(Theme.mutedForeground)
            Text(serves.map { "Serves \(Format.amount(String($0)) ?? "")" } ?? "Scale ×\(Format.amount(String(scale)) ?? "")")
                .font(.system(size: 15, weight: .semibold))
            Spacer()
            Button { change(-1) } label: { Image(systemName: "minus").frame(width: 34, height: 34) }
                .disabled(serves.map { $0 <= 1 } ?? (scale <= 0.5))
            Button { change(1) } label: { Image(systemName: "plus").frame(width: 34, height: 34) }
        }
        .buttonStyle(.bordered)
        .tint(Theme.brand)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .card()
    }

    private func change(_ by: Double) {
        let base = dish.recipe.servings ?? 0
        if base > 0 {
            scale = max(1, (base * scale).rounded() + by) / base
        } else {
            scale = max(0.5, scale + by * 0.5)
        }
    }

    private func row(_ ingredient: Ingredient) -> some View {
        let now = inUse.contains(ingredient.id)
        let done = used.contains(ingredient.id)
        return Button {
            if done { used.remove(ingredient.id) } else { used.insert(ingredient.id) }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: done ? "checkmark.square.fill" : "square")
                    .foregroundStyle(done ? Theme.brand : Theme.mutedForeground)
                VStack(alignment: .leading, spacing: 2) {
                    let quantity = Format.quantity(ingredient.amount, ingredient.unit, scale: dish.scale)
                    Text(quantity.isEmpty ? ingredient.name : "\(quantity) \(ingredient.name)")
                        .font(.system(size: 16, weight: now ? .semibold : .regular))
                        .strikethrough(done)
                        .foregroundStyle(done ? Theme.mutedForeground : Theme.foreground)
                    if let preparation = ingredient.preparation {
                        Text(preparation).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(now ? Theme.orange50 : .clear)
            .overlay(alignment: .leading) {
                if now { Rectangle().fill(Theme.brand).frame(width: 3) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private extension String {
    var nilIfBlank: String? { isEmpty ? nil : self }
}

/// The web's small uppercase section label.
struct PanelLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.mutedForeground)
    }
}

// MARK: Timers

/// Every running timer, from every dish.
struct TimersPanel: View {
    private var timers = CookTimers.shared
    /// The dish on screen, which a timer you add belongs to.
    let dish: String
    let add: () -> Void

    init(dish: String, add: @escaping () -> Void) {
        self.dish = dish
        self.add = add
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    PanelLabel(text: "Timers")
                    Spacer()
                    if !timers.timers.isEmpty {
                        Button("Clear all") { withAnimation(.easeOut(duration: 0.35)) { timers.clearAll() } }
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                    Button(action: add) {
                        Label("Add timer", systemImage: "plus")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(Theme.brand, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if timers.timers.isEmpty {
                    EmptyBox(emoji: "⏲️", message: "A step’s timer, or one of your own, appears here")
                }
                ForEach(timers.timers) { timer in
                    TimerRow(timer: timer)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .card()
                        .transition(.poof)
                }
            }
            .padding(16)
        }
        .background(Theme.muted.opacity(0.35))
    }
}

/// One timer: its label, dish and countdown. Tap it for a native menu —
/// Pause/Resume, Add a minute, Cancel (Clear once done). Buttons on the card
/// itself were too cramped in a narrow column (James's iPad, 17 Oct 2026).
/// Clearing animates it away with a "poof" (`.poof`).
struct TimerRow: View {
    let timer: CookTimer
    var compact = false

    var body: some View {
        Menu {
            actions
        } label: {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = timer.secondsLeft(at: context.date)
                let finished = timer.state == .finished || left <= 0
                HStack(spacing: 10) {
                    Image(systemName: finished ? "checkmark.circle.fill" : timer.state == .paused ? "pause.circle.fill" : "timer")
                        .font(.system(size: compact ? 16 : 20, weight: .semibold))
                        .foregroundStyle(finished ? Theme.emerald700 : timer.state == .paused ? Theme.mutedForeground : Theme.brand)
                        .symbolEffect(.pulse, isActive: timer.state == .running)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(timer.label)
                            .font(.system(size: compact ? 13 : 15, weight: .semibold))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(1)
                        if !compact {
                            Text(finished ? "Done" : timer.state == .paused ? "Paused" : (timer.dish ?? "Running"))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.mutedForeground)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    Text(finished ? "0:00" : Self.clock(left))
                        .font(.system(size: compact ? 17 : 22, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(finished ? Theme.emerald700 : timer.state == .paused ? Theme.mutedForeground : Theme.brandDeep)
                        .contentTransition(.numericText(countsDown: true))
                        .fixedSize()
                }
                .contentShape(Rectangle())
                .onChange(of: finished) { _, now in if now { CookTimers.shared.refreshFinished() } }
            }
        }
        .buttonStyle(.plain)
        .menuOrder(.fixed)
    }

    @ViewBuilder private var actions: some View {
        if timer.state == .running {
            Button("Pause", systemImage: "pause.fill") { CookTimers.shared.pause(timer) }
        }
        if timer.state == .paused {
            Button("Resume", systemImage: "play.fill") { CookTimers.shared.resume(timer) }
        }
        if timer.state != .finished {
            Button("Add a minute", systemImage: "plus") { Task { await CookTimers.shared.addMinute(timer) } }
        }
        Button(timer.state == .finished ? "Clear" : "Cancel timer", systemImage: "xmark", role: .destructive) {
            withAnimation(.easeOut(duration: 0.35)) { CookTimers.shared.cancel(timer) }
        }
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let s = Int(seconds.rounded(.up))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// "Poof": puffs up, blurs and fades — how a cleared timer leaves.
struct PoofModifier: ViewModifier {
    let gone: Bool
    func body(content: Content) -> some View {
        content
            .scaleEffect(gone ? 1.25 : 1)
            .blur(radius: gone ? 10 : 0)
            .opacity(gone ? 0 : 1)
    }
}

extension AnyTransition {
    static var poof: AnyTransition {
        .asymmetric(insertion: .scale(scale: 0.9).combined(with: .opacity),
                    removal: .modifier(active: PoofModifier(gone: true), identity: PoofModifier(gone: false)))
    }
}

/// iPhone: running timers as a strip under the step.
struct TimerStrip: View {
    private var timers = CookTimers.shared
    let add: () -> Void

    init(add: @escaping () -> Void) { self.add = add }

    var body: some View {
        Group {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    Button(action: add) {
                        Label(timers.timers.isEmpty ? "Add timer" : "Add", systemImage: "plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 44)
                            .background(Theme.brand, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    ForEach(timers.timers) { timer in
                        TimerRow(timer: timer, compact: true)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(width: 210)
                            .card()
                            .transition(.poof)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .background(.bar)
        }
    }
}

/// A finished timer, impossible to miss from across the kitchen, with one big Stop.
struct RingingBanner: View {
    private var timers = CookTimers.shared

    var body: some View {
        if !timers.ringing.isEmpty {
            HStack(spacing: 18) {
                Image(systemName: "alarm.waves.left.and.right.fill")
                    .font(.system(size: 34))
                    .symbolEffect(.wiggle, options: .repeating)
                VStack(alignment: .leading, spacing: 2) {
                    Text(timers.ringing.map(\.label).joined(separator: ", "))
                        .font(.title2.bold())
                        .lineLimit(2)
                    Text("Time’s up").font(.headline).opacity(0.85)
                }
                Spacer(minLength: 8)
                Button("Stop") { timers.stopRinging() }
                    .font(.title2.bold())
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    .background(.white, in: Capsule())
                    .foregroundStyle(Theme.brandDeep)
                    .keyboardShortcut(.return, modifiers: [])
            }
            .foregroundStyle(.white)
            .padding(22)
            .background(Theme.brandGradient, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: Theme.brand.opacity(0.5), radius: 24, y: 10)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .frame(maxWidth: 760)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

// MARK: Layout

/// Lays children out in rows, wrapping when a row is full (ingredient chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        rows(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (index, origin) in rows(bounds.width, subviews).origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func rows(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (CGSize(width: widest, height: y + rowHeight), origins)
    }
}

/// A scheduled meal's next cue against the clock — "08:40 · Lamb: Stir and
/// season" — under the progress bar, as the web's "Now / next" strip. Tap it
/// to go to that dish and step.
struct MealCueLine: View {
    @Bindable var session: CookSession

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            // A cue counts as "now" for a few minutes after its time, as on the web.
            let upcoming = session.cues.filter { $0.at + 5 * 60_000 > now }
            if let next = upcoming.first(where: { $0.id != "serve" }) ?? upcoming.first {
                Button { go(to: next) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "alarm").foregroundStyle(Theme.brandDeep)
                        Text(next.at <= now ? "Now" : MealStartSheet.hhmm(Date(timeIntervalSince1970: next.at / 1000)))
                            .font(.system(size: 15, weight: .bold).monospacedDigit())
                            .foregroundStyle(next.at <= now ? Color(hex: 0xE11D48) : Theme.foreground)
                        Text("\(Text(next.dish.map { "\($0): " } ?? "").bold())\(next.text)")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.foreground)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .callout(Theme.amber50, Theme.orange50, border: Color(hex: 0xFDE68A).opacity(0.7))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func go(to cue: APIClient.MealClock.Cue) {
        guard let recipeId = cue.recipeId,
              let index = session.request.dishes.firstIndex(where: { $0.recipe.id == recipeId }) else { return }
        withAnimation {
            session.dishIndex = index
            if let step = cue.stepIndex { session.steps[recipeId] = step }
        }
    }
}
