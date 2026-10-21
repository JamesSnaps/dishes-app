// Sign-in, or the app shell: the native floating tab bar — Liquid Glass,
// across the top on iPad (its sidebar button turns it into a sidebar) and at
// the bottom on iPhone. The screens themselves follow the web's design; the
// chrome around them follows the platform's (James, 17 Oct 2026: "adopt the
// design language of the iPad").
//
// The shopping count is a badge on its tab, as the web shows it in its sidebar.
// The top bar is the default on iPad (`.defaultAdaptableTabBarPlacement`); its
// sidebar button is still there for anyone who wants one.
//
// The tabs: Recipes, Planner, AI, Shopping, Settings — the web's bottom nav,
// whose AI button sits in the middle too. There's no Home tab: Recipes opens
// on browse mode, which took over what Home showed (James, 17 Oct 2026).
//
// Tonight's meal: a large card at the top of Recipes' browse mode on every
// device, and on iPhone also a "Cook tonight" pill above the tab bar (its
// bottom accessory). The pill was too easy to miss on an iPad's wide screen
// (James, 17 Oct 2026), so iPads get the card only.
//
//   RootView()   // DishesApp's only scene content

import DishesCore
import SwiftUI

/// Which screen is showing, plus the cross-screen jumps the web does with
/// links (a recipe the AI tab writes opens in Recipes).
@MainActor @Observable
final class AppNav {
    enum Tab: String, CaseIterable { case recipes, plan, ai, shopping, more }

    var tab: Tab = Tab(rawValue: UserDefaults.standard.string(forKey: "tab") ?? "") ?? .recipes {
        didSet {
            UserDefaults.standard.set(tab.rawValue, forKey: "tab")
            reportActivity()
        }
    }

    /// For MetricKit's reports: what the person is doing (Diagnostics).
    func reportActivity() {
        let activity: AppActivity = if cookingShown { .cooking } else {
            switch tab {
            case .recipes, .more: .browsing
            case .plan: .planning
            case .ai: .ai
            case .shopping: .shopping
            }
        }
        Diagnostics.entered(activity)
    }
    var favouritesOnly = false
    var recipeSearch = ""
    /// A recipe for Recipes to open, which it clears once shown.
    var openedRecipe: String?
    /// A recipe page sent as dishes://import?url=…, for Recipes to import; it
    /// clears it once the import sheet is up.
    var importLink: WebImportLink? {
        didSet { if importLink != nil { tab = .recipes } }
    }
    /// The cookbook, when it's open (Book/CookbookView.swift).
    var book: BookRequest?
    /// Focus the shopping list's add field, which it clears once done (the
    /// Control Center control).
    var focusShoppingAdd = false
    /// The cooks in progress, the one in front first; kept while minimised
    /// (CookingView, CookingBar). Dinner and dessert can go at once, as on the web.
    private(set) var sessions: [CookSession] = [] {
        didSet { SavedCooks.save(sessions) }
    }
    /// The cook in front: the one cooking mode shows and the resume bar leads with.
    var session: CookSession? { sessions.first }
    /// Whether cooking mode is on screen; false while minimised. Minimising
    /// saves where every cook is up to.
    var cookingShown = false {
        didSet {
            if !cookingShown { SavedCooks.save(sessions) }
            reportActivity()
        }
    }
    /// The resume bar's stack fanned out into every cook (CookStackFan).
    var cooksFanned = false
    /// The cooks saved at the last launch are back (or there were none), so a
    /// Live Activity's tap can find its cook (CookLinkHandler).
    private(set) var cooksRestored = false

    /// Setting a request starts cooking it and shows cooking mode — or, for
    /// dishes already cooking, brings that cook back. Other cooks keep going
    /// behind it. nil ends the cook in front.
    var cooking: CookRequest? {
        get { session?.request }
        set {
            if let newValue {
                if let live = sessions.first(where: { $0.isCooking(newValue) }) {
                    open(live)
                } else {
                    sessions.insert(CookSession(request: newValue), at: 0)
                    cookingShown = true
                }
            } else if let session {
                end(session)
            }
        }
    }

    /// Brings a cook to the front and shows it in cooking mode.
    func open(_ cook: CookSession) {
        bringToFront(cook)
        cooksFanned = false
        cookingShown = true
    }

    /// Puts a cook in front without changing whether cooking mode is showing.
    /// (Cooking mode moves the Live Activity to it as it appears.)
    func bringToFront(_ cook: CookSession) {
        guard let i = sessions.firstIndex(where: { $0 === cook }), i > 0 else { return }
        sessions.insert(sessions.remove(at: i), at: 0)
    }

