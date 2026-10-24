// Grocery deliveries, as the web's /settings/deliveries: the next open order
// with what's still to do, the next four weeks of delivery days (mark ordered,
// skip, add details, add a one-off), holidays, your reminders, and the
// household's delivery days and order deadline (admins).

import DishesCore
import SwiftUI

/// A number or a numeric string from the server, shown as text.
struct LooseText: Decodable, Sendable, Hashable {
    var text: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s }
        else if let d = try? c.decode(Double.self) { text = d == d.rounded() ? String(Int(d)) : String(format: "%.2f", d) }
        else { text = "" }
    }
}

struct DeliveryOverview: Decodable, Sendable {
    struct Settings: Decodable, Sendable {
        var weekdays: [Int]
        var cutoffTime: String
        var cutoffDaysBefore: Int
        var reminderTimes: [String]
        var minOrderTotal: LooseText?
        /// Missing from older servers.
        var bookingReminderDays: Int?
        var timezone: String
    }
    struct Away: Codable, Sendable, Hashable, Identifiable {
        var from: String
        var to: String
        var label: String?
        var id: String { from + to }
    }
    struct Day: Decodable, Sendable, Identifiable, Hashable {
        var date: String
        var label: String
        var status: String
        var regular: Bool
        var awayLabel: String?
        var slot: String?
        var total: LooseText?
        var orderReference: String?
        var cutoffLabel: String
        var cutoffPassed: Bool
        var belowMinimum: String?
        var id: String { date }
    }
    struct Next: Decodable, Sendable {
        var date: String
        var label: String
        var day: String
        var status: String
        var slot: String?
        var total: LooseText?
        var cutoffLabel: String
        var coverageLabel: String
        var unplannedDinners: String?
        var unplannedCount: Int
        var mealsNotOnList: Int
        var unticked: Int
        var addedSinceOrder: [String]
        var belowMinimum: String?
    }
    var settings: Settings
    var configured: Bool
    var awayPeriods: [Away]
    var upcoming: [Day]
    var next: Next?
    var optedIn: Bool
    var isAdmin: Bool
    var canEdit: Bool
    var today: String
}

struct DeliveriesScreen: View {
    @State private var data = Remote<DeliveryOverview>("deliveries.overview")
    @State private var ordering: DeliveryOverview.Day?
    @State private var addingAway = false
    @State private var editingAway: DeliveryOverview.Away?
    @State private var addingOneOff = false
    @State private var editingSettings = false

