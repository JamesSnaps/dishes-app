// Dishes on the Watch: the shopping list (tick, add by voice), tonight's meal
// and its schedule, and the cook in progress on any of the household's devices.
// Everything comes from the phone (WatchModel); the Watch never signs in.
//
//   dishes-watch://shopping    the list (the shopping complication)
//   dishes-watch://tonight     tonight's meal, or the cook in progress (the tonight complication)
//
// Debug builds take launch arguments for checks in the simulator, which can't
// open a watchOS app's URLs (RUNBOOK.md, "Apple Watch"):
//   -DishesScreen shopping | tonight | cooking
//   -DishesDemo tick           ticks the first item left to get, once the phone's list is in
//   -DishesDemo add            adds "Watch test" to the list

import SwiftUI

@main
struct DishesWatchApp: App {
    @Environment(\.scenePhase) private var phase

    init() {
        WatchModel.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(WatchModel.shared)
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { WatchModel.shared.refresh() }
        }
        // A context from the phone while the app is closed: take it, so the complications update.
        .backgroundTask(.watchConnectivity) {
            await WatchModel.shared.receivePending()
        }
    }
}

/// The app's colours: the phone's orange, warm tints behind rows.
enum WatchTheme {
    static let brand = Color(red: 0xF9 / 255, green: 0x73 / 255, blue: 0x16 / 255)
    static let rose = Color(red: 0xF4 / 255, green: 0x3F / 255, blue: 0x5E / 255)
    static let amber = Color(red: 0xF5 / 255, green: 0x9E / 255, blue: 0x0B / 255)
    static let emerald = Color(red: 0x10 / 255, green: 0xB9 / 255, blue: 0x81 / 255)
    static let violet = Color(red: 0x8B / 255, green: 0x5C / 255, blue: 0xF6 / 255)

    static let brandGradient = LinearGradient(colors: [brand, rose], startPoint: .topLeading, endPoint: .bottomTrailing)

    /// A row's platter: a tint of `color` rather than the plain grey.
    static func platter(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(LinearGradient(colors: [color.opacity(0.42), color.opacity(0.18)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
    }
}

struct HomeView: View {
    @Environment(WatchModel.self) private var model
    @State private var path: [WatchModel.Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if model.neverSynced {
                    Notice(icon: "iphone", text: "Open Dishes on your iPhone to set up your Watch.")
                } else if !model.snapshot.signedIn {
                    Notice(icon: "person.crop.circle.badge.exclamationmark", text: "Sign in to Dishes on your iPhone.")
                } else {
                    ForEach(model.snapshot.cooking) { cook in
                        NavigationLink(value: WatchModel.Route.cooking(cook.id)) { CookingRow(cook: cook) }
                            .listRowBackground(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(WatchTheme.brandGradient))
                    }
                    NavigationLink(value: WatchModel.Route.shopping) {
                        HomeRow(icon: "cart.fill", tint: WatchTheme.emerald, title: "Shopping",
                                detail: model.openCount == 0 ? "Nothing to get" : "\(model.openCount) to get")
                    }
                    .listRowBackground(WatchTheme.platter(WatchTheme.emerald))
                    NavigationLink(value: WatchModel.Route.tonight) {
                        HomeRow(icon: "fork.knife", tint: WatchTheme.amber, title: "Tonight",
                                detail: model.snapshot.tonight?.title ?? "Nothing planned")
                    }
                    .listRowBackground(WatchTheme.platter(WatchTheme.amber))
                    StatusFooter()
                }
            }
            .navigationTitle("Dishes")
            .navigationDestination(for: WatchModel.Route.self) { route in
                switch route {
                case .shopping: ShoppingView()
                case .tonight: TonightView()
                case .cooking(let id): CookingView(id: id)
                }
            }
        }
        .onOpenURL { url in
            switch url.host() {
            case "shopping": path = [.shopping]
            case "tonight":
                // While something's cooking, "tonight" means the cook.
                if let cook = model.snapshot.cooking.first { path = [.cooking(cook.id)] } else { path = [.tonight] }
            default: path = []
            }
        }
        .onChange(of: model.route) { _, route in
            guard let route else { return }
            path = [route]
            model.route = nil
        }
        #if DEBUG
        .task { await DebugLaunch.run(model) { path = $0 } }
        #endif
    }
}

#if DEBUG
@MainActor
enum DebugLaunch {
    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static func run(_ model: WatchModel, go: ([WatchModel.Route]) -> Void) async {
        // Wait (up to 10 s) for the phone's snapshot.
        for _ in 0..<20 where model.neverSynced || model.items.isEmpty {
            try? await Task.sleep(for: .milliseconds(500))
        }
        switch argument("-DishesDemo") {
        case "tick": if let item = model.items.first(where: { !$0.checked }) { model.toggle(item) }
        case "add": model.add("Watch test")
        default: break
        }
        switch argument("-DishesScreen") {
        case "shopping": go([.shopping])
        case "tonight": go([.tonight])
        case "cooking": if let cook = model.snapshot.cooking.first { go([.cooking(cook.id)]) }
        default: break
        }
    }
}
#endif

private struct HomeRow: View {
    let icon: String
    let tint: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(tint.gradient, in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.headline)
                Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct CookingRow: View {
    let cook: WatchCook

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Cooking now", systemImage: "flame.fill")
                .font(.caption2.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.85))
            Text(cook.title).font(.headline).foregroundStyle(.white).lineLimit(2)
            if let timer = cook.timers.filter({ $0.state == .running }).min(by: { ($0.endsAt ?? .distantFuture) < ($1.endsAt ?? .distantFuture) }),
               let ends = timer.endsAt, ends > .now {
                HStack(spacing: 4) {
                    Image(systemName: "timer")
                    Text(timerInterval: Date.now...ends, countsDown: true).monospacedDigit()
                    Text(timer.label).lineLimit(1)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
            } else {
                Text("Step \(cook.step) of \(cook.totalSteps) · \(cook.device)")
                    .font(.footnote).foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(.vertical, 6)
    }
}

struct Notice: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.title2).foregroundStyle(WatchTheme.brand)
            Text(text).font(.footnote).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .listRowBackground(WatchTheme.platter(WatchTheme.brand))
    }
}

/// When the phone last synced, and any changes still waiting for it.
struct StatusFooter: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if !model.pending.isEmpty {
                Label(model.pending.count == 1 ? "1 change waiting for your iPhone" : "\(model.pending.count) changes waiting for your iPhone",
                      systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(WatchTheme.amber)
            }
            if let synced = model.snapshot.syncedAt {
                Text("Updated \(synced, format: .relative(presentation: .named))")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption2)
        .listRowBackground(Color.clear)
    }
}
