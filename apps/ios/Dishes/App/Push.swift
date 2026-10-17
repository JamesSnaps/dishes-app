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

    func launch() {
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

    /// Which tab a notification's web path belongs to.
    static func tab(for link: String) -> AppNav.Tab? {
        if link.hasPrefix("/shopping") { return .shopping }
        if link.hasPrefix("/meal-plan") || link.hasPrefix("/deliveries") { return .plan }
        if link.hasPrefix("/recipes") { return .recipes }
        if link.hasPrefix("/settings") { return .more }
        if link == "/" { return .home }
        return nil
    }
}
