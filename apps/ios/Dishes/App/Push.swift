// Apple Push: this device's token, sent to the server so the household's
// notifications reach it (and silent pushes wake it to sync), plus the
// permission to show them.
//
// The token is asked for at every launch, whether or not notifications are
// allowed: a silent push needs no permission, so the app keeps itself in sync
// either way. Showing banners waits for the user's yes, asked on the
// Notifications screen rather than at first launch.
//
//   AppDelegate.didRegisterForRemoteNotifications → Push.shared.received(token)
//   → POST /api/v1/push/devices once signed in

import DishesCore
import Foundation
import Observation
import UIKit
import UserNotifications

@MainActor @Observable
final class Push {
    static let shared = Push()

    /// Hex, as APNs and the server want it.
    private(set) var token: String?
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// A path from a tapped notification ("/shopping"), for RootView to follow.
    var openedLink: String?

    private init() {}

    /// Debug builds are signed for APNs's sandbox; TestFlight and App Store builds for production.
    static var sandbox: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    /// The server names a notification's buttons by the web's action ids
    /// (lib/dinner-reminders/scheduler.ts, lib/deliveries/scheduler.ts) and
    /// sends the first as the APNs category, so each category is named after one.
    enum Action {
        static let snooze = "snooze"
        static let deliveryOrdered = "delivery-ordered"
        static let startCooking = "start-cooking"
    }

    private static let categories: Set<UNNotificationCategory> = [
        UNNotificationCategory(
            identifier: Action.snooze,
            actions: [
                UNNotificationAction(identifier: Action.startCooking, title: "Start cooking",
                                     options: [.foreground], icon: UNNotificationActionIcon(systemImageName: "frying.pan")),
                UNNotificationAction(identifier: Action.snooze, title: "Push back 30 min",
                                     options: [], icon: UNNotificationActionIcon(systemImageName: "clock.arrow.circlepath")),
            ],
            intentIdentifiers: []),
        UNNotificationCategory(
            identifier: Action.deliveryOrdered,
            actions: [
                UNNotificationAction(identifier: Action.deliveryOrdered, title: "Mark as ordered",
                                     options: [], icon: UNNotificationActionIcon(systemImageName: "checkmark.circle")),
            ],
            intentIdentifiers: []),
    ]

    func launch() {
        UNUserNotificationCenter.current().setNotificationCategories(Self.categories)
        UIApplication.shared.registerForRemoteNotifications()
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// The system prompt. Answers whether banners are now allowed.
    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        return granted
    }

    func received(_ deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await register() }
    }

    /// Tells the server about this device. Called when the token arrives and
    /// after sign-in; a repeat is a cheap upsert.
    func register() async {
        guard let token, AppModel.shared.phase == .ready else { return }
        do {
            try await AppModel.shared.api.registerPushDevice(token: token, sandbox: Self.sandbox, name: UIDevice.current.name)
        } catch {
            print("[push] couldn't register this device: \(error)")
        }
    }

    /// Before signing out, so the next person to sign in here doesn't get the last one's notifications.
    func unregister() async {
        guard let token else { return }
        try? await AppModel.shared.api.unregisterPushDevice(token: token)
    }

    /// A button on a notification. Snooze and mark-ordered run without opening
    /// the app (iOS gives it a few seconds in the background); the result is
    /// a local notification, since there's no screen to show it on.
    func handle(action: String, userInfo: [AnyHashable: Any]) async {
        let data = userInfo["data"] as? [String: Any] ?? [:]
        let url = userInfo["url"] as? String
        switch action {
        case Action.startCooking, UNNotificationDefaultActionIdentifier:
            if let url { openedLink = url }
        case Action.snooze:
            guard let date = data["snoozeDate"] as? String else { return }
            await AppModel.shared.start()
            do {
                let result = try await AppModel.shared.api.snoozeDinner(date: date)
                let when = result.remindAt.map { " I’ll remind you at \($0)." } ?? ""
                await confirm("Dinner moved to \(result.dinnerTime)", body: "Pushed back 30 minutes.\(when)", tag: "dinner-\(date)")
            } catch {
                await confirm("Couldn’t push dinner back", body: "Open Dishes to change tonight’s time.", tag: "dinner-\(date)")
            }
        case Action.deliveryOrdered:
            guard let date = data["deliveryDate"] as? String else { return }
            await AppModel.shared.start()
            do {
                try await AppModel.shared.api.markDeliveryOrdered(date: date)
                await confirm("Order marked as placed", body: "No more deadline reminders for this delivery.", tag: "delivery-\(date)")
            } catch {
                await confirm("Couldn’t mark the order", body: "Open Dishes to mark it from the planner.", tag: "delivery-\(date)")
            }
        default:
            break
        }
    }

    /// Replaces the notification that was acted on (same identifier as its tag).
    private func confirm(_ title: String, body: String, tag: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.threadIdentifier = tag
        try? await UNUserNotificationCenter.current()
            .add(UNNotificationRequest(identifier: "confirm-\(tag)", content: content, trigger: nil))
    }

    /// "/recipes/<id>/cook" → the recipe id.
    static func cookingRecipe(in link: String) -> String? {
        let parts = link.split(separator: "?").first?.split(separator: "/") ?? []
        guard parts.count == 3, parts[0] == "recipes", parts[2] == "cook" else { return nil }
        return String(parts[1])
    }

    /// Which tab a notification's web path belongs to.
    static func tab(for link: String) -> AppNav.Tab? {
        if link.hasPrefix("/shopping") { return .shopping }
        if link.hasPrefix("/meal-plan") || link.hasPrefix("/deliveries") { return .plan }
        if link.hasPrefix("/recipes") { return .recipes }
        if link.hasPrefix("/settings") { return .more }
        if link.hasPrefix("/ai-concierge") { return .ai }
        if link == "/" || link.hasPrefix("/home") { return .recipes }
        return nil
    }
}