    var body: some View {
        WebPage(title: "Deliveries", subtitle: "Delivery days, holidays, and reminders before orders close.", data: data) { o in
            if !o.configured {
                VStack(alignment: .leading, spacing: 10) {
                    Label("No delivery days yet", systemImage: "truck.box").font(.system(size: 16, weight: .semibold))
                    Text("Pick the days your shopping arrives and when orders close.")
                        .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                    if o.isAdmin {
                        Button("Set up deliveries") { editingSettings = true }.buttonStyle(.gradient(.emeraldTeal))
                    }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .callout(Theme.emerald100.opacity(0.5), Theme.background, border: Color(hex: 0xA7F3D0))
            }
            if let next = o.next { nextCard(next, canEdit: o.canEdit) }

            Toggle(isOn: Binding(get: { o.optedIn }, set: { on in
                Task { if await WebAction.run("deliveries.setReminders", [.bool(on)]) { await data.load() } }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Remind me before orders close").font(.system(size: 15, weight: .semibold))
                    Text("At \(o.settings.reminderTimes.joined(separator: ", ")) on deadline day")
                        .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
            }
            .tint(Theme.brand)
            .padding(14).card()

            WebSection(title: "Next four weeks", action: o.canEdit ? ("One-off", "plus", { addingOneOff = true }) : nil) {
                if o.upcoming.isEmpty {
                    EmptyBox(emoji: "🚚", message: "No deliveries in the next four weeks")
                } else {
                    CardList(items: o.upcoming) { day in dayRow(day, canEdit: o.canEdit) }
                }
            }

            WebSection(title: "Holidays & time away", action: o.canEdit ? ("Add", "plus", { addingAway = true }) : nil) {
                if o.awayPeriods.isEmpty {
                    Text("Every delivery in a holiday is skipped.").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                } else {
                    CardList(items: o.awayPeriods) { away in
                        HStack {
                            Image(systemName: "airplane").foregroundStyle(Theme.mutedForeground)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(away.label?.isEmpty == false ? away.label! : "Away").font(.system(size: 15, weight: .medium))
                                Text("\(Self.short(away.from)) – \(Self.short(away.to))")
                                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                            if o.canEdit {
                                Menu {
                                    Button("Edit", systemImage: "pencil") { editingAway = away }
                                    Button("Remove", systemImage: "trash", role: .destructive) {
                                        Task { if await WebAction.run("deliveries.removeAway", [.string(away.from), .string(away.to)]) { await data.load() } }
                                    }
                                } label: { Image(systemName: "ellipsis").frame(width: 34, height: 34) }
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                }
            }

            if o.isAdmin && o.configured {
                Button { editingSettings = true } label: {
                    Label("Delivery days and deadline", systemImage: "gearshape")
                }
                .buttonStyle(.outline)
            }
        }
        .sheet(item: $ordering) { day in OrderSheet(day: day) { await data.load() } }
        .sheet(isPresented: $addingAway) { AwaySheet(original: nil) { await data.load() } }
        .sheet(item: $editingAway) { away in AwaySheet(original: away) { await data.load() } }
        .sheet(isPresented: $addingOneOff) { OneOffSheet { await data.load() } }
        .sheet(isPresented: $editingSettings) {
            if let s = data.value?.settings { DeliverySettingsSheet(settings: s) { await data.load() } }
        }
    }

    private func nextCard(_ n: DeliveryOverview.Next, canEdit: Bool) -> some View {
        NextDeliveryCard(next: n, canEdit: canEdit) { await data.load() }
    }

    private func dayRow(_ day: DeliveryOverview.Day, canEdit: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(day.label).font(.system(size: 15, weight: .semibold))
                    if !day.regular { BadgeView(text: "One-off", style: .outline) }
                }
                Text(day.awayLabel.map { "Away · \($0)" } ?? [day.slot, day.total.map { "£\($0.text)" }, day.cutoffLabel]
                        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                if let min = day.belowMinimum {
                    Text("Under the \(min) minimum").font(.system(size: 12, weight: .medium)).foregroundStyle(Color(hex: 0xB45309))
                }
            }
            Spacer()
            statusBadge(day.awayLabel != nil ? "away" : day.status)
            if canEdit && day.awayLabel == nil {
                Menu {
                    if day.status != "ordered" {
                        Button("Mark as ordered", systemImage: "checkmark.circle") { set(day, "ordered") }
                    }
                    Button("Order details…", systemImage: "square.and.pencil") { ordering = day }
                    if day.status != "skipped" {
                        Button("Skip this delivery", systemImage: "forward") { set(day, "skipped") }
                    }
                    if day.status != "scheduled" || !day.regular {
                        Button(day.regular ? "Back to scheduled" : "Remove one-off", systemImage: "arrow.uturn.backward") { set(day, "default") }
                    }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold))
                        .frame(width: 34, height: 34).background(Theme.muted, in: Circle())
                }
                .foregroundStyle(Theme.foreground)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func set(_ day: DeliveryOverview.Day, _ target: String) {
        Task { if await WebAction.run("deliveries.set", [.string(day.date), .string(target)]) { await data.load() } }
    }

    private func statusBadge(_ status: String) -> some View { DeliveryStatusBadge(status: status) }
}

/// "To order", "Ordered", "Skipped" or "Away".
struct DeliveryStatusBadge: View {
    let status: String
    var body: some View {
        let (text, fg, bg): (String, Color, Color) = switch status {
        case "ordered": ("Ordered", Color(hex: 0x047857), Theme.emerald100)
        case "skipped": ("Skipped", Theme.mutedForeground, Theme.muted)
        case "away": ("Away", Theme.mutedForeground, Theme.muted)
        default: ("To order", Color(hex: 0xB45309), Theme.amber50)
        }
        return Text(text).font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(fg).background(bg, in: Capsule())
    }
}

extension DeliveriesScreen {

    static func short(_ date: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: date) else { return date }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func iso(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.calendar = Calendar(identifier: .gregorian)
        return f.string(from: date)
    }
}

/// Slot, total and reference for an order — saving marks it ordered.
struct OrderSheet: View {
    @Environment(\.dismiss) private var dismiss
    let day: DeliveryOverview.Day
    var saved: () async -> Void
    @State private var slot = ""
    @State private var total = ""
    @State private var reference = ""

    var body: some View {
        NavigationStack {
            Form {
                Section(day.label) {
                    TextField("Slot (e.g. 18:00-19:00)", text: $slot)
                    TextField("Total (£)", text: $total).keyboardType(.decimalPad)
                    TextField("Order reference", text: $reference)
                }
                Section { Text("Saving marks the order as placed.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Order details").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let t = Double(total.replacingOccurrences(of: "£", with: "").trimmingCharacters(in: .whitespaces))
                            let ok = await WebAction.run("deliveries.saveOrder", [.string(day.date), .object([
                                "slot": slot.isEmpty ? .null : .string(slot),
                                "total": t.map { .number($0) } ?? .null,
                                "orderReference": reference.isEmpty ? .null : .string(reference)])])
                            if ok { await saved(); dismiss() }
                        }
                    }.bold()
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear { slot = day.slot ?? ""; total = day.total?.text ?? ""; reference = day.orderReference ?? "" }
    }
}

/// A holiday: every delivery in it is skipped.
private struct AwaySheet: View {
    @Environment(\.dismiss) private var dismiss
    let original: DeliveryOverview.Away?
    var saved: () async -> Void
    @State private var from = Date()
    @State private var to = Date().addingTimeInterval(7 * 86400)
    @State private var label = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Label (e.g. Cornwall)", text: $label)
                DatePicker("From", selection: $from, displayedComponents: .date)
                DatePicker("To", selection: $to, in: from..., displayedComponents: .date)
            }
            .navigationTitle(original == nil ? "Add time away" : "Edit time away").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let period = DeliveryOverview.Away(from: DeliveriesScreen.iso(from), to: DeliveriesScreen.iso(to),
                                                               label: label.isEmpty ? nil : label)
                            let ok = if let original {
                                await WebAction.run("deliveries.updateAway", [arg(original), arg(period)])
                            } else {
                                await WebAction.run("deliveries.addAway", [arg(period)])
                            }
                            if ok { await saved(); dismiss() }
                        }
                    }.bold()
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            guard let original else { return }
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
            from = f.date(from: original.from) ?? from
            to = f.date(from: original.to) ?? to
            label = original.label ?? ""
        }
    }
}

/// An extra delivery on a day that isn't a regular one.
private struct OneOffSheet: View {
    @Environment(\.dismiss) private var dismiss
    var saved: () async -> Void
    @State private var date = Date().addingTimeInterval(86400)

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Delivery on", selection: $date, in: Date()..., displayedComponents: .date)
                Text("It gets the same deadline reminders as a regular delivery.").font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("One-off delivery").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            if await WebAction.run("deliveries.set", [.string(DeliveriesScreen.iso(date)), .string("scheduled")]) {
                                await saved(); dismiss()
                            }
                        }
                    }.bold()
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// The household's delivery days, deadline and reminder times (admins).
private struct DeliverySettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let settings: DeliveryOverview.Settings
    var saved: () async -> Void
    @State private var weekdays: Set<Int> = []
    @State private var cutoff = Date()
    @State private var daysBefore = 1
    @State private var reminders = ""
    @State private var minimum = ""
    @State private var bookingDays = 3

    private static let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Delivery days") {
                    ForEach(0..<7, id: \.self) { d in
                        Toggle(Self.names[d], isOn: Binding(get: { weekdays.contains(d) },
                                                           set: { if $0 { weekdays.insert(d) } else { weekdays.remove(d) } }))
                            .tint(Theme.brand)
                    }
                }
                Section("Orders close") {
                    DatePicker("At", selection: $cutoff, displayedComponents: .hourAndMinute)
                    Stepper("\(daysBefore) day\(daysBefore == 1 ? "" : "s") before", value: $daysBefore, in: 0...3)
                }
                Section {
                    TextField("09:00, 19:00, 22:00", text: $reminders)
                } header: { Text("Reminder times on deadline day") }
                Section {
                    Picker("Remind us", selection: $bookingDays) {
                        Text("Don’t remind").tag(0)
                        ForEach([2, 3, 4, 5, 7].filter { $0 > daysBefore }, id: \.self) { Text("\($0) days before").tag($0) }
                    }
                } header: { Text("Book a delivery") } footer: {
                    Text("If no order has been logged by then, a reminder to book a slot goes at the first reminder time.")
                }
                Section {
                    TextField("e.g. 50", text: $minimum).keyboardType(.decimalPad)
                } header: { Text("Minimum order (£, optional)") }
            }
            .navigationTitle("Delivery settings").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.bold() }
            }
        }
        .onAppear {
            weekdays = Set(settings.weekdays)
            daysBefore = settings.cutoffDaysBefore
            reminders = settings.reminderTimes.joined(separator: ", ")
            minimum = settings.minOrderTotal?.text ?? ""
            bookingDays = settings.bookingReminderDays ?? 3
            let f = DateFormatter(); f.dateFormat = "HH:mm"
            cutoff = f.date(from: settings.cutoffTime) ?? cutoff
        }
    }

    private func save() async {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        let times = reminders.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let ok = await WebAction.run("deliveries.saveSettings", [.object([
            "weekdays": .array(weekdays.sorted().map { .number(Double($0)) }),
            "cutoffTime": .string(f.string(from: cutoff)),
            "cutoffDaysBefore": .number(Double(daysBefore)),
            "reminderTimes": .array(times.map { .string($0) }),
            "minOrderTotal": Double(minimum).map { .number($0) } ?? .null,
            "bookingReminderDays": .number(Double(bookingDays > daysBefore ? bookingDays : 0)),
            "timezone": .string(settings.timezone),
        ])], done: "Delivery settings saved.")
        if ok { await saved(); dismiss() }
    }
}

