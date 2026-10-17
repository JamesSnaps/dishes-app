// Cooking mode, designed for the iPad propped up in the kitchen first
// (TODO_MOBILE.md, C4 tier 1):
//
//   iPad landscape   ingredients rail | the current step, large | timers rail
//   iPad portrait    the step above; ingredients and timers side by side below
//   iPhone           the step, a strip of running timers, ingredients in a sheet
//
// Big targets for floury fingers: tap the step to go on, swipe either way, or
// use the arrow keys and space on a keyboard case. The screen stays on while
// it's open. A combined meal shows its dishes as tabs, and every dish's timers
// sit in one pool.
//
//   .fullScreenCover(item: $cooking) { CookingView(request: $0) }

import DishesCore
import SwiftUI
import UIKit

/// One dish to cook, at the scale chosen on the recipe page.
struct CookDish: Hashable {
    var recipe: Recipe
    var scale: Double = 1
}

struct CookRequest: Identifiable {
    let id = UUID()
    var title: String?
    var dishes: [CookDish]
}

struct CookingView: View {
    @Environment(\.dismiss) private var dismiss
    let request: CookRequest

    @State private var dishIndex = 0
    /// Current step per dish, by recipe id, so switching tabs keeps your place.
    @State private var steps: [String: Int] = [:]
    /// Ingredients ticked off as they go in, by ingredient id.
    @State private var used: Set<String> = []
    @State private var showIngredients = false
    @State private var stepChanges = 0
    @Environment(\.horizontalSizeClass) private var width

