// The Home Screen and Lock Screen widgets (TODO_MOBILE.md, D4), read from the
// App Group database the app syncs (Shared/HouseholdData.swift reads it the
// way the Planner and Shopping tabs do), so they work with no signal:
//
//   Tonight     today's meal (dinner, or the meal type the widget is set to):
//               its dishes, serve time and Start cooking. Small, medium, and
//               the Lock Screen's rectangular and inline slots
//   This week   Monday to Sunday, one meal type or all of them — the iPad's
//               large and extra-large sizes
//   Shopping    what's left to get, an aisle or all of them, each with a tick
//               button (TickShoppingItemIntent) that works offline and sends
//               the tick straight away when it can
//
// The app reloads them after every sync and local change
// (`WidgetCenter.reloadAllTimelines()` in AppModel); otherwise Tonight and
// This week roll over at midnight.

import AppIntents
import DishesCore
import SwiftUI
import WidgetKit

// MARK: The store

enum WidgetStore {
    /// The app's database, once the app has made it: opening the group path
    /// first would create an empty one there, and the app moves its own
    /// database in only when nothing's at the group path yet
    /// (LocalStore.moveDatabase).
    static let shared: LocalStore? = {
        guard let url = AppGroup.databaseURL, FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try? LocalStore(sharedPath: url.path)
    }()

    static func read<T: Sendable>(_ body: @Sendable @escaping (StoreReader) throws -> T) async -> T? {
        guard let store = shared else { return nil }
        return try? await store.read(body)
    }
}

// MARK: Colours

/// The app's Theme, copied (the extension can't see app code): the Tonight
/// card's orange-to-rose, the AI violet, the shopping blue.
enum WidgetTheme {
    static let brand = Color(red: 0.976, green: 0.451, blue: 0.086)    // #F97316
    static let rose = Color(red: 0.957, green: 0.247, blue: 0.369)     // #F43F5E
    static let violet = Color(red: 0.486, green: 0.227, blue: 0.929)   // #7C3AED
    static let blue = Color(red: 0.145, green: 0.388, blue: 0.922)     // #2563EB
    static let sky = Color(red: 0.055, green: 0.647, blue: 0.914)      // #0EA5E9
    static let tonight = LinearGradient(colors: [brand, rose], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let week = LinearGradient(colors: [violet, brand], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let shopping = LinearGradient(colors: [blue, sky], startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// A widget's background: its gradient in full colour; in the tinted and clear
/// Home Screen styles the system draws its own, so none.
private struct WidgetBackground: ViewModifier {
    @Environment(\.widgetRenderingMode) private var mode
    let gradient: LinearGradient
    func body(content: Content) -> some View {
        content.containerBackground(for: .widget) {
            if mode == .fullColor { gradient } else { Color.clear }
        }
    }
}

private extension View {
    func widgetBackground(_ gradient: LinearGradient) -> some View { modifier(WidgetBackground(gradient: gradient)) }
}

// MARK: Settings

enum WidgetMeal: String, AppEnum {
    case tonight, breakfast, lunch, dinner, dessert

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Meal" }
    static var caseDisplayRepresentations: [WidgetMeal: DisplayRepresentation] {
        [.tonight: "Tonight’s (dinner, or the last meal today)", .breakfast: "Breakfast", .lunch: "Lunch",
         .dinner: "Dinner", .dessert: "Dessert"]
    }

    /// nil: tonight's, however PlanData.today picks it.
    var mealType: String? { self == .tonight ? nil : rawValue }
}

struct TonightWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Tonight" }
    static var description: IntentDescription { "Today’s meal from the planner, ready to cook." }
    @Parameter(title: "Meal", default: .tonight) var meal: WidgetMeal
}

enum WidgetWeekMeals: String, AppEnum {
    case all, breakfast, lunch, dinner

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Meals" }
    static var caseDisplayRepresentations: [WidgetWeekMeals: DisplayRepresentation] {
        [.all: "Every meal", .breakfast: "Breakfasts", .lunch: "Lunches", .dinner: "Dinners"]
    }
}

struct WeekWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "This Week" }
    static var description: IntentDescription { "The week’s meals from the planner." }
    @Parameter(title: "Meals", default: .dinner) var meals: WidgetWeekMeals
}

/// An aisle as the list has it. Categories are free text ("Meat & Fish" as
/// well as "Meat"), so the choices are the list's own aisles, then the usual ones.
struct AisleEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Aisle" }
    static var defaultQuery: AisleQuery { AisleQuery() }
    var id: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(id)") }
}