    /// Ends one cook (a meal's whole cook): cooking mode closes, and the Live
    /// Activity moves to the next cook, if any.
    func end(_ cook: CookSession, cancelTimers: Bool = false) {
        if cancelTimers {
            for timer in cook.timers where timer.state != .finished { CookTimers.shared.cancel(timer) }
        }
        let wasFront = cook === session
        sessions.removeAll { $0 === cook }
        if wasFront { cookingShown = false }
        if sessions.count < 2 { cooksFanned = false }
        if let next = session {
            // After the screen has moved on: starting an activity holds the main thread a moment.
            if wasFront { Task { @MainActor in next.showActivity() } }
        } else {
            CookingActivity.shared.end()
        }
    }

    /// The cooks going when the app was last put away (SavedCooks), back as
    /// they were — minimised — once the local store is open.
    func restoreCooks(from store: LocalStore) async {
        guard sessions.isEmpty, let cooks = await SavedCooks.load(from: store), !cooks.isEmpty else {
            if sessions.isEmpty { CookingActivity.shared.endLeftovers() }
            cooksRestored = true
            return
        }
        sessions = cooks
        cooksRestored = true
        CookingActivity.shared.adoptLeftover()
        Task { @MainActor in cooks[0].showActivity() }
        // A meal's schedule, so the bar can say where in it each cook is.
        for cook in cooks where cook.clock == nil {
            guard let groupId = cook.request.groupId,
                  let clock = try? await AppModel.shared.api.mealClock(groupId: groupId) else { continue }
            if cook.clock == nil { cook.clock = clock }
        }
    }

