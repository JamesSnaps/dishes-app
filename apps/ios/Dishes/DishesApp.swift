// The app's entry point and the system hooks that start a sync when the app
// isn't on screen:
//   - BGAppRefreshTask "uk.collco.dishes.refresh", scheduled each time the app
//     goes to the background (iOS decides when it runs)
//   - a silent push ("content-available") — once the server sends APNs (C5)
//
//   @main DishesApp → RootView, with AppModel.shared in the environment

import BackgroundTasks
import SwiftUI
import UIKit

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
            case .active: AppModel.shared.syncSoon(after: .zero)
            case .background: BackgroundRefresh.schedule()
            default: break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundRefresh.register()
        return true
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) async
        -> UIBackgroundFetchResult {
        await AppModel.shared.start()
        await AppModel.shared.syncNow()
        return .newData
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
                    await AppModel.shared.start()
                    await AppModel.shared.syncNow()
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