struct AisleQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [AisleEntity] { identifiers.map(AisleEntity.init) }

    func suggestedEntities() async throws -> [AisleEntity] {
        let onList = await WidgetStore.read(ShoppingData.load)?.groups.map(\.name) ?? []
        var seen = Set<String>()
        return (onList + shoppingCategories).filter { seen.insert($0).inserted }.map(AisleEntity.init)
    }
}

struct ShoppingWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Shopping" }
    static var description: IntentDescription { "What’s left on the shopping list. Tick things off from here." }
    /// Empty for every aisle.
    @Parameter(title: "Aisle") var aisle: AisleEntity?
}

// MARK: Tonight

struct TonightEntry: TimelineEntry {
    var date: Date
    /// "Tonight", "Lunch".
    var heading: String
    var title: String?
    var dishes: [String] = []
    var serveAt: String?
    var minutes: Int?
    var link: URL
    /// The app hasn't made its database yet: open it once.
    var noData = false
}

struct TonightProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TonightEntry {
        TonightEntry(date: .now, heading: "Tonight · Dinner", title: "Spaghetti Carbonara", dishes: ["Spaghetti Carbonara"],
                     minutes: 25, link: WidgetLink.cook(mealType: "dinner").url)
    }

    func snapshot(for configuration: TonightWidgetIntent, in context: Context) async -> TonightEntry {
        await entry(configuration.meal, now: .now) ?? placeholder(in: context)
    }

    func timeline(for configuration: TonightWidgetIntent, in context: Context) async -> Timeline<TonightEntry> {
        let now = Date.now
        let entry = await entry(configuration.meal, now: now) ?? TonightEntry(
            date: now, heading: "Tonight", link: WidgetLink.plan.url, noData: true)
        return Timeline(entries: [entry], policy: .after(Self.nextMidnight(after: now)))
    }

    static func nextMidnight(after date: Date) -> Date {
        let start = Calendar.current.startOfDay(for: date)
        return Calendar.current.date(byAdding: .minute, value: 24 * 60 + 1, to: start)!
    }

    func entry(_ meal: WidgetMeal, now: Date) async -> TonightEntry? {
        guard let data = await WidgetStore.read(PlanData.load) else { return nil }
        let planned = data.today(meal.mealType, now: now)
        let type = planned?.mealType ?? meal.mealType ?? "dinner"
        let heading = meal == .tonight ? "Tonight · \(type.capitalized)" : "Today · \(type.capitalized)"
        guard let planned else { return TonightEntry(date: now, heading: heading, link: WidgetLink.plan.url) }
        let recipes = planned.dishes.compactMap(\.recipe)
        let minutes = recipes.compactMap(\.totalMinutes).max()
        return TonightEntry(date: now, heading: heading, title: planned.title ?? recipes.map(\.title).joined(separator: " + "),
                            dishes: recipes.map(\.title), serveAt: planned.serveAt, minutes: minutes,
                            link: WidgetLink.cook(mealType: planned.mealType).url)
    }
}

