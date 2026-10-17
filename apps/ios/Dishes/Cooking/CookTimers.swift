// Cooking timers that go off with no server, no signal and the screen locked.
//
// Each timer is an AlarmKit alarm: it sounds through silent mode and Focus,
// as the Clock app's timers do, which a notification doesn't. If AlarmKit
// isn't allowed the same timer becomes a time-sensitive local notification.
// Either way the system owns the countdown, so it fires even if the app is
// closed — this list is only what the app shows, kept in UserDefaults so it
// survives a relaunch. (Replaces the web's server-sent push, v1.19, on iOS.)
//
// **When AlarmKit says no, the timer still rings while Dishes is open.** A
// notification is quiet in silent mode, so a finished notification timer
// also rings in the app (`ringing`, AlarmSound): a chime that ignores the
// silent setting until someone taps Stop. Cooking mode keeps the screen on, so
// the app is open exactly when it matters. (Real devices ask and grant it —
// checked on an iPad Pro, 17 Oct 2026 — but the iPhone and iPad simulators
// refuse AlarmKit without asking, so the fallback is what runs there.)
//
//   let timers = CookTimers.shared
//   await timers.start(label: "Simmer the sauce", dish: "Bolognese", seconds: 20 * 60)
//   timers.pause(t); timers.resume(t); timers.addMinute(t); timers.cancel(t)

import ActivityKit
import AlarmKit
import AVFoundation
import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

struct CookTimer: Codable, Identifiable, Hashable {
    enum State: String, Codable { case running, paused, finished }

    var id: UUID
    var label: String
    var dish: String?
    /// Seconds in total, including any added minutes.
    var duration: TimeInterval
    /// When it goes off, while running.
    var endsAt: Date?
    /// What was left when it was paused.
    var remaining: TimeInterval
    var state: State
    /// How it was scheduled, so it's cancelled the same way.
    var usesAlarmKit: Bool

    func secondsLeft(at now: Date = .now) -> TimeInterval {
        switch state {
        case .running: max(0, (endsAt ?? now).timeIntervalSince(now))
        case .paused: remaining
        case .finished: 0
        }
    }
}

@MainActor @Observable
final class CookTimers {
    static let shared = CookTimers()

    private(set) var timers: [CookTimer] = [] {
        didSet { save() }
    }

    /// Timers that finished while Dishes was open and nobody has stopped yet.
    private(set) var ringing: [CookTimer] = []
    private var ticker: Task<Void, Never>?

