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
    /// A scheduled combined dinner's first cue (the reminders use it too).
    struct Scheduled: Decodable, Sendable { var start: String; var title: String; var recipeIds: [String] }
    var days: [Day]
    var estimates: [String: Estimate]
    /// Keyed by day of the week, as a string ("0"…"6") in JSON.
    var scheduled: [String: Scheduled]?
}

struct WeekDeliveryPanel: Decodable, Sendable {
    var configured: Bool
    var canEdit: Bool
    var days: [DeliveryOverview.Day]
    /// The next open order, when it's this week's or feeds this week's meals.
    var next: DeliveryOverview.Next?
    /// Holidays overlapping the week (missing from older servers).
    var away: [DeliveryOverview.Away]?

    /// The holiday covering a "YYYY-MM-DD" date, if any.
    func away(on date: String) -> DeliveryOverview.Away? {
        away?.first { $0.from <= date && date <= $0.to }
    }
}

/// The planner's nutrition strip for the week (lib/services/week-nutrition.ts).
struct WeekNutrition: Decodable, Sendable {
    struct Summary: Decodable, Sendable {
        var meals: Int
        var withNutrition: Int
        var heartHealthy: Int
        var avgSaturatedFatG: Double?
        var avgFiberG: Double?
    }
    struct Target: Decodable, Sendable, Identifiable {
        var kind: String; var label: String; var count: Int; var ok: Bool; var target: String
        var id: String { kind }
    }
    struct SwapRecipe: Decodable, Sendable, Identifiable { var id: String; var title: String; var cuisine: String? }
    struct Suggestion: Decodable, Sendable, Identifiable {
        var entryId: String; var dayOfWeek: Int; var mealType: String
        var fromTitle: String; var reason: String
        var toRecipe: SwapRecipe?
        var alternatives: [SwapRecipe]
        var id: String { entryId }
    }
    var summary: Summary
    var heartFocus: Bool
    var targets: [Target]
    var suggestions: [Suggestion]
}

/// The week's dinner times and deliveries, reloaded when the week or its
/// dinners change.
@MainActor @Observable
final class PlanWeekExtras {
    private(set) var dinner: WeekDinnerSchedule?
    private(set) var deliveries: WeekDeliveryPanel?
    private(set) var nutrition: WeekNutrition?
    private var loadedWeek: String?

    func load(week: String, dinnerRecipeIds: [String]) async {
        let api = AppModel.shared.api
        async let d = try? api.action("dinner.week", [.string(week), .array(dinnerRecipeIds.map { .string($0) })],
                                      as: WeekDinnerSchedule.self)
        async let p = try? api.action("deliveries.weekPanel", [.string(week)], as: WeekDeliveryPanel.self)
        async let n = try? api.action("planner.nutrition", [.string(week)], as: WeekNutrition.self)
        let (dinner, deliveries, nutrition) = await (d, p, n)
        // Another week's figures never stay up; a failed reload of the same
        // week (offline) keeps what's shown.
        if loadedWeek != week { self.dinner = nil; self.deliveries = nil; self.nutrition = nil; loadedWeek = week }
        if let dinner { self.dinner = dinner }
        if let deliveries { self.deliveries = deliveries }
        if let nutrition { self.nutrition = nutrition }
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
    var scheduled: WeekDinnerSchedule.Scheduled? = nil
    /// Fewer words, for a column of the whole-week grid.
    var compact = false
    var changed: (WeekDinnerSchedule.Day) -> Void
    @State private var open = false

    /// When to start, as the reminders do: a scheduled combined meal at its
    /// schedule's first cue, any other dish by its estimate, longest first.
    private var start: (time: String, dish: String, explanation: String?)? {
        var best: (minutes: Int, dish: String, explanation: String?)? = scheduled.map {
            (Self.minutes(day.time) - Self.minutes($0.start), $0.title, "follows the meal’s cooking schedule")
        }
        for recipe in dishes where !(scheduled?.recipeIds.contains(recipe.id) ?? false) {
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
            .foregroundStyle(day.overridden ? .white : day.reminderEnabled ? Color(light: 0x9A3412, dark: 0xFDBA74) : Theme.mutedForeground)
            .background {
                if day.overridden {
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xF97316), Color(hex: 0xF43F5E)], startPoint: .leading, endPoint: .trailing))
                } else {
                    Capsule().fill(day.reminderEnabled ? Theme.orange50 : Theme.muted)
                }
            }
            .overlay(Capsule().strokeBorder(day.overridden ? .clear : day.reminderEnabled ? Color(light: 0xFED7AA, dark: 0x7C2D12) : Theme.border,
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

// MARK: Holiday

/// "Away · Cornwall" on a day the household is on holiday (week-planner.tsx).
struct AwayDayChip: View {
    let away: DeliveryOverview.Away

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "airplane")
            Text(away.label.map { "Away · \($0)" } ?? "Away")
        }
        .font(.system(size: 12, weight: .semibold))
        .lineLimit(1)
        .padding(.horizontal, 10).frame(height: 28)
        .foregroundStyle(.white)
        .background(Capsule().fill(LinearGradient(colors: [Color(hex: 0x0EA5E9), Color(hex: 0x06B6D4)],
                                                  startPoint: .leading, endPoint: .trailing)))
        .accessibilityLabel(away.label.map { "Away: \($0)" } ?? "Away")
    }
}

