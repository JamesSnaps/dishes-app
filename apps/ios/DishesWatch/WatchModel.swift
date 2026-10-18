// The Watch's copy of Dishes and its link to the phone (WatchShared/WatchContract.swift).
//
// The phone sends a snapshot whenever something changes; the latest is kept
// in the App Group (WatchStore) so the app opens on it with the phone nowhere
// near, and the complications read it too.
//
// Ticks and new items made here are WatchActions. Each is shown straight away
// on top of the snapshot and kept until a snapshot from the phone lists its id
// as applied — so a tick never flickers back, and one made out of range waits
// (transferUserInfo queues it) rather than being lost. The phone applies each
// id once, so sending one again is harmless.

import Foundation
import Observation
import WatchConnectivity
import WatchKit
import WidgetKit

@MainActor @Observable
final class WatchModel {
    static let shared = WatchModel()

    private(set) var snapshot: WatchSnapshot
    /// Done here, not yet in a snapshot from the phone. Oldest first.
    private(set) var pending: [WatchAction] = [] {
        didSet { savePending() }
    }
    private(set) var reachable = false
    /// Where a complication or the intent asked to go.
    var route: Route?

    enum Route: Hashable {
        case shopping, tonight
        case cooking(String)
    }

    @ObservationIgnored private let link = PhoneLink()
    @ObservationIgnored private var started = false
    /// Actions sent by message and not yet answered, so they aren't also queued.
    @ObservationIgnored private var inFlight: Set<String> = []

    private init() {
        snapshot = WatchStore.loadPhone() ?? .empty
        if let data = UserDefaults.standard.data(forKey: "pending"),
           let kept = WatchCoding.decode([WatchAction].self, from: data) { pending = kept }
    }

    func start() {
        guard !started, WCSession.isSupported() else { return }
        started = true
        WCSession.default.delegate = link
        WCSession.default.activate()
    }

    // MARK: What the screens show

    /// The list with this Watch's own changes on top.
    var items: [WatchItem] {
        var items = snapshot.items
        let adds = pending.filter { $0.kind == .add && !items.map(\.id).contains($0.itemId) }
        items.insert(contentsOf: adds.map {
            WatchItem(id: $0.itemId, name: $0.name ?? "", quantity: "", category: "Just added", checked: false)
        }, at: 0)
        var ticks: [String: Bool] = [:]
        for action in pending where action.kind == .toggle { ticks[action.itemId] = action.checked ?? true }
        return items.map { item in
            var item = item
            if let checked = ticks[item.id] { item.checked = checked }
            return item
        }
    }

    var openCount: Int { items.filter { !$0.checked }.count }

    /// Never heard from the phone: the app says to open Dishes there first.
    var neverSynced: Bool { snapshot.madeAt == .distantPast }

    // MARK: Changes

    func toggle(_ item: WatchItem) {
        WKInterfaceDevice.current().play(item.checked ? .click : .success)
        queue(.toggle(item.id, checked: !item.checked))
    }

    func add(_ name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        queue(.add(name))
    }

    private func queue(_ action: WatchAction) {
        start()
        pending.append(action)
        saveForWidgets()
        send(action)
    }

    /// By message when the phone is there (it answers with a fresh snapshot), else queued.
    /// The handlers are @Sendable: WatchConnectivity calls them on its own queue, and
    /// closures made here would otherwise be main-actor ones (a crash when called off it).
    private func send(_ action: WatchAction) {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated,
              let data = WatchCoding.encode(action) else { return }
        guard session.isReachable else {
            session.transferUserInfo([WatchKeys.action: data])
            return
        }
        inFlight.insert(action.id)
        session.sendMessage([WatchKeys.action: data], replyHandler: { @Sendable [link] reply in
            link.received(reply)
            Task { @MainActor in WatchModel.shared.inFlight.remove(action.id) }
        }, errorHandler: { @Sendable _ in
            Task { @MainActor in
                WatchModel.shared.inFlight.remove(action.id)
                WCSession.default.transferUserInfo([WatchKeys.action: data])
            }
        })
    }

