// The phone's end of the Watch app (DishesWatch). The Watch never signs in or
// talks to the server: this sends it a snapshot of what it shows — the active
// shopping list, tonight's meal and its schedule, and the cooks in progress —
// whenever any of it changes, and saves what's done on the Watch (ticks and new
// items) as ordinary outbox mutations, exactly as the shopping screen does.
// WatchShared/WatchContract.swift has the messages.
//
// iOS wakes the app in the background for the Watch's messages, so a tick on
// the wrist reaches the server with the phone in a pocket. Ticks made with the
// phone out of reach wait on the Watch (transferUserInfo) and arrive later.
//
//   WatchLink.shared.start()      // at launch, before anything else can arrive

import DishesCore
import Foundation
import Observation
import os
import UIKit
import WatchConnectivity

final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = WatchLink()
    /// `log stream --predicate 'subsystem == "uk.collco.dishes" AND category == "watch"'`
    private let log = Logger(subsystem: "uk.collco.dishes", category: "watch")

    /// What the snapshot is made from, read from the database together.
    private struct Source: Sendable {
        var shopping = ShoppingData()
        var tonight: CookRequest?

        @Sendable static func load(_ r: StoreReader) throws -> Source {
            Source(shopping: try ShoppingData.load(r), tonight: try TonightMeal.load(r))
        }
    }

    @MainActor private var data = Source()
    @MainActor private var loaded = false
    /// Tonight's cooking schedule, for the meal it was fetched for.
    @MainActor private var clock: APIClient.MealClock?
    @MainActor private var clockFor: String?
    @MainActor private var lastSent: WatchSnapshot?
    @MainActor private var sendTask: Task<Void, Never>?
    @MainActor private var started = false

    /// A paired Watch with Dishes on it: only then is any of this worth doing.
    var hasWatch: Bool {
        WCSession.isSupported() && WCSession.default.activationState == .activated
            && WCSession.default.isPaired && WCSession.default.isWatchAppInstalled
    }

    @MainActor func start() {
        guard WCSession.isSupported(), !started else { return }
        started = true
        WCSession.default.delegate = self
        WCSession.default.activate()
        followApp()
        Task { await self.followStore() }
    }

    // MARK: Following the phone

    @MainActor private func followStore() async {
        let app = AppModel.shared
        do {
            for try await next in app.store.observe(Source.load) {
                data = next
                loaded = true
                if let groupId = next.tonight?.groupId, groupId != clockFor { Task { await self.fetchClock(groupId) } }
                sendSoon()
            }
        } catch {}
    }

    /// The sign-in, the last sync and the cooks in progress, which aren't in the database.
    @MainActor private func followApp() {
        withObservationTracking {
            _ = AppModel.shared.phase
            _ = AppModel.shared.status.lastSyncedAt
            _ = CookingShare.shared.mine
            _ = CookingShare.shared.others
        } onChange: {
            Task { @MainActor in
                self.sendSoon()
                self.followApp()
            }
        }
    }

    @MainActor private func fetchClock(_ groupId: String) async {
        clockFor = groupId
        // A meal with no serve-at time has no schedule (404): that's an answer too.
        clock = try? await AppModel.shared.api.mealClock(groupId: groupId)
        sendSoon()
    }

    // MARK: Sending

    /// Coalesces a burst (a sync writing twenty rows) into one send.
    @MainActor private func sendSoon() {
        sendTask?.cancel()
        sendTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            self.send()
        }
    }

    @MainActor private func send(force: Bool = false) {
        guard hasWatch else {
            let s = WCSession.default
            log.debug("not sending: activated=\(s.activationState == .activated) paired=\(s.isPaired) installed=\(s.isWatchAppInstalled)")
            return
        }
        // Starting up is neither signed in nor out: say nothing rather than "sign in".
        guard AppModel.shared.phase != .starting, loaded || AppModel.shared.phase != .ready else { return }
        let snapshot = makeSnapshot()
        // madeAt always differs; anything else changing is worth sending.
        var compare = snapshot
        compare.madeAt = lastSent?.madeAt ?? compare.madeAt
        guard force || compare != lastSent else { return }
        guard let encoded = WatchCoding.encode(snapshot) else { return }
        do {
            try WCSession.default.updateApplicationContext([WatchKeys.snapshot: encoded])
            lastSent = snapshot
            log.info("sent snapshot: \(snapshot.items.count) items, \(snapshot.cooking.count) cooks, \(encoded.count) bytes")
        } catch {
            log.error("couldn't send the snapshot: \(error)")
        }
    }

    @MainActor private func makeSnapshot() -> WatchSnapshot {
        let app = AppModel.shared
        guard app.phase == .ready else {
            var signedOut = WatchSnapshot.empty
            signedOut.madeAt = Date()
            return signedOut
        }
        let shopping = data.shopping
        let open = shopping.groups.flatMap { group in
            group.items.map { Self.item($0, category: group.name) }
        }
        let ticked = shopping.checked.map { Self.item($0, category: $0.category?.isEmpty == false ? $0.category! : "Uncategorised") }
        return WatchSnapshot(
            signedIn: true,
            listName: shopping.list?.name,
            // A long list is cut, not dropped: the context has a size limit.
            items: Array((open + ticked).prefix(300)),
            tonight: data.tonight.map(meal),
            cooking: CookingShare.shared.watchCooks,
            applied: applied,
            syncedAt: app.status.lastSyncedAt,
            madeAt: Date())
    }

    private static func item(_ item: ShoppingItem, category: String) -> WatchItem {
        WatchItem(id: item.id, name: item.name, quantity: Format.quantity(item.amount, item.unit),
                  category: category, checked: item.isChecked)
    }

    @MainActor private func meal(_ request: CookRequest) -> WatchMeal {
        let clock = clock?.groupId == request.groupId ? clock : nil
        return WatchMeal(
            title: request.title ?? request.dishes.first?.recipe.title ?? "Tonight’s meal",
            dishes: request.dishes.map(\.recipe.title),
            serveAt: clock.map { Date(timeIntervalSince1970: $0.serveAt / 1000) },
            cues: (clock?.cues ?? []).prefix(40).map {
                WatchCue(at: Date(timeIntervalSince1970: $0.at / 1000), dish: $0.dish, text: String($0.text.prefix(160)))
            })
    }

    // MARK: From the Watch

    /// Ids of the Watch's actions applied lately, sent back in every snapshot.
    @MainActor private var applied: [String] {
        get { UserDefaults.standard.stringArray(forKey: "watch.applied") ?? [] }
        set { UserDefaults.standard.set(Array(newValue.suffix(WatchSnapshot.appliedLimit)), forKey: "watch.applied") }
    }

    /// Saves one tick or new item. Not marked applied if nobody's signed in, so the Watch keeps it.
    @MainActor private func apply(_ action: WatchAction) async {
        guard !applied.contains(action.id) else { return }
        let app = AppModel.shared
        await app.start()
        guard app.phase == .ready else { return }
        switch action.kind {
        case .toggle:
            // An item deleted elsewhere in the meantime: nothing to tick, and that's fine.
            await app.setShoppingItem(action.itemId, checked: action.checked ?? true)
        case .add:
            let name = (action.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { guard await app.addShoppingItem(name, id: action.itemId) else { return } }
        }
        applied = applied.filter { $0 != action.id } + [action.id]
    }

    /// Applies, then sends the change on to the server before iOS suspends the app again.
    @MainActor private func handle(_ actions: [WatchAction]) async {
        log.info("from the watch: \(actions.map(\.kind.rawValue))")
        let task = UIApplication.shared.beginBackgroundTask(withName: "watch-action")
        defer { UIApplication.shared.endBackgroundTask(task) }
        await AppModel.shared.awake {
            for action in actions { await apply(action) }
            await AppModel.shared.syncNow(force: false)
        }
        send()
    }

    /// The Watch is open and wants the latest: sync (or just fetch the cooks), within a few seconds.
    @MainActor private func refresh(_ what: String) async {
        let task = UIApplication.shared.beginBackgroundTask(withName: "watch-refresh")
        defer { UIApplication.shared.endBackgroundTask(task) }
        await AppModel.shared.awake {
            await AppModel.shared.start()
            let all = what == "all"
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.fetchLatest(all: all) }
                group.addTask { try? await Task.sleep(for: .seconds(6)) }
                await group.next()
                group.cancelAll()
            }
        }
    }

    @MainActor private func fetchLatest(all: Bool) async {
        if all {
            await AppModel.shared.syncNow(force: false)
            if let groupId = data.tonight?.groupId { await fetchClock(groupId) }
        }
        await CookingShare.shared.refresh()
    }

    /// A silent push said a cook changed somewhere in the household.
    @MainActor func cookingChanged() async {
        guard hasWatch else { return }
        await CookingShare.shared.refresh()
        send()
    }

    // MARK: WCSessionDelegate (called on WatchConnectivity's queue)

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        Task { @MainActor in self.send(force: true) }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.send(force: true) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let action = WatchCoding.decode(WatchAction.self, from: userInfo[WatchKeys.action]) else { return }
        Task { @MainActor in await self.handle([action]) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        let reply = Reply(send: replyHandler)
        let action = WatchCoding.decode(WatchAction.self, from: message[WatchKeys.action])
        let refresh = message[WatchKeys.refresh] as? String
        Task { @MainActor in
            if let action { await self.handle([action]) }
            if let refresh { await self.refresh(refresh) }
            let snapshot = self.makeSnapshot()
            if self.hasWatch { self.send() }
            reply.send(WatchCoding.encode(snapshot).map { [WatchKeys.snapshot: $0] } ?? [:])
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Switching to another Watch: start again with the new one.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}

/// WatchConnectivity's reply handler isn't Sendable; it's documented as callable from any thread.
private struct Reply: @unchecked Sendable {
    let send: ([String: Any]) -> Void
}