// MARK: Not cooking

/// "Ate out?" (today and before) / "Not cooking?" (ahead): opens the meal-out
/// sheet for the day's dinner. Hidden once dinner has one — its card says it.
struct NotCookingChip: View {
    let past: Bool
    var compact = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "fork.knife")
                Text(compact ? (past ? "Ate out?" : "Out?") : past ? "Ate out?" : "Not cooking?")
            }
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 10).frame(height: 28)
            .foregroundStyle(Color(light: 0x78350F, dark: 0xFDE68A))
            .background(Capsule().fill(LinearGradient(colors: [Theme.amber50, Theme.orange50],
                                                      startPoint: .leading, endPoint: .trailing)))
            .overlay(Capsule().strokeBorder(Color(hex: 0xFCD34D).opacity(0.7)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(past ? "Log a meal eaten out" : "Not cooking this day")
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

// MARK: The week's strips — heart-healthy and the next order

/// Two small banners under the planner's buttons. Each is one line with what
/// needs attention; tapping opens the detail.
struct PlanWeekStrips: View {
    let extras: PlanWeekExtras
    var reload: () async -> Void
    var swapped: () async -> Void
    @State private var showing: Which?

    private enum Which: String, Identifiable { case nutrition, delivery; var id: String { rawValue } }

    var body: some View {
        let next = extras.deliveries?.next
        let nutrition = extras.nutrition.flatMap { $0.summary.meals > 0 ? $0 : nil }
        VStack(alignment: .leading, spacing: 0) {
            if next != nil || nutrition != nil {
                // Always one line: on a narrow phone it scrolls rather than
                // pushing the days down.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { strips(next: next, nutrition: nutrition) }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) { strips(next: next, nutrition: nutrition) }
                    }
                }
            }
        }
        .sheet(item: $showing) { which in
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            switch which {
                            case .delivery:
                                if let next, let panel = extras.deliveries {
                                    NextDeliveryCard(next: next, canEdit: panel.canEdit) { await reload() }
                                }
                                NavigationLink { DeliveriesScreen() } label: {
                                    Label("All deliveries", systemImage: "truck.box")
                                }
                                .buttonStyle(.outline)
                            case .nutrition:
                                if let nutrition { NutritionDetail(nutrition: nutrition) { await swapped() } }
                            }
                        }
                        .padding(20)
                    }
                    .background(Theme.background)
                    .navigationTitle(which == .delivery ? "Next order" : "This week’s nutrition")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showing = nil }.bold() } }
                }
                .presentationDetents([.medium, .large])
            }
    }

    /// Small pills, so the day's meals stay near the top. The order pill only
    /// shows while there's something to do for it; the nutrition one always
    /// does when the week has meals, as the way into the swaps.
    @ViewBuilder private func strips(next: DeliveryOverview.Next?, nutrition: WeekNutrition?) -> some View {
        if let next, next.status != "ordered" || NextDeliveryCard.toDo(next) > 0 {
            let toDo = NextDeliveryCard.toDo(next)
            // "Saturday" → "Sat"; "Today" and "Tomorrow" stay as they are.
            let day = Calendar.current.weekdaySymbols.contains(next.day) ? String(next.day.prefix(3)) : next.day
            pill(icon: "truck.box", text: next.status == "ordered" ? "Ordered \(day)" : "Order \(day)",
                 note: toDo > 0 ? "\(toDo) to do" : nil, noteIcon: "exclamationmark.triangle.fill", noteTint: Self.warn,
                 tint: Color(light: 0x047857, dark: 0x34D399), fill: Theme.emerald100.opacity(0.7),
                 border: Color(light: 0xA7F3D0, dark: 0x065F46)) { showing = .delivery }
            .accessibilityLabel("Next order, \(next.day)" + (toDo > 0 ? ", \(toDo) to do" : ""))
        }
        if let nutrition {
            let s = nutrition.summary
            let off = nutrition.heartFocus ? nutrition.targets.filter { !$0.ok }.count : 0
            let swaps = nutrition.suggestions.count
            pill(icon: "heart.fill", text: s.withNutrition > 0 ? "\(s.heartHealthy)/\(s.withNutrition)" : "Nutrition",
                 note: swaps > 0 ? "\(swaps) swap\(swaps == 1 ? "" : "s")" : off > 0 ? "\(off) off" : nil,
                 noteIcon: swaps > 0 ? "lightbulb.fill" : "exclamationmark.triangle.fill",
                 noteTint: swaps > 0 ? Color(light: 0x7C3AED, dark: 0xA78BFA) : Self.warn,
                 tint: Color(hex: 0xE11D48), fill: Theme.rose50,
                 border: off > 0 ? Color(light: 0xFCD34D, dark: 0x92400E) : Color(light: 0xFECDD3, dark: 0x881337)) { showing = .nutrition }
            .accessibilityLabel("\(s.heartHealthy) of \(s.withNutrition) meals heart-healthy"
                                + (off > 0 ? ", \(off) target\(off == 1 ? "" : "s") off" : "")
                                + (swaps > 0 ? ", \(swaps) swap\(swaps == 1 ? "" : "s") suggested" : ""))
        }
    }

    private static let warn = Color(light: 0xB45309, dark: 0xFBBF24)

    private func pill(icon: String, text: String, note: String?, noteIcon: String, noteTint: Color,
                      tint: Color, fill: Color, border: Color, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 5) {
                Image(systemName: icon).foregroundStyle(tint)
                Text(text).foregroundStyle(Theme.foreground)
                if let note {
                    Text("·").foregroundStyle(Theme.mutedForeground)
                    Label(note, systemImage: noteIcon).labelStyle(TightLabel()).foregroundStyle(noteTint)
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(fill, in: Capsule())
            .overlay(Capsule().strokeBorder(border))
        }
        .buttonStyle(.plain)
    }
}