    /// Everything not yet confirmed and not already on its way, sent again.
    fileprivate func sendPending() {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let queued = Set(session.outstandingUserInfoTransfers.compactMap {
            WatchCoding.decode(WatchAction.self, from: $0.userInfo[WatchKeys.action])?.id
        })
        for action in pending where !queued.contains(action.id) && !inFlight.contains(action.id) { send(action) }
    }

    /// Asks the phone for the latest ("all" syncs it first; "cooking" just fetches the cooks).
    func refresh(_ what: String = "all") {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated, session.isReachable else { return }
        session.sendMessage([WatchKeys.refresh: what], replyHandler: { @Sendable [link] reply in link.received(reply) },
                            errorHandler: { @Sendable _ in })
    }

    fileprivate func use(_ fresh: WatchSnapshot) {
        // Replies and contexts can cross: never step back to an older one.
        guard fresh.madeAt >= snapshot.madeAt else { return }
        snapshot = fresh
        let applied = Set(fresh.applied)
        pending.removeAll { applied.contains($0.id) }
        WatchStore.savePhone(fresh)
        saveForWidgets()
    }

    fileprivate func setReachable(_ value: Bool) {
        reachable = value
        if value { sendPending() }
    }

    /// The complications see this Watch's ticks too.
    private func saveForWidgets() {
        var shown = snapshot
        shown.items = items
        let before = WatchStore.load()
        WatchStore.save(shown)
        if before.map(Self.widgetFacts) != Self.widgetFacts(shown) { WidgetCenter.shared.reloadAllTimelines() }
    }

    /// The parts of a snapshot the complications show.
    private static func widgetFacts(_ s: WatchSnapshot) -> String {
        let cooking = s.cooking.map { "\($0.id)|\($0.step)|\($0.timers.map { "\($0.id)\($0.state)\($0.endsAt?.timeIntervalSince1970 ?? 0)" })" }
        return "\(s.signedIn)|\(s.openCount)|\(s.items.prefix(3).map(\.name))|\(s.tonight?.title ?? "")|\(s.tonight?.serveAt?.timeIntervalSince1970 ?? 0)|\(s.tonight?.cues.count ?? 0)|\(cooking)"
    }

    private func savePending() {
        UserDefaults.standard.set(WatchCoding.encode(pending), forKey: "pending")
    }

    /// For a background WatchConnectivity wake: keeps the app up until what's waiting has arrived.
    func receivePending() async {
        start()
        var tries = 0
        while tries < 50, WCSession.default.activationState != .activated || WCSession.default.hasContentPending {
            tries += 1
            try? await Task.sleep(for: .milliseconds(200))
        }
    }
}

extension WatchStore {
    /// The phone's snapshot as sent (without this Watch's pending changes on top).
    static func loadPhone() -> WatchSnapshot? {
        UserDefaults.standard.data(forKey: "phoneSnapshot").flatMap { WatchCoding.decode(WatchSnapshot.self, from: $0) }
    }

    static func savePhone(_ snapshot: WatchSnapshot) {
        UserDefaults.standard.set(WatchCoding.encode(snapshot), forKey: "phoneSnapshot")
    }
}

/// WatchConnectivity calls these on its own queue; each hops to the main actor.
private final class PhoneLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let context = WatchCoding.decode(WatchSnapshot.self, from: session.receivedApplicationContext[WatchKeys.snapshot])
        let reachable = session.isReachable
        Task { @MainActor in
            if let context { WatchModel.shared.use(context) }
            WatchModel.shared.setReachable(reachable)
            WatchModel.shared.sendPending()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        received(applicationContext)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in WatchModel.shared.setReachable(reachable) }
    }

    /// A context or a reply: either carries a snapshot.
    func received(_ message: [String: Any]) {
        guard let snapshot = WatchCoding.decode(WatchSnapshot.self, from: message[WatchKeys.snapshot]) else { return }
        Task { @MainActor in WatchModel.shared.use(snapshot) }
    }
}
