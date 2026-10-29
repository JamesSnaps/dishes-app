// The Watch's complications and Smart Stack cards, drawn from the Watch app's
// copy of the snapshot in the App Group (WatchStore). The app reloads them
// whenever what they show changes.
//
//   Shopping   items left to get; opens the list
//   Tonight    the cook in progress and its next timer, else tonight's meal and
//              its next step on the schedule; opens either

import SwiftUI
import WidgetKit

@main
struct DishesWatchWidgets: WidgetBundle {
    var body: some Widget {
        ShoppingWidget()
        TonightWidget()
    }
}

// Cookbook terracotta and herb, their dark-mode values (DESIGN.md).
private let brand = Color(red: 0xE0 / 255, green: 0x7A / 255, blue: 0x5F / 255)
private let rose = brand
private let emerald = Color(red: 0x8F / 255, green: 0xBF / 255, blue: 0x9F / 255)

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WatchSnapshot
}

// MARK: Shopping

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "shopping", provider: ShoppingProvider()) { entry in
            ShoppingWidgetView(snapshot: entry.snapshot)
                .containerBackground(emerald.gradient, for: .widget)
                .widgetURL(URL(string: "dishes-watch://shopping"))
        }
        .configurationDisplayName("Shopping List")
        .description("How much is left to get.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

private struct ShoppingProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: .sample) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snapshot: context.isPreview ? .sample : WatchStore.load() ?? .empty))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: WatchStore.load() ?? .empty)], policy: .never))
    }
}

private struct ShoppingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WatchSnapshot

    private var left: Int { snapshot.openCount }

    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label("Shopping", systemImage: "cart.fill")
                    .font(.headline)
                    .foregroundStyle(emerald)
                    .widgetAccentable()
                Text(left == 0 ? "Nothing to get" : "\(left) to get").font(.body.weight(.semibold))
                let next = snapshot.items.filter { !$0.checked }.prefix(2).map(\.name)
                if !next.isEmpty {
                    Text(next.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .accessoryInline:
            Label(left == 0 ? "Shopping done" : "\(left) to get", systemImage: "cart")
        case .accessoryCorner:
            Image(systemName: "cart.fill")
                .font(.system(size: 20, weight: .semibold))
                .widgetLabel(left == 0 ? "Done" : "\(left) to get")
        default:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "cart.fill").font(.system(size: 12, weight: .semibold))
                    Text("\(left)").font(.system(size: 20, weight: .bold, design: .rounded))
                }
                .widgetAccentable()
            }
            .accessibilityLabel("\(left) shopping items to get")
        }
    }
}

// MARK: Tonight

struct TonightWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "tonight", provider: TonightProvider()) { entry in
            TonightWidgetView(entry: entry)
                .containerBackground(brand,
                                     for: .widget)
                .widgetURL(URL(string: "dishes-watch://tonight"))
        }
        .configurationDisplayName("Tonight")
        .description("Tonight’s meal and its next step, or the timer of the cook in progress.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

private struct TonightProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: .sample) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snapshot: context.isPreview ? .sample : WatchStore.load() ?? .empty))
    }

    /// A new entry at each schedule cue and each timer's end, so "next" moves on by itself.
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let snapshot = WatchStore.load() ?? .empty
        let now = Date()
        let cueTimes = snapshot.tonight?.cues.map(\.at) ?? []
        let timerEnds = snapshot.cooking.flatMap(\.timers).compactMap(\.endsAt)
        let serve = snapshot.tonight?.serveAt.map { [$0, $0.addingTimeInterval(60 * 60)] } ?? []
        let times = Set((cueTimes + timerEnds + serve).filter { $0 > now && $0 < now.addingTimeInterval(24 * 3600) })
        let entries = [SnapshotEntry(date: now, snapshot: snapshot)]
            + times.sorted().prefix(60).map { SnapshotEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .never))
    }
}