/// The nutrition strip opened: the heart-healthy share, the weekly protein
/// targets (when someone's on a cholesterol-lowering diet) and swaps that close the gaps.
private struct NutritionDetail: View {
    let nutrition: WeekNutrition
    var swapped: () async -> Void
    @State private var working: String?

    private static let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var body: some View {
        let s = nutrition.summary
        HStack(spacing: 10) {
            StatTile(value: s.withNutrition > 0 ? "\(s.heartHealthy)/\(s.withNutrition)" : "—", label: "Heart-healthy")
            StatTile(value: s.avgSaturatedFatG.map { "\(Self.num($0))g" } ?? "—", label: "Sat. fat / meal")
            StatTile(value: s.avgFiberG.map { "\(Self.num($0))g" } ?? "—", label: "Fibre / meal")
        }
        if !nutrition.targets.isEmpty {
            WebSection(title: "Weekly targets") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(nutrition.targets) { t in
                        HStack {
                            Label(t.label, systemImage: t.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                .foregroundStyle(t.ok ? Color(hex: 0x047857) : Color(hex: 0xB45309))
                            Spacer()
                            Text("\(t.count) · \(t.target)").foregroundStyle(Theme.mutedForeground)
                        }
                        .font(.system(size: 14))
                    }
                }
                .padding(14).card()
            }
        }
        if !nutrition.suggestions.isEmpty {
            WebSection(title: "Suggested swaps") {
                VStack(spacing: 10) {
                    ForEach(nutrition.suggestions) { sg in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(Self.days[min(max(sg.dayOfWeek, 0), 6)]) \(sg.mealType) · \(sg.reason)")
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                            Text(sg.fromTitle).font(.system(size: 15, weight: .semibold)).strikethrough(working == sg.entryId)
                            ForEach([sg.toRecipe].compactMap { $0 } + sg.alternatives.prefix(2), id: \.id) { r in
                                Button { Task { await swap(sg, to: r) } } label: {
                                    Label("Swap for \(r.title)", systemImage: "arrow.triangle.2.circlepath")
                                        .font(.system(size: 14, weight: .medium))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.outline)
                                .disabled(working != nil)
                            }
                            if sg.toRecipe == nil && sg.alternatives.isEmpty {
                                Text("Nothing in your recipes fits — try Create with AI.").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading).card()
                    }
                }
            }
        }
    }

    private func swap(_ sg: WeekNutrition.Suggestion, to recipe: WeekNutrition.SwapRecipe) async {
        working = sg.entryId
        defer { working = nil }
        if await WebAction.run("planner.swap", [.string(sg.entryId), .string(recipe.id)], done: "Swapped in \(recipe.title).") {
            await AppModel.shared.syncNow()
            await swapped()
        }
    }

    private static func num(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
}
