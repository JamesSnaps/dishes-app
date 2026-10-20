// The app's one long-lived object: this device's database, the signed-in
// session, the sync engine — and when to sync: at launch, on becoming active,
// when the network comes back, shortly after every change, from
// BGAppRefreshTask and from a silent push. Reads never wait for any of this:
// screens observe the database, so the household is on screen before the
// first sync starts, signal or not.
//
//   @Environment(AppModel.self) var app
//   await app.mutate("shopping_item.toggle", payload: …, optimistic: […])
//   await app.syncNow()

import AppIntents
import DishesCore
import Foundation
import Network
import Observation
import UIKit

struct SyncStatus: Equatable {
    enum State { case starting, idle, syncing, offline }
    var state: State = .starting
    var lastSyncedAt: Date?
    var pending = 0
}

@MainActor @Observable
final class AppModel {
    enum Phase: Equatable { case starting, signedOut, ready }

    static let shared = AppModel()

    private(set) var phase: Phase = .starting
    private(set) var me: WhoAmI?
    /// The household's members, for "who ate it". Kept on the device so the
    /// log-a-cook sheet opens offline with the last known names.
    private(set) var members: [APIClient.Member] = []
    /// The signed-in member's profile photo, from the cached member list.
    var myAvatarUrl: String? { members.first { $0.id == me?.household.memberId }?.avatarUrl }
    /// Collections aren't in the sync log yet, so they're fetched after each
    /// sync and kept on the device for offline browsing.
    private(set) var collections: [APIClient.Collection] = []
    private(set) var status = SyncStatus()
    private(set) var online = true
    var signInError: String?
    /// A one-line message at the bottom of the screen.
    var toast: String?

    let store: LocalStore
    let auth: AuthSession
    let api: APIClient
    let engine: SyncEngine

    private var soon: Task<Void, Never>?
    private let monitor = NWPathMonitor()

