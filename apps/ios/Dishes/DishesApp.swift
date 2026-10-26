// The app's entry point and the system hooks that start a sync when the app
// isn't on screen:
//   - BGAppRefreshTask "uk.collco.dishes.refresh", scheduled each time the app
//     goes to the background (iOS decides when it runs)
//   - a push from the server (every one carries "content-available"), see Push.swift
//   - a message from the Watch app (WatchLink)
//
//   @main DishesApp → RootView, with AppModel.shared in the environment

import BackgroundTasks
import SwiftUI
import UIKit
import UserNotifications

@main
struct DishesApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(AppModel.shared)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                AppModel.shared.enteredForeground()
                AppModel.shared.syncSoon(after: .zero)
                AppModel.shared.serverChanged()
                Task { await MealScheduleActivity.shared.refresh() }
                Task { await ShoppingTripActivity.shared.update() }
            case .background:
                BackgroundRefresh.schedule()
                AppModel.shared.enteredBackground()
            default: break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundRefresh.register()
        UNUserNotificationCenter.current().delegate = self
        Push.shared.launch()
        // Before anything from the Watch can arrive (it may be what launched the app).
        WatchLink.shared.start()
        // And a tick on the shopping trip's Lock Screen card.
        ShoppingTripActivity.shared.install()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.received(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[push] APNs registration failed: \(error)")
    }

    /// A tapped notification: go where it points (the server's web path).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let action = response.actionIdentifier
        // userInfo isn't Sendable; carry the two parts we read as JSON-safe values.
        let info = response.notification.request.content.userInfo
        let payload = SendablePayload(url: info["url"] as? String, data: info["data"] as? [String: String] ?? [:])
        await Push.shared.handle(action: action, userInfo: payload.userInfo)
    }

    /// A timer that falls back to a notification still shows and sounds with Dishes open.
    /// A push shown while Dishes is open ("Sainsbury's order confirmed") also
    /// reloads whatever server screen is up, so it matches the banner.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        let fromServer = notification.request.trigger is UNPushNotificationTrigger
        Task { @MainActor in
            CookTimers.shared.refreshFinished()
            if fromServer { AppModel.shared.serverChanged() }
        }
        return [.banner, .sound, .list]
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) async
        -> UIBackgroundFetchResult {
        let cooking = userInfo["kind"] as? String == "cooking"
        return await AppModel.shared.awake {
            await AppModel.shared.start()
            // A cook changed on another device (lib/cooking-sessions.ts): only the Watch cares.
            if cooking {
                await WatchLink.shared.cookingChanged()
                return .newData
            }
            await AppModel.shared.syncNow()
            AppModel.shared.serverChanged()
            return .newData
        }
    }
}

enum BackgroundRefresh {
    static let identifier = "uk.collco.dishes.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
            let box = TaskBox(task: task)
            MainActor.assumeIsolated {
                schedule()
                let work = Task { @MainActor in
                    await AppModel.shared.awake {
                        await AppModel.shared.start()
                        await AppModel.shared.syncNow()
                    }
                    box.task.setTaskCompleted(success: !Task.isCancelled)
                }
                box.task.expirationHandler = { work.cancel() }
            }
        }
    }

    /// BGTask isn't marked Sendable, but `setTaskCompleted` may be called from any thread.
    private struct TaskBox: @unchecked Sendable { let task: BGTask }

    /// Asks iOS to wake the app in about 15 minutes or later (it picks the moment).
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

/// The parts of a notification's payload the actions read, in a Sendable box.
private struct SendablePayload: Sendable {
    var url: String?
    var data: [String: String]
    var userInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = ["data": data]
        if let url { info["url"] = url }
        return info
    }
}