private struct TonightWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var cook: WatchCook? { entry.snapshot.cooking.first }
    private var meal: WatchMeal? { entry.snapshot.tonight }
    /// The cook's soonest timer still to go off.
    private var timer: WatchTimer? {
        cook?.timers.filter { $0.state == .running && ($0.endsAt ?? .distantPast) > entry.date }
            .min { ($0.endsAt ?? .distantFuture) < ($1.endsAt ?? .distantFuture) }
    }
    private var nextCue: WatchCue? { meal?.cues.first { $0.at > entry.date } }
    /// Within an hour of serving (or before it): after that, tonight's done.
    private var mealCurrent: Bool { meal?.serveAt.map { $0.addingTimeInterval(3600) > entry.date } ?? (meal != nil) }

    var body: some View {
        switch family {
        case .accessoryRectangular: rectangular
        case .accessoryInline: inline
        case .accessoryCorner:
            Image(systemName: cook != nil ? "flame.fill" : "fork.knife")
                .font(.system(size: 20, weight: .semibold))
                .widgetLabel { cornerLabel }
        default: circular
        }
    }

    @ViewBuilder private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let cook {
                Label(cook.dish, systemImage: "flame.fill")
                    .font(.headline).foregroundStyle(brand).widgetAccentable().lineLimit(1)
                if let timer, let ends = timer.endsAt {
                    Text(timerInterval: entry.date...ends, countsDown: true)
                        .font(.body.weight(.semibold)).monospacedDigit()
                    Text(timer.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Text("Step \(cook.step) of \(cook.totalSteps)").font(.body.weight(.semibold))
                    Text(cook.instruction).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            } else if let meal, mealCurrent {
                Label("Tonight", systemImage: "fork.knife")
                    .font(.headline).foregroundStyle(brand).widgetAccentable()
                Text(meal.title).font(.body.weight(.semibold)).lineLimit(1)
                if let cue = nextCue {
                    Text("\(cue.at, format: .dateTime.hour().minute()) \(cue.dish.map { "\($0): " } ?? "")\(cue.text)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else if let serve = meal.serveAt, serve > entry.date {
                    Text("Serve at \(serve, format: .dateTime.hour().minute())").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Label("Tonight", systemImage: "fork.knife")
                    .font(.headline).foregroundStyle(brand).widgetAccentable()
                Text("Nothing planned").font(.body).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var inline: some View {
        if let timer, let ends = timer.endsAt {
            Text("\(Image(systemName: "timer")) \(Text(timerInterval: entry.date...ends, countsDown: true)) \(timer.label)")
        } else if cook != nil, let cook {
            Label("Step \(cook.step) of \(cook.totalSteps)", systemImage: "flame")
        } else if let meal, mealCurrent {
            if let cue = nextCue {
                Label("\(cue.at.formatted(.dateTime.hour().minute())) \(cue.text)", systemImage: "fork.knife")
            } else {
                Label(meal.title, systemImage: "fork.knife")
            }
        } else {
            Label("Nothing planned", systemImage: "fork.knife")
        }
    }

    @ViewBuilder private var cornerLabel: some View {
        if let timer, let ends = timer.endsAt {
            Text(timerInterval: entry.date...ends, countsDown: true)
        } else if let cue = nextCue, mealCurrent {
            Text(cue.at, format: .dateTime.hour().minute())
        } else {
            Text(meal?.title ?? "Dishes")
        }
    }

    @ViewBuilder private var circular: some View {
        if let timer, let ends = timer.endsAt {
            ProgressView(timerInterval: (ends.addingTimeInterval(-max(timer.duration ?? 600, 60)))...ends, countsDown: true) {
                Image(systemName: "timer")
            } currentValueLabel: {
                Text(timerInterval: entry.date...ends, countsDown: true).monospacedDigit()
            }
            .progressViewStyle(.circular)
            .widgetAccentable()
        } else {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: cook != nil ? "flame.fill" : "fork.knife").font(.system(size: 14, weight: .semibold))
                    if let cue = nextCue, mealCurrent {
                        Text(cue.at, format: .dateTime.hour().minute()).font(.system(size: 12, weight: .bold)).monospacedDigit()
                    }
                }
                .widgetAccentable()
            }
        }
    }
}

private extension WatchSnapshot {
    /// What the watch face gallery shows.
    static var sample: WatchSnapshot {
        let now = Date()
        return WatchSnapshot(
            signedIn: true, listName: "This week",
            items: [WatchItem(id: "1", name: "Milk", quantity: "2 pints", category: "Dairy", checked: false),
                    WatchItem(id: "2", name: "Lemons", quantity: "3", category: "Produce", checked: false)],
            tonight: WatchMeal(title: "Roast chicken", dishes: ["Roast chicken", "Roast potatoes"],
                               serveAt: now.addingTimeInterval(90 * 60),
                               cues: [WatchCue(at: now.addingTimeInterval(20 * 60), dish: "Roast potatoes", text: "Into the oven")]),
            cooking: [], applied: [], syncedAt: now, madeAt: now)
    }
}