    func openRecipe(_ id: String) {
        openedRecipe = id
        tab = .recipes
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @State private var nav = AppNav()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch app.phase {
            case .starting:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.background)
            case .signedOut:
                SignInView()
            case .ready:
                shell
            }
        }
        .environment(nav)
        // Toasts get a window of their own, so they show above sheets too.
        .background(ToastWindow.Installer(app: app))
        // A finished timer rings wherever you are in the app, not only in cooking mode.
        .overlay(alignment: .top) { RingingBanner() }
        .fullScreenCover(isPresented: $nav.cookingShown) {
            CookingCover().environment(nav)
        }
        // A tapped cooking Live Activity: that cook, at its step.
        .modifier(CookLinkHandler(nav: nav))
        .task { await app.start() }
    }

    @State private var shoppingCount = Observed(0)
    @State private var windowSize: CGSize = .zero
    private var posture: FoldPosture { Hinge.shared.posture(for: windowSize) }
    @State private var tonight = Observed<CookRequest?>(nil)
    /// Where the resume bar is on screen, for the stack drawn around it.
    @State private var barFrame: CGRect = .zero

    private var shell: some View {
        @Bindable var nav = nav
        return TabView(selection: $nav.tab) {
            Tab("Recipes", systemImage: "book", value: AppNav.Tab.recipes) { RecipesScreen() }
            Tab("Planner", systemImage: "calendar", value: AppNav.Tab.plan) {
                PlanScreen().handoff(.plan, title: "Meal planner", isActive: nav.tab == .plan)
            }
            Tab("AI", systemImage: "sparkles", value: AppNav.Tab.ai) {
                ConciergeSheet(inTab: true) { nav.openRecipe($0) }
            }
            Tab("Shopping", systemImage: "cart", value: AppNav.Tab.shopping) {
                ShoppingScreen().handoff(.shopping, title: "Shopping list", isActive: nav.tab == .shopping)
            }
                .badge(shoppingCount.value)
            Tab("Settings", systemImage: "gearshape", value: AppNav.Tab.more) { MoreScreen() }
        }
        .tabViewStyle(.sidebarAdaptable)
        .defaultAdaptableTabBarPlacement(.tabBar)
        .tint(Theme.brand)
        .tabViewBottomAccessory(isEnabled: (nav.session != nil || tonight.value != nil) && width == .compact) {
            if let session = nav.session {
                // Filling the accessory, so its frame is the glass capsule's.
                CookingBar(session: session)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { barFrame = $0 }
            }
            else if let request = tonight.value { CookTonightPill(request: request) }
        }
        // On iPad the tabs are at the top, so the minimised cook floats at the bottom.
        .overlay(alignment: .bottom) {
            if width == .regular, let session = nav.session, !nav.cookingShown {
                CookingBar(session: session)
                    .padding(.vertical, 10)
                    .frame(maxWidth: 560)
                    .background(.regularMaterial, in: Capsule())
                    .background { CookStackPeek(count: nav.sessions.count - 1) }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { barFrame = $0 }
                    .shadow(color: .black.opacity(0.15), radius: 14, y: 6)
                    .padding(.bottom, 24)
                    .opacity(nav.cooksFanned ? 0 : 1)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        // The iPhone's accessory clips what's drawn outside it, so the other
        // cooks' card edges are drawn above it from out here.
        .overlay {
            if width == .compact, nav.sessions.count > 1, !nav.cooksFanned {
                CookStackEdges(count: nav.sessions.count - 1, bar: barFrame)
            }
        }
        // Two or more cooks: the bar's stack fanned out, over everything.
        .overlay {
            if nav.cooksFanned, nav.sessions.count > 1, !nav.cookingShown {
                CookStackFan(bar: barFrame)
            }
        }
        .task {
            await shoppingCount.follow(app.store) { r in
                let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
                guard let active = lists.first(where: { $0.status == "active" }) else { return 0 }
                return try r.records(.shoppingItems).compactMap(ShoppingItem.init)
                    .filter { $0.listId == active.id && !$0.isChecked }.count
            }
        }
        .task { await tonight.follow(app.store, TonightMeal.load) }
        .task { await nav.restoreCooks(from: app.store) }
        // Steps move without the list changing, so they're saved as the app goes away too.
        .onChange(of: scenePhase) { _, phase in if phase != .active { SavedCooks.save(nav.sessions) } }
        #if DEBUG
        // `-DishesCookTonight YES`: straight into cooking tonight's meal (checking the Watch, RUNBOOK.md).
        .onChange(of: tonight.value?.title) {
            guard UserDefaults.standard.bool(forKey: "DishesCookTonight"), nav.cooking == nil, let request = tonight.value else { return }
            nav.cooking = request
        }
        #endif
        // iPhone Duo: half-folded like a book opens the cookbook; opening it flat closes it again.
        .background { HingeObserver() }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { windowSize = $0 }
        .onChange(of: posture) { _, posture in
            if posture == .book, nav.book == nil, !nav.cookingShown {
                nav.book = BookRequest(recipeIds: nil, byHinge: true)
            } else if posture != .book, nav.book?.byHinge == true {
                nav.book = nil
            }
        }
        .fullScreenCover(item: $nav.book) { request in
            CookbookView(request: request).environment(nav)
        }
        // The Control Center control: the shopping list, ready to type.
        .onChange(of: AppRequests.shared.shoppingAdd, initial: true) { _, wanted in
            guard wanted else { return }
            AppRequests.shared.shoppingAdd = false
            nav.tab = .shopping
            nav.focusShoppingAdd = true
        }
        // Siri / Shortcuts: "Start cooking …". Held until the cooks saved at the
        // last launch are back, so it doesn't start a second copy of one.
        .onChange(of: AppRequests.shared.cook == nil || !nav.cooksRestored, initial: true) { _, waiting in
            guard !waiting, let request = AppRequests.shared.cook else { return }
            AppRequests.shared.cook = nil
            Task {
                switch request {
                case .tonight:
                    // A double optional: an unreadable store, or nothing to cook tonight.
                    if let tonight = (try? await app.store.read(TonightMeal.load)) ?? nil { nav.cooking = tonight } else { nav.tab = .plan }
                case .today(let mealType):
                    if let meal = (try? await app.store.read { try TonightMeal.load($0, mealType: mealType) }) ?? nil {
                        nav.cooking = meal
                    } else {
                        nav.tab = .plan
                    }
                case .recipe(let id):
                    await openCooking(id)
                }
            }
        }
        // A recipe tapped in Spotlight.
        .onChange(of: AppRequests.shared.openRecipe, initial: true) { _, id in
            guard let id else { return }
            AppRequests.shared.openRecipe = nil
            nav.openRecipe(id)
        }
        // The Shopping widget.
        .onChange(of: AppRequests.shared.showShopping, initial: true) { _, wanted in
            guard wanted else { return }
            AppRequests.shared.showShopping = false
            nav.tab = .shopping
        }
        // "What's for dinner?": the planner, on this week.
        .onChange(of: AppRequests.shared.showPlan, initial: true) { _, wanted in
            guard wanted else { return }
            AppRequests.shared.showPlan = false
            nav.tab = .plan
        }
        // A tapped notification opens the tab its web path belongs to.
        .onChange(of: Push.shared.openedLink, initial: true) { _, link in
            guard let link else { return }
            Push.shared.openedLink = nil
            if let recipeId = Push.cookingRecipe(in: link) {
                Task { await openCooking(recipeId) }
            } else if let tab = Push.tab(for: link) {
                nav.tab = tab
            }
        }
    }
}

/// "🍳 Cook tonight · Greek Salad" above the tab bar; opens cooking mode.
struct CookTonightPill: View {
    @Environment(AppNav.self) private var nav
    let request: CookRequest

    var body: some View {
        Button { nav.cooking = request } label: {
            HStack(spacing: 10) {
                Image(systemName: "frying.pan.fill")
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Theme.brandGradient, in: Circle())
                Text("Cook tonight").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.brandDeep)
                Text(request.title ?? request.dishes.first?.recipe.title ?? "")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.horizontal, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// "↻ Syncing…" / "✓ Up to date" — the web's SyncStatus line.
struct SyncLine: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(text)
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.mutedForeground)
    }

    private var icon: String {
        switch app.status.state {
        case .syncing, .starting: "arrow.triangle.2.circlepath"
        case .idle: app.status.pending > 0 ? "clock" : "checkmark.circle"
        case .offline: "wifi.slash"
        }
    }

    private var text: String {
        switch app.status.state {
        case .syncing, .starting: "Syncing…"
        case .idle: app.status.pending > 0 ? "\(app.status.pending) waiting to send" : "Up to date"
        case .offline: app.online ? "Can’t reach the server" : "Offline"
        }
    }
}

