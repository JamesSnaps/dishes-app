// "Schedule says start the lamb at 08:20 for 17:00 — when did you start?"
//
// Asked as a scheduled meal's cook begins, and from cooking mode's ⋯ menu
// whenever you remember mid-cook — as the web's MealStartDialog. A start well
// off the schedule offers to move the meal (timeline.shift: the serve time,
// every dish's cues, the pushes, the Live Activity and the planner's dinner
// time all follow) or to keep the serve time, which only moves the first
// dish's cues here. Starting early also opens that dish on the step the
// schedule has it on by now — the one time cooking mode moves your step.
//
// Rules: MealStart in DishesCore (the same as apps/web/lib/meal-start.ts).

import DishesCore
import SwiftUI

enum MealStartPrompt: String, Identifiable {
    /// As the cook begins.
    case start
    /// From the menu, mid-cook.
    case later
    var id: String { rawValue }
}

struct MealStartSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: CookSession
    let prompt: MealStartPrompt

    @State private var time = Date()
    @State private var startedAt: Date?
    @State private var moving = false

    private var clock: APIClient.MealClock? { session.clock }
    private var first: APIClient.MealClock.Cue? { clock.flatMap { MealStart.firstCue($0.cues) } }
    private var due: Date { Date(timeIntervalSince1970: (first?.at ?? 0) / 1000) }
    private var serve: Date { Date(timeIntervalSince1970: (clock?.serveAt ?? 0) / 1000) }
    private var dishTitle: String {
        first?.dish ?? session.request.dishes.first { $0.recipe.id == first?.recipeId }?.recipe.title ?? "the first dish"
    }
    private var delta: Int { startedAt.map { MealStart.delta(startedAt: $0, due: due) } ?? 0 }

    var body: some View {
        NavigationStack {
            Group {
                if first == nil {
                    Text("This meal has no schedule to start.").foregroundStyle(Theme.mutedForeground)
                } else if let startedAt {
                    moveOrKeep(startedAt)
                } else {
                    when
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(prompt == .start ? "Not now" : "Cancel") { dismiss() }.disabled(moving)
                }
            }
        }
        .interactiveDismissDisabled(moving)
        .onAppear { time = MealStart.suggestedStart(now: .now, due: due) }
    }

    // MARK: When did you start?

    private var when: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(prompt == .start ? "Starting the meal" : "When did you start?", systemImage: "alarm")
                .font(.system(size: 22, weight: .bold))
            Text("Schedule says start **\(dishTitle)** at **\(Self.hhmm(due))** for **\(Self.hhmm(serve))**.")
                .font(.system(size: 17))
            VStack(alignment: .leading, spacing: 6) {
                Text("I started at…").font(.system(size: 15, weight: .semibold))
                DatePicker("I started at…", selection: $time, in: ...Date.now.addingTimeInterval(60),
                           displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .datePickerStyle(.wheel)
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
            .callout(Theme.amber50, Theme.orange50, border: Color(hex: 0xFDE68A).opacity(0.7))

            if prompt == .start {
                Button { choose(MealStart.toMinute(.now)) } label: {
                    Label("Start now", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(GradientButtonStyle(gradient: .brand, height: 54))
                Button { choose(MealStart.toMinute(time)) } label: {
                    Label("I started earlier at \(Self.hhmm(time))", systemImage: "clock").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outline)
            } else {
                Button { choose(MealStart.toMinute(time)) } label: {
                    Label("I started at \(Self.hhmm(time))", systemImage: "clock").frame(maxWidth: .infinity)
                }
                .buttonStyle(GradientButtonStyle(gradient: .brand, height: 54))
            }
        }
    }

    // MARK: Move dinner, or keep it?

    private func moveOrKeep(_ startedAt: Date) -> some View {
        let newServe = serve.addingTimeInterval(Double(delta) * 60)
        return VStack(alignment: .leading, spacing: 18) {
            Label("\(Self.minutes(delta)) \(delta < 0 ? "early" : "late") — move dinner?", systemImage: "arrow.left.arrow.right")
                .font(.system(size: 22, weight: .bold))
            Text("You started \(dishTitle) at \(Self.hhmm(startedAt)), not \(Self.hhmm(due)). Moving the meal shifts every dish’s times, the reminders and the planner. Keeping \(Self.hhmm(serve)) moves \(dishTitle)’s early steps, here; its last steps still finish for \(Self.hhmm(serve)).")
                .font(.system(size: 16))
                .foregroundStyle(Theme.mutedForeground)
            Button { Task { await move() } } label: {
                HStack(spacing: 8) {
                    if moving { ProgressView().tint(.white) }
                    Text("Move dinner to \(Self.hhmm(newServe))")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(GradientButtonStyle(gradient: .brand, height: 54))
            Button { keep() } label: { Text("Keep \(Self.hhmm(serve))").frame(maxWidth: .infinity) }
                .buttonStyle(.outline)
        }
        .disabled(moving)
    }

    // MARK: Actions

    private func choose(_ start: Date) {
        if abs(MealStart.delta(startedAt: start, due: due)) < MealStart.onTimeMinutes {
            session.startShift = nil
            finish(start)
        } else {
            withAnimation { startedAt = start }
        }
    }

    private func keep() {
        guard let startedAt, let recipeId = first?.recipeId else { return }
        session.startShift = (recipeId, delta)
        finish(startedAt)
    }

    private func move() async {
        guard let startedAt, let groupId = session.request.groupId, let clock else { return }
        let minutes = delta
        let newServe = serve.addingTimeInterval(Double(minutes) * 60)
        moving = true
        defer { moving = false }
        do {
            try await app.api.run("timeline.shift", [.string(groupId), .number(Double(minutes))])
        } catch {
            app.toast = WebAction.explain(error)
            return
        }
        // The server's word on the new times, else the same move worked out here.
        session.clock = (try? await app.api.mealClock(groupId: groupId)) ?? {
            var moved = clock
            moved.serveAt += Double(minutes) * 60_000
            moved.cues = MealStart.shifted(clock.cues, by: minutes)
            return moved
        }()
        session.startShift = nil
        app.toast = "Ready by \(Self.hhmm(newServe)) now — every dish has moved with it."
        finish(startedAt)
        await MealScheduleActivity.shared.refresh()
        await app.syncNow()
    }

    /// Done: open where the schedule has you by now, if you're under way — in
    /// the meal's sequence, the last step due by now across every dish (the
    /// meal's times as just set); otherwise the first dish's step.
    private func finish(_ start: Date) {
        dismiss()
        guard prompt == .start else { return }
        if !session.cues.isEmpty {
            guard Date.now.timeIntervalSince(start) >= Double(MealStart.onTimeMinutes * 60),
                  let at = MealSequence.position(at: Date.now.timeIntervalSince1970 * 1000, in: session.cues),
                  let index = session.cues.firstIndex(where: { $0.id == at.id }) else { return }
            session.goTo(index)
            return
        }
        guard let clock, let recipeId = MealStart.firstCue(clock.cues)?.recipeId else { return }
        let step = MealStart.step(after: Date.now.timeIntervalSince(start), recipeId: recipeId, in: clock.cues)
        guard step > 0 else { return }
        session.steps[recipeId] = step
        if let index = session.request.dishes.firstIndex(where: { $0.recipe.id == recipeId }) {
            session.dishIndex = index
        }
    }

    // MARK: Formatting

    static func hhmm(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    /// "20 min", "1 h 5 min".
    static func minutes(_ total: Int) -> String {
        let m = abs(total), h = m / 60
        return h > 0 ? "\(h) h" + (m % 60 > 0 ? " \(m % 60) min" : "") : "\(m) min"
    }
}