struct TonightWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "uk.collco.dishes.tonight", intent: TonightWidgetIntent.self, provider: TonightProvider()) {
            TonightView(entry: $0)
        }
        .configurationDisplayName("Tonight")
        .description("Today’s meal from the planner, with Start cooking.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct TonightView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: TonightEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(entry.title ?? "Nothing planned", systemImage: "fork.knife")
                .widgetURL(entry.link)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.heading.uppercased()).font(.system(size: 11, weight: .semibold)).widgetAccentable()
                Text(entry.title ?? "Nothing planned").font(.system(size: 15, weight: .bold)).lineLimit(2)
                if let time = timeLine { Text(time).font(.system(size: 12)).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color.clear }
            .widgetURL(entry.link)
        default:
            card
        }
    }

    private var timeLine: String? {
        [entry.serveAt.map { "Served \($0)" }, entry.minutes.map { "\($0) min" }].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
    }

    private var text: Color { mode == .fullColor ? .white : .primary }

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.heading.uppercased())
                .font(.system(size: 11, weight: .bold)).tracking(0.6)
                .foregroundStyle(text.opacity(0.85))
                .widgetAccentable()
            if entry.noData {
                Text("Open Dishes once to see your plan here.").font(.system(size: 15, weight: .semibold)).foregroundStyle(text)
                Spacer(minLength: 0)
            } else if let title = entry.title {
                Text(title)
                    .font(.system(size: family == .systemSmall ? 17 : 20, weight: .bold))
                    .foregroundStyle(text)
                    .lineLimit(family == .systemSmall ? 3 : 2)
                if family == .systemMedium, entry.dishes.count > 1 {
                    Text(entry.dishes.joined(separator: " · ")).font(.system(size: 12)).foregroundStyle(text.opacity(0.85)).lineLimit(1)
                }
                if let time = timeLine {
                    Label(time, systemImage: "clock").font(.system(size: 12, weight: .medium)).foregroundStyle(text.opacity(0.9))
                }
                Spacer(minLength: 0)
                if family == .systemMedium {
                    HStack(spacing: 8) {
                        Link(destination: entry.link) { pill("Start cooking", icon: "frying.pan.fill", solid: true) }
                        Link(destination: WidgetLink.plan.url) { pill("Planner", icon: "calendar", solid: false) }
                    }
                }
            } else {
                Text("Nothing planned").font(.system(size: 18, weight: .bold)).foregroundStyle(text)
                Spacer(minLength: 0)
                Link(destination: WidgetLink.plan.url) { pill("Plan a meal", icon: "calendar.badge.plus", solid: true) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetBackground(WidgetTheme.tonight)
        .widgetURL(entry.link)
    }

    /// The card's button: white with brand text (Start cooking, as on the
    /// Recipes tab's card), or a see-through white one beside it.
    private func pill(_ title: String, icon: String, solid: Bool) -> some View {
        Label(title, systemImage: icon)
            .font(.system(size: 13, weight: .bold))
            .padding(.horizontal, 12).frame(height: 32)
            .foregroundStyle(mode == .fullColor ? (solid ? WidgetTheme.brand : .white) : .primary)
            .background(mode == .fullColor ? Color.white.opacity(solid ? 1 : 0.25) : Color.primary.opacity(0.12), in: Capsule())
            .widgetAccentable(solid)
    }
}

// MARK: This week

struct WeekEntry: TimelineEntry {
    struct Day: Hashable { var name: String; var date: Date; var isToday: Bool; var meals: [String] }
    var date: Date
    var title: String
    var days: [Day]
    var noData = false
}

struct WeekProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WeekEntry {
        let week = Week.containing(.now)
        return WeekEntry(date: .now, title: "Dinners this week", days: (0..<7).map {
            .init(name: week.day($0).formatted(.dateTime.weekday(.abbreviated)), date: week.day($0), isToday: $0 == Week.todayIndex,
                  meals: [["Shakshuka", "Thai Green Curry", "Fish Tacos", "Mushroom Risotto", "Smash Burgers", "Bolognese", "Roast"][$0]])
        })
    }

    func snapshot(for configuration: WeekWidgetIntent, in context: Context) async -> WeekEntry {
        await entry(configuration.meals, now: .now) ?? placeholder(in: context)
    }

    func timeline(for configuration: WeekWidgetIntent, in context: Context) async -> Timeline<WeekEntry> {
        let now = Date.now
        let entry = await entry(configuration.meals, now: now) ?? WeekEntry(date: now, title: "This week", days: [], noData: true)
        return Timeline(entries: [entry], policy: .after(TonightProvider.nextMidnight(after: now)))
    }

    func entry(_ meals: WidgetWeekMeals, now: Date) async -> WeekEntry? {
        guard let data = await WidgetStore.read(PlanData.load) else { return nil }
        let week = Week.containing(now)
        let today = Week.dayIndex(of: now)
        let days = (0..<7).map { n -> WeekEntry.Day in
            let planned = data.meals(on: n, in: week).filter { meals == .all || $0.mealType == meals.rawValue }
            let titles = planned.map { meal in
                let name = meal.title ?? meal.dishes.compactMap(\.recipe?.title).joined(separator: " + ")
                return meals == .all ? "\(meal.mealType.capitalized): \(name)" : name
            }
            return .init(name: week.day(n).formatted(.dateTime.weekday(.abbreviated)), date: week.day(n), isToday: n == today, meals: titles)
        }
        let title = switch meals {
        case .all: "This week"
        case .breakfast: "Breakfasts this week"
        case .lunch: "Lunches this week"
        case .dinner: "Dinners this week"
        }
        return WeekEntry(date: now, title: title, days: days)
    }
}