/// The next open order and what's still to do before it (the web's
/// next-delivery-card.tsx): on Deliveries, and from the planner's strip.
struct NextDeliveryCard: View {
    let next: DeliveryOverview.Next
    let canEdit: Bool
    var changed: () async -> Void

    var body: some View {
        let n = next
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("NEXT ORDER").font(.system(size: 12, weight: .bold)).tracking(0.6).foregroundStyle(Color(hex: 0x047857))
                    Text(n.label.hasPrefix(String(n.day.prefix(3))) ? n.label : "\(n.day) \(n.label)").font(.system(size: 20, weight: .bold))
                    Text("Covers \(n.coverageLabel) · \(n.cutoffLabel)").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
                DeliveryStatusBadge(status: n.status)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(Self.checklist(n).enumerated()), id: \.offset) { _, line in
                    Label(line.text, systemImage: line.done ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(line.done ? Color(hex: 0x047857) : Color(hex: 0xB45309))
                }
            }
            if canEdit && n.status != "ordered" {
                Button {
                    Task { if await WebAction.run("deliveries.set", [.string(n.date), .string("ordered")], done: "Marked as ordered.") { await changed() } }
                } label: { Label("Mark as ordered", systemImage: "checkmark.circle") }
                .buttonStyle(.gradient(.emeraldTeal))
            }
        }
        .padding(16)
        .callout(Theme.emerald100.opacity(0.6), Theme.background, border: Color(hex: 0xA7F3D0))
    }

    /// What's left before ordering, done items included.
    static func checklist(_ n: DeliveryOverview.Next) -> [(done: Bool, text: String)] {
        var lines: [(Bool, String)] = [
            (n.unplannedCount == 0, n.unplannedCount == 0 ? "Every dinner planned"
                : "\(n.unplannedCount) dinner\(n.unplannedCount == 1 ? "" : "s") not planned (\(n.unplannedDinners ?? ""))"),
            (n.mealsNotOnList == 0, n.mealsNotOnList == 0 ? "All meals on the list"
                : "\(n.mealsNotOnList) meal\(n.mealsNotOnList == 1 ? "" : "s") not on the list yet"),
            (n.unticked == 0, n.unticked == 0 ? "Everything’s in the basket"
                : "\(n.unticked) item\(n.unticked == 1 ? "" : "s") not ticked off"),
        ]
        if !n.addedSinceOrder.isEmpty { lines.append((false, "Added since ordering: \(n.addedSinceOrder.joined(separator: ", "))")) }
        if let min = n.belowMinimum { lines.append((false, "Under the \(min) minimum")) }
        return lines
    }

    /// How many checklist lines still need doing.
    static func toDo(_ n: DeliveryOverview.Next) -> Int { checklist(n).filter { !$0.done }.count }
}
