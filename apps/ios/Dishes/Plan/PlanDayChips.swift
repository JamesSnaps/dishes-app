// The chips beside the chosen day's heading on the planner, as the web's
// week planner: dinner time with when to start (dinner-time-chip.tsx) and the
// day's grocery delivery (delivery-chip.tsx). Both come from the server for
// the visible week, so offline they simply don't show.

import DishesCore
import SwiftUI

struct WeekDinnerSchedule: Decodable, Sendable {
    struct Day: Decodable, Sendable {
        var dayOfWeek: Int
        var time: String
        var defaultTime: String
        var overridden: Bool
        var reminderEnabled: Bool
    }
    struct Estimate: Decodable, Sendable { var minutes: Int; var explanation: String }
    var days: [Day]
    var estimates: [String: Estimate]
}

struct WeekDeliveryPanel: Decodable, Sendable {
    var configured: Bool
    var canEdit: Bool
    var days: [DeliveryOverview.Day]
}

/// The week's dinner times and deliveries, reloaded when the week or its
/// dinners change.
@MainActor @Observable
final class PlanWeekExtras {
    private(set) var dinner: WeekDinnerSchedule?
    private(set) var deliveries: WeekDeliveryPanel?

    func load(week: String, dinnerRecipeIds: [String]) async {
        let api = AppModel.shared.api
        async let d = try? api.action("dinner.week", [.string(week), .array(dinnerRecipeIds.map { .string($0) })],
                                      as: WeekDinnerSchedule.self)
        async let p = try? api.action("deliveries.weekPanel", [.string(week)], as: WeekDeliveryPanel.self)
        let (dinner, deliveries) = await (d, p)
        // Keep what's shown when a reload fails (offline).
        if let dinner { self.dinner = dinner }
        if let deliveries { self.deliveries = deliveries }
    }

    func update(_ day: WeekDinnerSchedule.Day) {
        guard let i = dinner?.days.firstIndex(where: { $0.dayOfWeek == day.dayOfWeek }) else { return }
        dinner?.days[i] = day
    }
}