    private static let storageKey = "cookTimers"

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.storageKey),
           let saved = try? JSONDecoder().decode([CookTimer].self, from: data) {
            timers = saved
        }
        refreshFinished()
        tick()
        Task { await watchAlarms() }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(timers) { UserDefaults.standard.set(data, forKey: Self.storageKey) }
    }

    var active: [CookTimer] { timers.filter { $0.state != .finished } }

    /// Marks timers whose time has passed as finished. One that finished just
    /// now, with Dishes on screen and no AlarmKit alarm already sounding, rings.
    func refreshFinished(now: Date = .now) {
        for i in timers.indices where timers[i].state == .running && (timers[i].endsAt ?? now) <= now {
            timers[i].state = .finished
            let justNow = now.timeIntervalSince(timers[i].endsAt ?? now) < 5
            if justNow && !timers[i].usesAlarmKit && UIApplication.shared.applicationState == .active {
                ringing.append(timers[i])
                AlarmSound.shared.play()
            }
        }
    }

    /// Stops the in-app alarm and clears the timers that rang.
    func stopRinging() {
        AlarmSound.shared.stop()
        let ids = Set(ringing.map(\.id))
        ringing = []
        timers.removeAll { ids.contains($0.id) }
    }

    /// Checks once a second while anything is running; stops when nothing is.
    private func tick() {
        guard ticker == nil, timers.contains(where: { $0.state == .running }) else { return }
        ticker = Task { [weak self] in
            while let self, !Task.isCancelled, self.timers.contains(where: { $0.state == .running }) {
                try? await Task.sleep(for: .seconds(1))
                self.refreshFinished()
            }
            self?.ticker = nil
        }
    }

    // MARK: Changes

    func start(label: String, dish: String?, seconds: TimeInterval) async {
        var timer = CookTimer(id: UUID(), label: label, dish: dish, duration: seconds,
                              endsAt: Date.now.addingTimeInterval(seconds), remaining: seconds,
                              state: .running, usesAlarmKit: false)
        timer.usesAlarmKit = await schedule(timer, seconds: seconds)
        timers.append(timer)
        tick()
    }

    func pause(_ timer: CookTimer) {
        guard let i = index(timer), timers[i].state == .running else { return }
        timers[i].remaining = timers[i].secondsLeft()
        timers[i].endsAt = nil
        timers[i].state = .paused
        if timers[i].usesAlarmKit {
            try? AlarmManager.shared.pause(id: timer.id)
        } else {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [timer.id.uuidString])
        }
    }

    func resume(_ timer: CookTimer) {
        guard let i = index(timer), timers[i].state == .paused else { return }
        timers[i].endsAt = Date.now.addingTimeInterval(timers[i].remaining)
        timers[i].state = .running
        if timers[i].usesAlarmKit {
            try? AlarmManager.shared.resume(id: timer.id)
        } else {
            Task { await notify(timers[i], after: timers[i].remaining) }
        }
        tick()
    }

    /// One more minute: easiest to do as a fresh alarm for the new remaining time.
    func addMinute(_ timer: CookTimer) async {
        guard let i = index(timer) else { return }
        let left = timers[i].secondsLeft() + 60
        unschedule(timers[i])
        timers[i].duration += 60
        timers[i].remaining = left
        timers[i].endsAt = Date.now.addingTimeInterval(left)
        timers[i].state = .running
        timers[i].usesAlarmKit = await schedule(timers[i], seconds: left)
        tick()
    }

    func cancel(_ timer: CookTimer) {
        guard let i = index(timer) else { return }
        unschedule(timers[i])
        timers.remove(at: i)
        if ringing.contains(where: { $0.id == timer.id }) {
            ringing.removeAll { $0.id == timer.id }
            if ringing.isEmpty { AlarmSound.shared.stop() }
        }
    }

    func dismissFinished() {
        stopRinging()
        timers.removeAll { $0.state == .finished }
    }

    private func index(_ timer: CookTimer) -> Int? { timers.firstIndex { $0.id == timer.id } }

    // MARK: Scheduling

    /// Schedules with AlarmKit when allowed, else a notification. Answers whether AlarmKit took it.
    private func schedule(_ timer: CookTimer, seconds: TimeInterval) async -> Bool {
        if await alarmKitAllowed() {
            do {
                let attributes = AlarmAttributes<CookTimerMetadata>(
                    presentation: AlarmPresentation(
                        alert: .init(title: LocalizedStringResource(stringLiteral: timer.label)),
                        countdown: .init(title: LocalizedStringResource(stringLiteral: timer.label),
                                         pauseButton: AlarmButton(text: "Pause", textColor: .white, systemImageName: "pause.fill")),
                        paused: .init(title: "Paused",
                                      resumeButton: AlarmButton(text: "Resume", textColor: .white, systemImageName: "play.fill"))),
                    metadata: CookTimerMetadata(dish: timer.dish),
                    tintColor: Theme.brand)
                _ = try await AlarmManager.shared.schedule(
                    id: timer.id, configuration: .timer(duration: seconds, attributes: attributes))
                return true
            } catch {
                // Falls through to a notification: a timer that doesn't go off is the one thing not allowed.
            }
        }
        await notify(timer, after: seconds)
        return false
    }

    private func unschedule(_ timer: CookTimer) {
        if timer.usesAlarmKit {
            try? AlarmManager.shared.cancel(id: timer.id)
        } else {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [timer.id.uuidString])
        }
    }

    private func alarmKitAllowed() async -> Bool {
        switch AlarmManager.shared.authorizationState {
        case .authorized: return true
        case .denied: return false
        case .notDetermined: return (try? await AlarmManager.shared.requestAuthorization()) == .authorized
        @unknown default: return false
        }
    }

    private func notify(_ timer: CookTimer, after seconds: TimeInterval) async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        let content = UNMutableNotificationContent()
        content.title = timer.label
        content.body = timer.dish.map { "\($0) — time’s up" } ?? "Time’s up"
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false)
        try? await center.add(UNNotificationRequest(identifier: timer.id.uuidString, content: content, trigger: trigger))
    }

    /// Follows AlarmKit: when the person stops an alarm from the Lock Screen,
    /// or one is cancelled elsewhere, the list here catches up.
    private func watchAlarms() async {
        for await alarms in AlarmManager.shared.alarmUpdates {
            let live = Set(alarms.map(\.id))
            for i in timers.indices where timers[i].usesAlarmKit && timers[i].state != .finished && !live.contains(timers[i].id) {
                timers[i].state = .finished
            }
            for alarm in alarms where alarm.state == .alerting {
                if let i = timers.firstIndex(where: { $0.id == alarm.id }) { timers[i].state = .finished }
            }
        }
    }
}

/// The in-app alarm: a chime that loops until stopped. The playback audio
/// session ignores the silent setting, which is the point — a timer you can't
/// hear over the extractor fan is no timer.
@MainActor
final class AlarmSound {
    static let shared = AlarmSound()
    private var player: AVAudioPlayer?

    func play() {
        guard player?.isPlaying != true,
              let url = Bundle.main.url(forResource: "timer-chime", withExtension: "wav") else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        player = try? AVAudioPlayer(contentsOf: url)
        player?.numberOfLoops = -1
        player?.play()
    }

    func stop() {
        player?.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
