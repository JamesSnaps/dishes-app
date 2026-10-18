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

    enum Stage: Equatable { case asking, drafting, draft, adding, failed(String) }

    @State private var stage = Stage.asking
    @State private var days: Set<Int> = []
    @State private var mealType = "dinner"
    @State private var preferences = ""
    @State private var favouritesOnly = false
    @State private var eating: Set<String> = []
    @State private var heartHealthy = false
    @State private var draft: [APIClient.PlanSlot] = []

    private static let dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Theme.Gradient.violetOrange.linear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Plan the week").font(.system(size: 22, weight: .bold))
                            Text("Week of \(week.monday.formatted(.dateTime.day().month(.wide)))")
                                .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    switch stage {
                    case .asking: form
                    case .drafting: working("Planning your week…", "Choosing from your recipes and thinking up new ones.")
                    case .draft: draftList
                    case .adding: working("Adding to the plan…", "New ideas are written out as full recipes first, which can take a few minutes.")
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
        .onAppear { days = Set((0..<7).filter { !planned.contains($0) }) }
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
                    ForEach(["breakfast", "lunch", "dinner"], id: \.self) { type in
                        pill(type.capitalized, on: mealType == type) { mealType = type }
                    }
                }
            }
            field("Anything in particular?") {
                TextField("e.g. one fish night, nothing too heavy, use the slow cooker on Sunday", text: $preferences, axis: .vertical)
                    .lineLimit(2...5)
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
                Label("Draft \(days.count) \(mealType)\(days.count == 1 ? "" : "s")", systemImage: "sparkles")
            }
            .buttonStyle(.gradient(.violetOrange))
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
                        .foregroundStyle(Theme.brandDeep)
                        .frame(width: 40, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(slot.title).font(.system(size: 16, weight: .semibold))
                        Text(slot.description).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                        HStack(spacing: 6) {
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
            .buttonStyle(.gradient(.violetIndigo))
            .disabled(draft.isEmpty)
            if fresh > 0 {
                Text("\(fresh) new \(fresh == 1 ? "idea is" : "ideas are") written out as full recipes when added.")
                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            Button { stage = .asking } label: { Label("Start again", systemImage: "arrow.uturn.left") }
                .buttonStyle(.outline)
        }
    }

    private func working(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large).tint(Theme.brand)
            Text(title).font(.system(size: 17, weight: .semibold))
            Text(detail).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 50)
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("That didn’t work", systemImage: "exclamationmark.triangle")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.destructive)
            Text(message).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            Button("Try again") { stage = draft.isEmpty ? .asking : .draft }.buttonStyle(.outline)
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
        stage = .drafting
        do {
            draft = try await app.api.draftMealPlan(.init(
                weekStartDate: week.key,
                slots: days.sorted().map { ($0, mealType) },
                preferences: preferences,
                memberIds: eating.isEmpty ? nil : Array(eating),
                favouritesOnly: favouritesOnly ? true : nil,
                heartHealthy: heartHealthy ? true : nil))
                .sorted { $0.dayOfWeek < $1.dayOfWeek }
            stage = draft.isEmpty ? .failed("No meals came back. Try fewer constraints.") : .draft
        } catch {
            stage = .failed(ConciergeSheet.explain(error))
        }
    }

    private func add() async {
        stage = .adding
        do {
            try await app.api.applyMealPlan(weekStartDate: week.key, slots: draft, memberIds: eating.isEmpty ? nil : Array(eating),
                                            heartHealthy: heartHealthy ? true : nil)
            await app.syncNow()
            app.toast = "Added \(draft.count) meals to the plan"
            dismiss()
        } catch {
            stage = .failed(ConciergeSheet.explain(error))
        }
    }
}