/// "YYYY-MM-DD" in the local calendar.
func localDateKey(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

// MARK: Dinner time

struct DinnerTimeChip: View {
    let date: Date
    let day: WeekDinnerSchedule.Day
    let dishes: [Recipe]
    let estimates: [String: WeekDinnerSchedule.Estimate]
    /// Fewer words, for a column of the whole-week grid.
    var compact = false
    var changed: (WeekDinnerSchedule.Day) -> Void
    @State private var open = false

    /// The longest dish sets the start time, as the reminder itself does.
    private var start: (time: String, dish: String, explanation: String?)? {
        var best: (minutes: Int, dish: String, explanation: String?)?
        for recipe in dishes {
            let est = estimates[recipe.id]
            let stated = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0)
            let minutes = est?.minutes ?? (stated > 0 ? stated : 45)
            if best == nil || minutes > best!.minutes { best = (minutes, recipe.title, est?.explanation) }
        }
        guard let best else { return nil }
        return (Self.clock(Self.minutes(day.time) - best.minutes), best.dish, best.explanation)
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 5) {
                Image(systemName: day.reminderEnabled ? "alarm" : "bell.slash")
                Text(compact ? day.time : "Dinner \(day.time)")
                if day.overridden && !compact { Text("· changed").opacity(0.85) }
                if let start, day.reminderEnabled, !day.overridden {
                    Text(compact ? "· \(start.time)" : "· start \(start.time)").opacity(0.8)
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, compact ? 8 : 10).frame(height: 28)
            .foregroundStyle(day.overridden ? .white : day.reminderEnabled ? Color(hex: 0x9A3412) : Theme.mutedForeground)
            .background {
                if day.overridden {
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xF97316), Color(hex: 0xF43F5E)], startPoint: .leading, endPoint: .trailing))
                } else {
                    Capsule().fill(day.reminderEnabled ? Color(hex: 0xFFEDD5) : Theme.muted)
                }
            }
            .overlay(Capsule().strokeBorder(day.overridden ? .clear : day.reminderEnabled ? Color(hex: 0xFED7AA) : Theme.border,
                                            style: StrokeStyle(lineWidth: 1, dash: day.reminderEnabled ? [] : [3, 2])))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Dinner time \(day.time)" + (day.overridden ? ", changed for this day" : ""))
        .sheet(isPresented: $open) {
            DinnerDaySheet(date: date, day: day, start: start, changed: changed).presentationDetents([.medium, .large])
        }
    }

    static func minutes(_ hhmm: String) -> Int {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? p[0] * 60 + p[1] : 0
    }

    static func clock(_ total: Int) -> String {
        let t = ((total % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", t / 60, t % 60)
    }
}

private struct DinnerDaySheet: View {
    @Environment(\.dismiss) private var dismiss
    let date: Date
    let day: WeekDinnerSchedule.Day
    let start: (time: String, dish: String, explanation: String?)?
    var changed: (WeekDinnerSchedule.Day) -> Void
    @State private var time = Date()
    @State private var working = false

    private var label: String { date.formatted(.dateTime.weekday(.wide).day().month(.wide)) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let start {
                        VStack(alignment: .leading, spacing: 3) {
                            (Text("Start ") + Text(start.dish).bold() + Text(" by ") + Text(start.time).bold())
                            if let why = start.explanation {
                                Text("It \(why).").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Text("No dinner planned for this day yet.").foregroundStyle(.secondary)
                    }
                }
                Section {
                    DatePicker("Dinner time", selection: $time, displayedComponents: .hourAndMinute)
                    Button("Save for this day") { Task { await set(time: Self.hhmm(time)) } }
                        .disabled(working || Self.hhmm(time) == day.time)
                    if day.overridden {
                        Button("Use default (\(day.defaultTime))") { Task { await set(time: nil) } }.disabled(working)
                    }
                } footer: { Text("A change here applies to this date only. Your usual times stay as they are.") }
                Section {
                    Toggle(isOn: Binding(get: { day.reminderEnabled }, set: { on in Task { await setReminder(on) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(day.reminderEnabled ? "Reminder on" : "No reminder this day")
                            Text(day.reminderEnabled ? "Turn off when you’re eating out or someone else is cooking."
                                 : "Turn on to get the reminder again.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .tint(Theme.brand)
                    .disabled(working)
                }
            }
            .navigationTitle("Dinner on \(label)").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.bold() } }
            .onAppear {
                let f = DateFormatter(); f.dateFormat = "HH:mm"
                time = f.date(from: day.time) ?? time
            }
        }
    }

    private static func hhmm(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    private func set(time: String?) async {
        working = true
        defer { working = false }
        do {
            let updated = try await AppModel.shared.api.action("dinner.setTime", [.string(localDateKey(date)), time.map { .string($0) } ?? .null],
                                                               as: WeekDinnerSchedule.Day.self)
            changed(updated)
            AppModel.shared.toast = time.map { "Dinner set to \($0) for \(label)" } ?? "Back to \(day.defaultTime)"
            dismiss()
        } catch { AppModel.shared.toast = WebAction.explain(error) }
    }

    private func setReminder(_ on: Bool) async {
        working = true
        defer { working = false }
        do {
            changed(try await AppModel.shared.api.action("dinner.setReminder", [.string(localDateKey(date)), .bool(on)],
                                                         as: WeekDinnerSchedule.Day.self))
        } catch { AppModel.shared.toast = WebAction.explain(error) }
    }
}

// MARK: Delivery

struct DeliveryDayChip: View {
    let day: DeliveryOverview.Day
    let canEdit: Bool
    var changed: () async -> Void
    @State private var editing = false

    private var label: String {
        switch day.status {
        case "ordered": day.slot.map { "Delivery \($0)" } ?? "Ordered"
        case "skipped": "No delivery"
        default: "Delivery"
        }
    }

    private var detail: String {
        switch day.status {
        case "ordered":
            let parts = [day.slot, day.total.map { "£\($0.text)" }].compactMap { $0 }
            return parts.isEmpty ? "Order placed" : parts.joined(separator: " · ")
        case "skipped": return day.awayLabel.map { "Skipped: \($0)" } ?? "Skipped this week"
        default: return day.cutoffPassed ? "Order deadline passed" : "Order by \(day.cutoffLabel)"
        }
    }

    var body: some View {
        Menu {
            Section("\(day.label) delivery — \(detail)") {
                if canEdit {
                    switch day.status {
                    case "scheduled":
                        Button("Mark as ordered", systemImage: "checkmark") { set("ordered", "Marked as ordered") }
                        Button("Ordered — add slot & total", systemImage: "square.and.pencil") { editing = true }
                        Button(day.regular ? "Skip this delivery" : "Remove this delivery", systemImage: "forward") {
                            set(day.regular ? "skipped" : "default", "Delivery skipped")
                        }
                    case "ordered":
                        Button("Edit order details", systemImage: "square.and.pencil") { editing = true }
                        Button("Not ordered yet", systemImage: "arrow.uturn.backward") { set("scheduled", "Order unmarked") }
                    default:
                        Button("Restore delivery", systemImage: "arrow.counterclockwise") { set("scheduled", "Delivery restored") }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "truck.box")
                Text(label).strikethrough(day.status == "skipped")
            }
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 10).frame(height: 28)
            .foregroundStyle(day.status == "ordered" ? .white : day.status == "skipped" ? Theme.mutedForeground : Color(hex: 0x115E59))
            .background {
                if day.status == "ordered" {
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0x059669), Color(hex: 0x14B8A6)], startPoint: .leading, endPoint: .trailing))
                } else {
                    Capsule().fill(day.status == "skipped" ? Theme.muted : Color(hex: 0xCCFBF1))
                }
            }
            .overlay(Capsule().strokeBorder(day.status == "scheduled" ? Color(hex: 0x5EEAD4).opacity(0.7) : .clear))
        }
        .accessibilityLabel("Delivery: \(label)")
        .sheet(isPresented: $editing) { OrderSheet(day: day) { await changed() } }
    }

    private func set(_ target: String, _ done: String) {
        Task {
            if await WebAction.run("deliveries.set", [.string(day.date), .string(target)], done: done) { await changed() }
        }
    }
}