/// A member's profile photo, or their initials on brand orange (the web's
/// avatar fallback) when there's none or it hasn't loaded.
struct Avatar: View {
    @Environment(AppModel.self) private var app
    let name: String
    var url: String? = nil
    var size: CGFloat = 40

    var body: some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        let fallback = Text(initials.isEmpty ? "?" : initials)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Theme.brand, in: Circle())
        if let photo = app.imageURL(url) {
            AsyncImage(url: photo) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
                } else {
                    fallback
                }
            }
            .frame(width: size, height: size)
        } else {
            fallback
        }
    }
}

/// Tonight's meal, ready to cook: today's dinner (or the latest meal planned
/// for today), every dish of a combined meal together.
extension RootView {
    /// A dinner reminder's "/recipes/<id>/cook": tonight's whole meal when the
    /// recipe is part of it (every dish's timers together), else just that recipe.
    func openCooking(_ recipeId: String) async {
        let request = try? await app.store.read { r -> CookRequest? in
            if let tonight = try TonightMeal.load(r), tonight.dishes.contains(where: { $0.recipe.id == recipeId }) {
                return tonight
            }
            guard let recipe = try r.record(.recipes, id: recipeId).flatMap(Recipe.init), !recipe.steps.isEmpty else { return nil }
            return CookRequest(dishes: [CookDish(recipe: recipe)])
        }
        if let request { nav.cooking = request } else { nav.tab = .recipes }
    }
}

enum TonightMeal {
    @Sendable static func load(_ r: StoreReader) throws -> CookRequest? { try load(r, mealType: nil) }

    /// Today's meal of `mealType`; nil: dinner, or the last meal planned today.
    static func load(_ r: StoreReader, mealType: String?) throws -> CookRequest? {
        let data = try PlanData.load(r)
        guard let meal = data.today(mealType) else { return nil }
        let dishes = CookDish.inStartOrder(meal.dishes.compactMap(\.recipe).filter { !$0.steps.isEmpty })
        return dishes.isEmpty ? nil : CookRequest(title: meal.title, groupId: meal.groupId, dishes: dishes)
    }
}

/// A window above everything else (sheets and full-screen covers included)
/// that only shows the toast; touches pass straight through it.
@MainActor
enum ToastWindow {
    private static var window: UIWindow?

    static func install(_ app: AppModel, in scene: UIWindowScene) {
        guard window == nil else { return }
        let host = UIHostingController(rootView: ToastView()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom).environment(app))
        host.view.backgroundColor = .clear
        let w = UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        w.rootViewController = host
        w.isUserInteractionEnabled = false
        w.isHidden = false
        window = w
    }

    /// Installs the window on the scene of the view it sits in, once that view has one.
    struct Installer: UIViewRepresentable {
        let app: AppModel
        func makeUIView(context: Context) -> Probe { Probe(app: app) }
        func updateUIView(_ uiView: Probe, context: Context) {}

        final class Probe: UIView {
            let app: AppModel
            init(app: AppModel) { self.app = app; super.init(frame: .zero) }
            required init?(coder: NSCoder) { fatalError() }
            override func didMoveToWindow() {
                super.didMoveToWindow()
                if let scene = window?.windowScene { ToastWindow.install(app, in: scene) }
            }
        }
    }
}

/// The app's one-line messages, dismissed after a few seconds.
struct ToastView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let message = app.toast {
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .card()
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .padding(.bottom, 150) // clear of the tab bar and the Cook tonight pill
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(4))
                    withAnimation { app.toast = nil }
                }
        }
    }
}

/// Observes a query on the local store and keeps the latest result, so every
/// screen reads from the device and updates itself when sync writes.
///
///   @State private var items = Observed<[ShoppingItem]>([])
///   .task { await items.follow(app.store) { r in try r.records(.shoppingItems).compactMap(ShoppingItem.init) } }
@MainActor @Observable
final class Observed<Value: Sendable> {
    var value: Value
    private(set) var loaded = false

    init(_ initial: Value) { value = initial }

    func follow(_ store: LocalStore, _ fetch: @Sendable @escaping (StoreReader) throws -> Value) async {
        do {
            for try await next in store.observe(fetch) {
                value = next
                loaded = true
            }
        } catch {
            loaded = true
        }
    }
}