    private var dish: CookDish { request.dishes[min(dishIndex, request.dishes.count - 1)] }
    private var stepIndex: Int { steps[dish.recipe.id] ?? 0 }
    private var step: RecipeStep? { dish.recipe.steps.indices.contains(stepIndex) ? dish.recipe.steps[stepIndex] : nil }
    private var isLast: Bool { stepIndex >= dish.recipe.steps.count - 1 }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let wide = geo.size.width > geo.size.height && geo.size.width >= 900
                let regular = geo.size.width >= 700
                Group {
                    if wide {
                        HStack(spacing: 0) {
                            IngredientsPanel(dish: dish, current: step, used: $used)
                                .frame(width: min(320, geo.size.width * 0.26))
                            Divider()
                            stepPane(size: 42)
                            Divider()
                            TimersPanel()
                                .frame(width: min(300, geo.size.width * 0.24))
                        }
                    } else if regular {
                        VStack(spacing: 0) {
                            stepPane(size: 38)
                            Divider()
                            HStack(spacing: 0) {
                                IngredientsPanel(dish: dish, current: step, used: $used)
                                Divider()
                                TimersPanel()
                            }
                            .frame(height: geo.size.height * 0.36)
                        }
                    } else {
                        VStack(spacing: 0) {
                            stepPane(size: 28)
                            TimerStrip()
                        }
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .sheet(isPresented: $showIngredients) {
                NavigationStack {
                    IngredientsPanel(dish: dish, current: step, used: $used)
                        .navigationTitle("Ingredients")
                        .toolbar { Button("Done") { showIngredients = false } }
                }
                .presentationDetents([.medium, .large])
            }
        }
        .overlay(alignment: .top) { RingingBanner() }
        .sensoryFeedback(.impact(weight: .light), trigger: stepChanges)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            showActivity()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            CookingActivity.shared.end()
        }
        // The Live Activity follows the step, the dish tab and the timers.
        .onChange(of: stepIndex) { showActivity() }
        .onChange(of: dishIndex) { showActivity() }
        .onChange(of: CookTimers.shared.timers) { showActivity() }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Close", systemImage: "xmark") { dismiss() }
                .keyboardShortcut(.escape, modifiers: [])
        }
        ToolbarItem(placement: .principal) {
            if request.dishes.count > 1 {
                Picker("Dish", selection: $dishIndex) {
                    ForEach(request.dishes.indices, id: \.self) { i in
                        Text(request.dishes[i].recipe.title).tag(i)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 520)
            } else {
                Text(dish.recipe.title).font(.headline).lineLimit(1)
            }
        }
        // On iPad the ingredients are always on screen.
        if width == .compact {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Ingredients", systemImage: "list.bullet") { showIngredients = true }
            }
        }
    }

    // MARK: The step

    private func stepPane(size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            progress
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let label = step?.groupLabel {
                        Text(label)
                            .font(.headline)
                            .foregroundStyle(Theme.brandDeep)
                            .textCase(.uppercase)
                    }
                    Text(step?.instruction ?? "This recipe has no steps.")
                        .font(.system(size: size, weight: .medium, design: .rounded))
                        .lineSpacing(size * 0.18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        // Tap the words to go on: no aiming needed.
                        .onTapGesture { move(1) }
                    if let step { stepIngredients(step, size: size) }
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

    /// The ingredients this step uses, scaled — exact, from the step's references.
    private func stepIngredients(_ step: RecipeStep, size: CGFloat) -> some View {
        let ingredients = dish.recipe.ingredients.filter { step.ingredientIds.contains($0.id) }
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

    private func timerButton(_ step: RecipeStep, minutes: Int) -> some View {
        Button {
            Task {
                await CookTimers.shared.start(label: step.timerLabel ?? "Step \(stepIndex + 1)",
                                              dish: dish.recipe.title, seconds: TimeInterval(minutes * 60))
            }
        } label: {
            Label("\(step.timerLabel ?? "Timer") · \(Format.minutes(minutes) ?? "")", systemImage: "timer")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.brand)
        .keyboardShortcut(.space, modifiers: [])
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
            .keyboardShortcut(.leftArrow, modifiers: [])

            Button {
                if isLast { dismiss() } else { move(1) }
            } label: {
                Label(isLast ? "Finish" : "Next", systemImage: isLast ? "checkmark" : "chevron.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(.system(size: 19, weight: .bold))
            }
            .buttonStyle(GradientButtonStyle(gradient: .brand, height: 60))
            .keyboardShortcut(.rightArrow, modifiers: [])
        }
    }

    private func showActivity() {
        CookingActivity.shared.show(
            title: request.title ?? dish.recipe.title, dish: dish.recipe.title,
            step: min(stepIndex + 1, max(dish.recipe.steps.count, 1)), of: max(dish.recipe.steps.count, 1),
            instruction: step?.instruction ?? "")
    }

    private func move(_ by: Int) {
        let next = stepIndex + by
        guard dish.recipe.steps.indices.contains(next) else { return }
        withAnimation(.snappy) { steps[dish.recipe.id] = next }
        stepChanges += 1
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) { configuration.title; configuration.icon }
    }
}

// MARK: Ingredients

/// Every ingredient, the current step's highlighted; tap to tick one off as it goes in.
struct IngredientsPanel: View {
    let dish: CookDish
    let current: RecipeStep?
    @Binding var used: Set<String>

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                PanelLabel(text: "Ingredients")
                VStack(spacing: 0) {
                    ForEach(Array(dish.recipe.ingredients.enumerated()), id: \.element.id) { index, ingredient in
                        if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                        row(ingredient)
                    }
                }
                .card()
            }
            .padding(16)
        }
        .background(Theme.muted.opacity(0.35))
    }

    private func row(_ ingredient: Ingredient) -> some View {
        let now = current?.ingredientIds.contains(ingredient.id) == true
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    PanelLabel(text: "Timers")
                    Spacer()
                    if !timers.timers.isEmpty {
                        Button("Clear all") { withAnimation(.easeOut(duration: 0.35)) { timers.clearAll() } }
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.brand)
                    }
                }
                if timers.timers.isEmpty {
                    EmptyBox(emoji: "⏲️", message: "Timers you start appear here")
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

    var body: some View {
        if !timers.timers.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
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