struct WeekWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "uk.collco.dishes.week", intent: WeekWidgetIntent.self, provider: WeekProvider()) {
            WeekView(entry: $0)
        }
        .configurationDisplayName("This Week")
        .description("Monday to Sunday from the planner.")
        .supportedFamilies([.systemLarge, .systemExtraLarge])
    }
}

struct WeekView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: WeekEntry

    private var text: Color { mode == .fullColor ? .white : .primary }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(entry.title, systemImage: "calendar").font(.system(size: 15, weight: .bold)).foregroundStyle(text)
                    .widgetAccentable()
                Spacer()
            }
            if entry.noData {
                Text("Open Dishes once to see your plan here.").font(.system(size: 14)).foregroundStyle(text)
                Spacer(minLength: 0)
            } else if family == .systemExtraLarge {
                HStack(alignment: .top, spacing: 8) { ForEach(entry.days, id: \.self) { column($0) } }
            } else {
                VStack(spacing: 5) { ForEach(entry.days, id: \.self) { row($0) } }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetBackground(WidgetTheme.week)
        .widgetURL(WidgetLink.plan.url)
    }

    /// A day as a row (large): its name, then its meals.
    private func row(_ day: WeekEntry.Day) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(day.name.uppercased()).font(.system(size: 11, weight: .bold)).frame(width: 34, alignment: .leading)
            Text(day.meals.isEmpty ? "—" : day.meals.joined(separator: " · "))
                .font(.system(size: 14, weight: day.isToday ? .bold : .medium)).lineLimit(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(text.opacity(day.meals.isEmpty ? 0.6 : 1))
        .padding(.horizontal, 10).frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
        .background(tile(day.isToday), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// A day as a column (extra large, the iPad).
    private func column(_ day: WeekEntry.Day) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(day.name.uppercased()).font(.system(size: 11, weight: .bold))
            Text(day.date.formatted(.dateTime.day())).font(.system(size: 20, weight: .bold))
            ForEach(day.meals, id: \.self) { Text($0).font(.system(size: 13, weight: .semibold)).lineLimit(3) }
            Spacer(minLength: 0)
        }
        .foregroundStyle(text)
        .padding(10).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(tile(day.isToday), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func tile(_ today: Bool) -> Color {
        mode == .fullColor ? .white.opacity(today ? 0.32 : 0.14) : .primary.opacity(today ? 0.16 : 0.06)
    }
}

// MARK: Shopping

struct ShoppingEntry: TimelineEntry {
    struct Item: Hashable { var id: String; var name: String; var quantity: String? }
    var date: Date
    var aisle: String
    var left: Int
    var items: [Item]
    var noData = false
}

struct ShoppingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ShoppingEntry {
        ShoppingEntry(date: .now, aisle: "Shopping", left: 6, items: [
            .init(id: "1", name: "Milk", quantity: "2 l"), .init(id: "2", name: "Spaghetti", quantity: "400 g"),
            .init(id: "3", name: "Lemons", quantity: "2"), .init(id: "4", name: "Parmesan", quantity: nil)])
    }

    func snapshot(for configuration: ShoppingWidgetIntent, in context: Context) async -> ShoppingEntry {
        await entry(configuration.aisle) ?? placeholder(in: context)
    }

    func timeline(for configuration: ShoppingWidgetIntent, in context: Context) async -> Timeline<ShoppingEntry> {
        let entry = await entry(configuration.aisle) ?? ShoppingEntry(date: .now, aisle: "Shopping", left: 0, items: [], noData: true)
        return Timeline(entries: [entry], policy: .never)
    }

    func entry(_ aisle: AisleEntity?) async -> ShoppingEntry? {
        guard let data = await WidgetStore.read(ShoppingData.load) else { return nil }
        let open = data.groups.filter { aisle == nil || $0.name == aisle?.id }.flatMap(\.items)
        return ShoppingEntry(date: .now, aisle: aisle?.id ?? "Shopping", left: open.count, items: open.map {
            .init(id: $0.id, name: $0.name, quantity: Format.quantity($0.amount, $0.unit).nilIfEmpty)
        })
    }
}

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "uk.collco.dishes.shopping", intent: ShoppingWidgetIntent.self, provider: ShoppingProvider()) {
            ShoppingView(entry: $0)
        }
        .configurationDisplayName("Shopping")
        .description("What’s left on the list — tick things off without opening the app.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular])
    }
}

