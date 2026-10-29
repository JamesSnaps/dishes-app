// A planned meal's cooking schedule, as the web's schedule dialog: when it
// should be ready (its own time, or the day's dinner time), and what to start
// when so every dish finishes together — the simple schedule, or one planned
// by the AI. Plus saving the meal as a saved meal to plan again.

import DishesCore
import SwiftUI

struct MealScheduleData: Decodable, Sendable {
    struct Cue: Decodable, Sendable, Identifiable, Hashable {
        var id: String; var offsetMinutes: Int; var recipeId: String?; var text: String
    }
    struct Timeline: Decodable, Sendable { var cues: [Cue]; var warnings: [String]; var source: String }
    struct Dish: Decodable, Sendable { var recipeId: String; var title: String }
    var serveAt: String?
    var serveAtSource: String?
    var timeline: Timeline
    var aiStale: Bool?
    var aiConfigured: Bool
    var dishes: [Dish]
}

private struct Wrapped: Decodable, Sendable { var data: MealScheduleData }

struct MealScheduleSection: View {
    @Environment(AppModel.self) private var app
    let groupId: String
    @State private var schedule: MealScheduleData?
    @State private var working: String?
    @State private var settingTime = false
    @State private var time = Date()

    var body: some View {
        WebSection(title: "Cooking schedule") {
            VStack(alignment: .leading, spacing: 12) {
                if let s = schedule {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.serveAt.map { "Ready by \($0)" } ?? "No ready-by time").font(.system(size: 17, weight: .bold))
                            Text(s.serveAtSource == "meal" ? "Set for this meal" : s.serveAt == nil ? "Set one to see what to start when" : "The day’s dinner time")
                                .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                        }
                        Spacer()
                        Button(s.serveAt == nil ? "Set time" : "Change") { prefill(s.serveAt); settingTime = true }
                            .buttonStyle(.secondary).fixedSize()
                    }
                    if s.serveAt != nil {
                        ForEach(s.timeline.cues) { cue in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(clock(s.serveAt, cue.offsetMinutes)).font(.system(size: 14, weight: .bold).monospacedDigit())
                                    .foregroundStyle(Theme.brand).frame(width: 48, alignment: .leading)
                                VStack(alignment: .leading, spacing: 1) {
                                    if let id = cue.recipeId, let dish = s.dishes.first(where: { $0.recipeId == id }) {
                                        Text(dish.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                                    }
                                    Text(cue.text).font(.system(size: 14))
                                }
                            }
                        }
                        ForEach(s.timeline.warnings, id: \.self) { w in
                            Label(w, systemImage: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Theme.brand)
                        }
                        HStack(spacing: 10) {
                            if s.aiConfigured {
                                Button { Task { await act("timeline.planWithAi", "Planning…") } } label: {
                                    Label(working == "Planning…" ? "Planning…" : s.timeline.source == "ai" && s.aiStale != true ? "Replan with AI" : "Plan with AI", systemImage: "sparkles")
                                }
                                .buttonStyle(.wide(.ink))
                            }
                            if s.timeline.source == "ai" {
                                Button("Back to simple") { Task { await act("timeline.clear", "Clearing…") } }.buttonStyle(.secondary)
                            }
                        }
                        .disabled(working != nil)
                        if s.aiStale == true {
                            Text("The dishes changed since the AI planned this, so it’s the simple schedule for now.")
                                .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding(16)
            .panel()
        }
        .task { await load() }
        .sheet(isPresented: $settingTime) {
            NavigationStack {
                Form {
                    DatePicker("Ready by", selection: $time, displayedComponents: .hourAndMinute).datePickerStyle(.wheel)
                    if schedule?.serveAtSource == "meal" {
                        Button("Use the day’s dinner time instead") { Task { await setTime(nil) } }
                    }
                }
                .navigationTitle("Ready by").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { settingTime = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            let f = DateFormatter(); f.dateFormat = "HH:mm"
                            Task { await setTime(f.string(from: time)) }
                        }.bold()
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func load() async {
        schedule = (try? await app.api.action("timeline.get", [.string(groupId)], as: Wrapped.self))?.data
    }

    private func act(_ name: String, _ label: String) async {
        working = label
        defer { working = nil }
        do { schedule = try await app.api.action(name, [.string(groupId)], as: Wrapped.self).data }
        catch { app.toast = WebAction.explain(error) }
    }

    private func setTime(_ value: String?) async {
        do {
            schedule = try await app.api.action("timeline.setServeAt", [.string(groupId), value.map { .string($0) } ?? .null], as: Wrapped.self).data
            settingTime = false
            await app.syncNow()
        } catch { app.toast = WebAction.explain(error) }
    }

    private func prefill(_ hhmm: String?) {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        time = hhmm.flatMap { f.date(from: $0) } ?? f.date(from: "18:30") ?? Date()
    }

    private func clock(_ serveAt: String?, _ offset: Int) -> String {
        let parts = (serveAt ?? "18:00").split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return "" }
        let total = ((parts[0] * 60 + parts[1] + offset) % 1440 + 1440) % 1440
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

/// "Save as a saved meal" for a combined meal on the planner.
struct SaveAsMealButton: View {
    @Environment(AppModel.self) private var app
    let groupId: String
    let title: String
    @State private var naming = false

    var body: some View {
        Button { naming = true } label: { Label("Save as a saved meal", systemImage: "rectangle.stack.badge.plus") }
            .buttonStyle(.secondary)
            .sheet(isPresented: $naming) {
                TextPromptSheet(title: "Save meal as", placeholder: "Meal name", text: title) { name in
                    let ok = await WebAction.run("meals.saveFromGroup", [.string(groupId), .string(name)], done: "Saved \(name) — plan it again from Add meal.")
                    if ok { await app.syncNow() }
                    return ok
                }
            }
    }
}