    static let realServerURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "DishesAPIBase") as? String
                                   ?? "https://dishes.collardserver.co.uk")!
    static let serverURL = Developer.server ?? realServerURL

    private init() {
        let (path, shared) = Self.databaseURL()
        func open() throws -> LocalStore { shared ? try LocalStore(sharedPath: path.path) : try LocalStore(path: path.path) }
        // The database can't be opened only if the disk is full or the file is
        // damaged. It's a copy of the server's, so start again rather than refuse to open.
        let store: LocalStore
        do { store = try open() } catch {
            try? FileManager.default.removeItem(at: path)
            store = try! open()
        }
        self.store = store
        // In the Keychain group the share extension also reads (DishesShare).
        auth = AuthSession(oidc: OIDCClient(config: .dishesIOS()), store: KeychainTokenStore.dishes())
        // A dev server signs a token-less request in as its stand-in user.
        api = APIClient(baseURL: Self.serverURL, tokens: Developer.server == nil ? auth : nil)
        engine = SyncEngine(store: store, transport: api)
        Developer.shareServerWithExtension()
    }

    /// dishes.sqlite in the App Group container, where the widgets and the
    /// share extension can read it (AppGroup.databaseURL); `shared` says so.
    /// Up to v1.54 it lived in the app's own Application Support/Dishes, so the
    /// first launch after updating moves it, unsent changes and all. A build
    /// signed without the group keeps it there. Both are left out of backups:
    /// the server is the copy that matters.
    private static func databaseURL() -> (url: URL, shared: Bool) {
        var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Dishes")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? root.setResourceValues(values)
        let own = root.appendingPathComponent("dishes.sqlite")
        guard let group = AppGroup.databaseURL else { return (own, false) }
        do {
            try LocalStore.moveDatabase(from: own, to: group)
        } catch {
            // Rare (a full disk): keep using the old copy rather than start empty; the next launch tries again.
            print("[store] couldn’t move the database to the App Group: \(error)")
            return (own, false)
        }
        return (group, true)
    }

    // MARK: Background work

    private var awakeCount = 0
    /// Off screen since the scene said so. applicationState can still read
    /// .inactive at that moment, so both are checked.
    private var offScreen = false

    /// Work that may run with the app in the background — a BGAppRefreshTask,
    /// a push, the Watch, Siri — goes inside this. The database lives in the
    /// App Group container, and iOS kills an app that's suspended holding a
    /// lock there (0xDEAD10CC), so it's suspended whenever the app is in the
    /// background with nothing running (Store/SharedStore.swift). A suspended
    /// store still reads; only writes need this.
    func awake<T>(_ work: () async throws -> T) async rethrows -> T {
        awakeCount += 1
        LocalStore.resume()
        defer {
            awakeCount -= 1
            suspendIfIdle()
        }
        return try await work()
    }

    /// Back on screen.
    func enteredForeground() {
        offScreen = false
        LocalStore.resume()
    }

    /// Off screen: send anything waiting first (a tick just before locking the
    /// phone), within the few seconds iOS allows, then suspend the store.
    func enteredBackground() {
        offScreen = true
        let task = UIApplication.shared.beginBackgroundTask(withName: "send-changes")
        Task {
            await awake {
                if status.pending > 0 { await syncNow(force: false) }
            }
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private func suspendIfIdle() {
        guard awakeCount == 0, offScreen || UIApplication.shared.applicationState == .background else { return }
        LocalStore.suspend()
    }

    // MARK: Starting up

    private var starting: Task<Void, Never>?

    /// Opens straight onto the household when someone has signed in before, even offline.
    /// Safe to call from anywhere that might run first (the screen, a background wake).
    func start() async {
        if let starting { return await starting.value }
        let task = Task { await launch() }
        starting = task
        await task.value
    }

    private func launch() async {
        guard phase == .starting else { return }
        await engine.onMutationsFailed { failures in
            Task { @MainActor in AppModel.shared.explain(failures) }
        }
        watchNetwork()
        await forgetOtherServer()
        // Spotlight follows the database from here on, signed in or not (signed out, it empties).
        Task { await SpotlightIndex.shared.follow(store) }
        me = try? await store.read { r in try r.meta("me").flatMap { try JSONDecoder().decode(WhoAmI.self, from: Data($0.utf8)) } }
        members = (try? await store.read { r in
            try r.meta("members").flatMap { try JSONDecoder().decode([APIClient.Member].self, from: Data($0.utf8)) }
        }) ?? []
        collections = (try? await store.read { r in
            try r.meta("collections").flatMap { try JSONDecoder().decode([APIClient.Collection].self, from: Data($0.utf8)) }
        }) ?? []
        if me != nil {
            phase = .ready
            await Push.shared.register()
            Task { await askForPermissions() }
            await syncNow()
        } else if Developer.server != nil {
            await finishSignIn()
        } else if (try? await auth.isSignedIn) == true {
            await finishSignIn()
        } else {
            phase = .signedOut
        }
    }

    /// This device's copy belongs to one server. After switching (a Debug
    /// build's dev server, or back) the other server's rows and unsent changes
    /// go, so neither is sent to the wrong place.
    private func forgetOtherServer() async {
        let server = Self.serverURL.absoluteString
        let kept = try? await store.read { try $0.meta("server") }
        if let kept, kept != server { try? await store.write { try $0.wipe() } }
        if kept != server { try? await store.write { try $0.setMeta("server", server) } }
    }

    func signIn() async {
        signInError = nil
        do {
            try await auth.signIn { url in
                try await WebAuthenticator.present(url, callbackScheme: "dishes")
            }
            await finishSignIn()
        } catch {
            // Closing the sheet is a choice, not an error.
            if (error as NSError).code != 1 || (error as NSError).domain != "com.apple.AuthenticationServices.WebAuthenticationSession" {
                signInError = String(describing: error)
            }
        }
    }

    private func finishSignIn() async {
        do {
            let who = try await api.whoami()
            let json = String(decoding: try JSONEncoder().encode(who), as: UTF8.self)
            try await store.write { try $0.setMeta("me", json) }
            me = who
            phase = .ready
            await Push.shared.register()
            Task { await askForPermissions() }
            await syncNow()
        } catch APIError.signedOut {
            phase = .signedOut
        } catch {
            signInError = "Couldn’t reach Dishes: \(error)"
            phase = .signedOut
        }
    }

    func signOut() async {
        await Push.shared.unregister()
        try? await auth.signOut()
        try? await store.write { try $0.wipe() }
        AIContext.forget()
        me = nil
        phase = .signedOut
    }

    // MARK: Syncing

    /// The system prompts for notifications and for timer alarms, on the
    /// first open after signing in rather than mid-cook. Each only shows while
    /// undecided, so asking on every open is harmless.
    func askForPermissions() async {
        await Push.shared.refreshAuthorization()
        if Push.shared.authorization == .notDetermined {
            await Push.shared.requestPermission()
        }
        await CookTimers.shared.askForAlarms()
    }

    func syncNow(force: Bool = true) async {
        guard phase == .ready else { return }
        status.state = .syncing
        do {
            let outcome = try await engine.sync(force: force)
            status.state = outcome.offline ? .offline : .idle
            if !outcome.offline { status.lastSyncedAt = Date() }
        } catch {
            // Only APIError.signedOut gets here. Local data and the outbox stay.
            status.state = .offline
            if Developer.server == nil {
                phase = .signedOut
                signInError = "Sign in again to keep Dishes up to date."
            }
        }
        status.pending = (try? await store.read { try $0.pendingCount() }) ?? 0
        if status.state == .idle {
            await refreshMembers()
            await refreshCollections()
            await refreshAIContext()
            // New recipes and items, for the App Shortcuts' phrases ("Tick off milk").
            DishesShortcuts.updateAppShortcutParameters()
        }
    }

    /// The household's AI settings, kept on the device for AI there (Phase D):
    /// in the App Group, so the share extension has them too.
    private func refreshAIContext() async {
        guard let fresh = try? await api.aiContext(), fresh != AIContext.cached else { return }
        try? fresh.save()
    }

    func refreshCollections() async {
        guard let fresh = try? await api.collections() else { return }
        setCollections(fresh)
    }

    private func setCollections(_ fresh: [APIClient.Collection]) {
        guard fresh != collections else { return }
        collections = fresh
        let json = String(decoding: (try? JSONEncoder().encode(fresh)) ?? Data(), as: UTF8.self)
        Task { try? await store.write { try $0.setMeta("collections", json) } }
    }

    /// Puts a recipe in a collection or takes it out (online), updating the
    /// device's copy straight away.
    func toggle(_ recipe: Recipe, in collection: APIClient.Collection) async {
        let inside = !collection.recipeIds.contains(recipe.id)
        do {
            try await api.setRecipe(recipe.id, inCollection: collection.id, inside)
            setCollections(collections.map { c in
                guard c.id == collection.id else { return c }
                var c = c
                if inside { c.recipeIds.append(recipe.id) } else { c.recipeIds.removeAll { $0 == recipe.id } }
                return c
            })
            toast = inside ? "Added to \(collection.name)." : "Removed from \(collection.name)."
        } catch {
            toast = online ? "Couldn’t change that collection." : "You’re offline — collections need a connection for now."
        }
    }

    func createCollection(named name: String, adding recipe: Recipe?) async {
        do {
            let created = try await api.createCollection(name: name, icon: nil)
            setCollections((collections + [created]).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending })
            if let recipe { await toggle(recipe, in: created) }
        } catch {
            toast = online ? "Couldn’t create that collection." : "You’re offline — collections need a connection for now."
        }
    }

    private func refreshMembers() async {
        guard let fresh = try? await api.members(), fresh != members else { return }
        members = fresh
        let json = String(decoding: (try? JSONEncoder().encode(fresh)) ?? Data(), as: UTF8.self)
        try? await store.write { try $0.setMeta("members", json) }
    }

    /// Debounced: a run of changes (ticking off five items) goes in one push.
    func syncSoon(after delay: Duration = .seconds(1.5)) {
        soon?.cancel()
        soon = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await syncNow(force: false)
        }
    }

    /// A local change, queued for the server. The screen updates at once from
    /// the optimistic write; the push follows shortly. False if it couldn't be
    /// saved on the device.
    @discardableResult
    func mutate(_ type: String, payload: JSONValue, optimistic: [OptimisticChange] = []) async -> Bool {
        do {
            try await engine.mutate(type, payload: payload, optimistic: optimistic)
            status.pending = (try? await store.read { try $0.pendingCount() }) ?? status.pending
            syncSoon()
            return true
        } catch {
            toast = "Couldn’t save that change on this device."
            return false
        }
    }

    /// One item onto the active shopping list, offline-first: the shopping
    /// screen's add card and the Siri / Shortcuts intent both come here.
    @discardableResult
    func addShoppingItem(_ name: String, amount: String? = nil, unit: String? = nil, category: String? = nil,
                         id: String = UUID().uuidString.lowercased()) async -> Bool {
        let data = try? await store.read(ShoppingData.load)
        let list = data?.list
        let position = (data?.all.map(\.position).max() ?? 0) + 1
        // The server keeps a client-made id (AddItemInput.id), so the row
        // written here is the row the server will have — and an item added
        // from the Watch twice (its id is the Watch's) is one row.
        if (try? await store.read({ try $0.record(.shoppingItems, id: id) })) != nil { return true }
        let record = JSONValue.fields([
            "id": .string(id), "listId": .string(list?.id ?? "pending"), "ingredientName": .string(name),
            "isChecked": .bool(false), "position": .number(Double(position)),
            "amount": amount.map(JSONValue.string), "unit": unit.map(JSONValue.string),
            "category": category.map(JSONValue.string),
        ])
        return await mutate("shopping_item.add",
                            payload: .fields(["id": .string(id), "ingredientName": .string(name),
                                              "listId": list.map { .string($0.id) },
                                              "amount": amount.map(JSONValue.string),
                                              "unit": unit.map(JSONValue.string),
                                              "category": category.map(JSONValue.string)]),
                            // With no list yet the server makes one, so the row's listId is a guess: temporary.
                            optimistic: [.put(.shoppingItems, record, temporary: list == nil)])
    }

    /// A recipe onto a day of the plan, offline-first: the planner's add sheet
    /// and Siri ("Plan … for Friday") both come here. With no plan for that
    /// week yet, the server makes one, so the rows written here are temporary
    /// until the sync brings the real ones.
    @discardableResult
    func planRecipe(_ recipeId: String, week: Week, day: Int, mealType: String) async -> Bool {
        let key = week.key
        let plan = try? await store.read { r in try r.records(.mealPlans).compactMap(MealPlan.init).first { $0.weekStartDate == key } }
        let planId = plan?.id ?? "temp-plan-\(UUID().uuidString.lowercased())"
        var optimistic: [OptimisticChange] = []
        if plan == nil {
            optimistic.append(.put(.mealPlans, .object(["id": .string(planId), "weekStartDate": .string(key)]), temporary: true))
        }
        optimistic.append(.put(.mealPlanEntries, .object([
            "id": .string("temp-entry-\(UUID().uuidString.lowercased())"),
            "mealPlanId": .string(planId), "recipeId": .string(recipeId),
            "dayOfWeek": .number(Double(day)), "mealType": .string(mealType),
        ]), temporary: true))
        return await mutate("meal_plan_entry.add",
                            payload: .object(["weekStartDate": .string(key), "recipeId": .string(recipeId),
                                              "dayOfWeek": .number(Double(day)), "mealType": .string(mealType)]),
                            optimistic: optimistic)
    }

    /// Ticks an item off (or back on), offline-first: the shopping screen and the Watch.
    /// False when the item has gone (deleted on another device).
    @discardableResult
    func setShoppingItem(_ id: String, checked: Bool) async -> Bool {
        guard let current = try? await store.read({ try $0.record(.shoppingItems, id: id) }) else { return false }
        return await mutate("shopping_item.toggle",
                            payload: .object(["itemId": .string(id), "checked": .bool(checked)]),
                            optimistic: [.put(.shoppingItems, current.merging(.object(["isChecked": .bool(checked)])))])
    }

    private func explain(_ failures: [FailedMutation]) {
        // The rollback has already landed, so something the person did has just
        // undone itself; this is the only chance to say so.
        toast = failures.count == 1
            ? "A change couldn’t be saved and was undone."
            : "\(failures.count) changes couldn’t be saved and were undone."
    }

    private func watchNetwork() {
        monitor.pathUpdateHandler = { path in
            let up = path.status == .satisfied
            Task { @MainActor in
                let cameBack = up && !AppModel.shared.online
                AppModel.shared.online = up
                if cameBack { AppModel.shared.syncSoon(after: .milliseconds(500)) }
            }
        }
        monitor.start(queue: DispatchQueue(label: "uk.collco.dishes.network"))
    }

    // MARK: Server calls that aren't sync

    func toggleFavourite(_ recipe: Recipe) async {
        do {
            let now = try await api.toggleFavourite(recipeId: recipe.id)
            try await engine.patchLocal(.recipes, id: recipe.id, ["isFavourite": .bool(now)])
        } catch {
            toast = online ? "Couldn’t change that favourite." : "You’re offline — favourites need a connection for now."
        }
    }

    func deleteCook(_ entry: CookEntry) async {
        do {
            try await api.deleteCook(id: entry.id)
            await syncNow()
        } catch {
            toast = online ? "Couldn’t delete that cook." : "You’re offline — try again with a connection."
        }
    }

    /// The recipe's ingredients onto the shopping list, at the servings shown.
    func addToShopping(_ recipe: Recipe, servings: Double?) async {
        do {
            let result = try await api.addRecipeToShopping(recipeId: recipe.id, servings: servings)
            toast = result.changed ? "Added \(recipe.title) to the shopping list." : "Everything’s already on the list (or in the pantry)."
            await syncNow()
        } catch {
            toast = online ? "Couldn’t add to the list." : "You’re offline — adding a recipe to the list needs a connection."
        }
    }

    /// An image path from the server, made absolute.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: Self.serverURL)?.absoluteURL
    }
}