struct ShoppingView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: ShoppingEntry

    private var text: Color { mode == .fullColor ? .white : .primary }
    private var shown: Int {
        switch family {
        case .systemLarge: 8
        case .systemMedium: 3
        default: 0
        }
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: 0, label: { Image(systemName: "cart") }, currentValueLabel: { Text("\(entry.left)") })
                .gaugeStyle(.accessoryCircularCapacity)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(WidgetLink.shopping.url)
        case .systemSmall:
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: "cart.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(text).widgetAccentable()
                Spacer(minLength: 0)
                Text("\(entry.left)").font(.system(size: 40, weight: .bold)).foregroundStyle(text)
                Text(entry.left == 1 ? "item to get" : "items to get").font(.system(size: 13, weight: .medium)).foregroundStyle(text.opacity(0.85))
                if entry.aisle != "Shopping" { Text(entry.aisle).font(.system(size: 12)).foregroundStyle(text.opacity(0.75)) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetBackground(WidgetTheme.shopping)
            .widgetURL(WidgetLink.shopping.url)
        default:
            list
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: family == .systemMedium ? 5 : 6) {
            HStack {
                Label(entry.aisle, systemImage: "cart.fill").font(.system(size: 15, weight: .bold)).foregroundStyle(text).widgetAccentable()
                Spacer()
                Text("\(entry.left) left").font(.system(size: 13, weight: .semibold)).foregroundStyle(text.opacity(0.85))
            }
            if entry.noData {
                Text("Open Dishes once to see your list here.").font(.system(size: 14)).foregroundStyle(text)
            } else if entry.items.isEmpty {
                Label("All done", systemImage: "checkmark.circle.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(text)
            } else {
                ForEach(entry.items.prefix(shown), id: \.self) { item in
                    Button(intent: TickShoppingItemIntent(itemId: item.id)) {
                        HStack(spacing: 10) {
                            Image(systemName: "circle").font(.system(size: 18, weight: .semibold))
                            Text(item.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                            Spacer(minLength: 4)
                            if let q = item.quantity { Text(q).font(.system(size: 12)).opacity(0.8) }
                        }
                        .foregroundStyle(text)
                        .padding(.horizontal, 10).frame(height: family == .systemMedium ? 27 : 30)
                        .background(mode == .fullColor ? Color.white.opacity(0.16) : Color.primary.opacity(0.06),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                if entry.items.count > shown {
                    Text("+ \(entry.items.count - shown) more").font(.system(size: 12, weight: .medium)).foregroundStyle(text.opacity(0.8))
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetBackground(WidgetTheme.shopping)
        .widgetURL(WidgetLink.shopping.url)
    }
}

/// A tick from the Shopping widget: written to the database and queued in one
/// go, as a tick in the app is (LocalStore.setShoppingItem), so it's kept with
/// no signal; then sent straight away, so the rest of the household sees it,
/// unless that takes longer than a widget is given.
struct TickShoppingItemIntent: AppIntent {
    static var title: LocalizedStringResource { "Tick Off Item" }
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Item") var itemId: String

    init() {}
    init(itemId: String) { self.itemId = itemId }

    func perform() async throws -> some IntentResult {
        guard let store = WidgetStore.shared else { return .result() }
        guard try await store.setShoppingItem(itemId, checked: true) else { return .result() }
        if let api = ExtensionAPI.client() {
            let engine = SyncEngine(store: store, transport: api)
            await withTaskGroup(of: Void.self) { group in
                group.addTask { _ = try? await engine.sync(force: true) }
                group.addTask { try? await Task.sleep(for: .seconds(8)) }
                await group.next()
                group.cancelAll()
            }
        }
        return .result()
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
