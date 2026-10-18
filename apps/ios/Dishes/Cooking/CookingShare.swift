// The cook in progress, shared through the server so the household's other
// devices can follow it: cook on the kitchen iPad, see the step and the timers
// on your Watch (through your iPhone). apps/web/lib/cooking-sessions.ts is the
// other end.
//
// The device cooking is the only one that writes its session. Nothing that
// arrives from the server changes cooking mode here: other devices' cooks are
// only ever shown. Every change carries a higher version, a finished cook is
// ended on the server and can't come back, and a session started long ago is
// turned down, so a stale cooking mode left open on another device can't take
// over this one. Timers go as end times, so a late update still counts down
// right, and the alarms stay this device's AlarmKit alarms either way.
//
// Fed by CookingActivity (the same calls that drive the Live Activity), so it
// follows exactly what cooking mode shows.
//
//   CookingShare.shared.show(title:dish:step:of:instruction:)   // cooking mode changed
//   CookingShare.shared.end()                                    // cooking mode closed
//   await CookingShare.shared.refresh()                          // other devices' cooks, for the Watch

import DishesCore
import Foundation
import Observation
import UIKit

@MainActor @Observable
final class CookingShare {
    static let shared = CookingShare()

    /// This device's cook, as last published.
    private(set) var mine: APIClient.CookingSession?
    /// When `mine` last changed.
    @ObservationIgnored private var mineChangedAt = Date()
    /// Cooks on the household's other devices, from the last refresh.
    private(set) var others: [APIClient.CookingSession] = []

    /// The server has finished with `mine` (ended elsewhere, or too old): keep cooking here, stop sharing it.
    @ObservationIgnored private var refused = false
    @ObservationIgnored private var sending: Task<Void, Never>?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    /// While the cook carries on unchanged (a long simmer), it's republished this often so it doesn't expire.
    private static let heartbeatInterval: Duration = .seconds(5 * 60)

    private init() {}

    func show(title: String, dish: String, step: Int, of total: Int, instruction: String) {
        let timers = CookTimers.shared.timers.filter { $0.state != .finished }.map { timer in
            APIClient.CookingSession.Timer(
                id: timer.id.uuidString.lowercased(), label: timer.label, dish: timer.dish,
                endsAt: timer.endsAt.map { $0.timeIntervalSince1970 * 1000 },
                remainingMs: timer.remaining * 1000, durationMs: timer.duration * 1000, state: timer.state.rawValue)
        }
        // Instructions can be long; the Watch shows a screenful.
        let words = String(instruction.prefix(600))
        var next: APIClient.CookingSession
        if let mine, mine.title == title {
            next = mine
        } else {
            // A different meal is a different cook, as for the Live Activity.
            refused = false
            next = APIClient.CookingSession(
                id: UUID().uuidString.lowercased(), version: 0, startedAt: Date().timeIntervalSince1970 * 1000,
                title: title, device: UIDevice.current.model, dish: dish, step: step, totalSteps: total,
                instruction: words, timers: timers)
        }
        next.dish = dish
        next.step = step
        next.totalSteps = total
        next.instruction = words
        next.timers = timers
        guard next != mine else { return }
        next.version += 1
        mine = next
        mineChangedAt = Date()
        publishSoon()
        keepAlive()
    }

    func end() {
        heartbeat?.cancel()
        heartbeat = nil
        sending?.cancel()
        sending = nil
        guard let mine else { return }
        self.mine = nil
        let id = mine.id
        let api = AppModel.shared.api
        Task { try? await api.endCooking(id: id) }
    }

    /// Fetches the other devices' cooks. Quietly keeps the last ones when offline.
    func refresh() async {
        guard AppModel.shared.phase == .ready, let sessions = try? await AppModel.shared.api.cookingSessions() else { return }
        let fresh = sessions.filter { $0.id != mine?.id }
        if fresh != others { others = fresh }
    }

    /// Coalesces a burst of changes (Next, Next, start a timer) into one request.
    private func publishSoon() {
        sending?.cancel()
        sending = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await publish()
        }
    }

    private func publish() async {
        guard let session = mine, !refused, AppModel.shared.phase == .ready else { return }
        // Offline: the next change or the heartbeat tries again.
        guard let accepted = try? await AppModel.shared.api.publishCooking(session) else { return }
        if !accepted, mine?.id == session.id { refused = true }
    }

    private func keepAlive() {
        guard heartbeat == nil else { return }
        heartbeat = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.heartbeatInterval)
                guard !Task.isCancelled, mine != nil else { break }
                await publish()
            }
        }
    }

    // MARK: For the Watch

    /// This phone's cook first, then the others, newest first. Cooks that have
    /// gone quiet for a long while (the app closed mid-cook) are left out unless
    /// a timer is still counting down.
    var watchCooks: [WatchCook] {
        let now = Date()
        let local = mine.map { Self.watchCook($0, device: "this \(UIDevice.current.model)", updatedAt: mineChangedAt) }
        let remote = others.compactMap { session -> WatchCook? in
            let updated = Date(timeIntervalSince1970: (session.updatedAt ?? session.startedAt) / 1000)
            let ticking = session.timers.contains { $0.state == "running" && ($0.endsAt ?? 0) > now.timeIntervalSince1970 * 1000 }
            guard ticking || now.timeIntervalSince(updated) < 45 * 60 else { return nil }
            return Self.watchCook(session, device: session.device, updatedAt: updated)
        }
        .sorted { $0.updatedAt > $1.updatedAt }
        return (local.map { [$0] } ?? []) + remote
    }

    private static func watchCook(_ s: APIClient.CookingSession, device: String, updatedAt: Date) -> WatchCook {
        WatchCook(
            id: s.id, title: s.title, device: device, dish: s.dish, step: s.step, totalSteps: s.totalSteps,
            instruction: s.instruction,
            timers: s.timers.map { t in
                WatchTimer(id: t.id, label: t.label, dish: t.dish,
                           endsAt: t.endsAt.map { Date(timeIntervalSince1970: $0 / 1000) },
                           remaining: t.remainingMs / 1000, duration: t.durationMs.map { $0 / 1000 }, state: WatchTimer.State(rawValue: t.state) ?? .running)
            },
            updatedAt: updatedAt)
    }
}
