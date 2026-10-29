// Settings → Notifications, as the web's /settings/notifications: allow them
// on this device, choose which kinds you get, and see the devices they go to.
// The choices are yours on the server, so they apply on the web too. Needs a
// connection (nothing here is in the sync log).

import DishesCore
import SwiftUI
import UIKit

struct NotificationsScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.openURL) private var openURL
    @State private var push = Push.shared
    @State private var settings: APIClient.NotificationSettings?
    @State private var error: String?
    @State private var busy: String?
    @State private var testing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PageHeader(title: "Notifications",
                           subtitle: "Choose what you’re told about. These are yours alone, on every device you use.")

                permissionCard

                if let settings {
                    ForEach(groups(settings), id: \.self) { group in
                        section(group) {
                            let kinds = settings.types.filter { $0.group == group }
                            ForEach(Array(kinds.enumerated()), id: \.element.id) { index, kind in
                                if index > 0 { divider }
                                toggleRow(kind)
                            }
                        }
                    }
                    devices(settings.devices)
                } else if let error {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Couldn’t load your notifications", systemImage: "wifi.exclamationmark")
                            .font(.system(size: 15, weight: .semibold))
                        Text(error).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        Button("Try again") { Task { await load() } }.buttonStyle(.secondary)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(30)
                }
            }
            .padding(.horizontal, width == .regular ? 28 : 16)
            .padding(.vertical, 20)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            // Back from iOS Settings, perhaps with notifications now allowed.
            Task { await push.refreshAuthorization() }
        }
    }

    // MARK: This device

    @ViewBuilder private var permissionCard: some View {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: push.authorization == .denied ? "bell.slash.fill" : "bell.badge.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.brandForeground)
                    .frame(width: 40, height: 40)
                    .background(Theme.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("On this \(device)").font(.system(size: 16, weight: .semibold))
                    Text(permissionLine(device)).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
            }
            switch push.authorization {
            case .notDetermined:
                Button {
                    Task { await push.requestPermission() }
                } label: {
                    Label("Allow notifications", systemImage: "bell")
                }
                .buttonStyle(.wide(.primary))
            case .denied:
                Button {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                } label: {
                    Label("Open iOS Settings", systemImage: "gear")
                }
                .buttonStyle(.secondary)
            default:
                Button {
                    Task { await sendTest() }
                } label: {
                    Label(testing ? "Sending…" : "Send a test", systemImage: "paperplane")
                }
                .buttonStyle(.secondary)
                .disabled(testing || push.token == nil)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Theme.highlight,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.brand.opacity(0.25)))
    }

    private func permissionLine(_ device: String) -> String {
        switch push.authorization {
        case .notDetermined: "Allow them to get the ones you choose below."
        case .denied: "Turned off for Dishes in iOS Settings. Your choices below still apply to your other devices."
        default: push.token == nil ? "Allowed. Waiting for Apple to register this \(device)…" : "Allowed. You’ll get the ones you choose below."
        }
    }

    // MARK: Kinds

    private func toggleRow(_ kind: APIClient.NotificationSettings.Kind) -> some View {
        HStack(spacing: 12) {
            Image(systemName: Self.icon(kind.id))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(kind.enabled ? Theme.brand : Theme.mutedForeground)
                .frame(width: 34, height: 34)
                .background(kind.enabled ? Theme.highlight : Theme.muted, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(kind.title).font(.system(size: 15, weight: .medium))
                Text(kind.description).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer(minLength: 8)
            if busy == kind.id {
                ProgressView()
            } else {
                Toggle(kind.title, isOn: Binding(get: { kind.enabled }, set: { on in Task { await set(kind.id, on) } }))
                    .labelsHidden()
                    .tint(Theme.brand)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private static func icon(_ id: String) -> String {
        switch id {
        case "meal_plan": "fork.knife"
        case "shopping_ready", "shopping_updated": "cart.fill"
        case "dinner": "alarm.fill"
        case "cook_timers": "timer"
        case "delivery_deadline", "delivery_orders": "shippingbox.fill"
        case "delivery_booking": "calendar.badge.clock"
        default: "bell.fill"
        }
    }

    // MARK: Devices

    @ViewBuilder private func devices(_ list: [APIClient.NotificationSettings.Device]) -> some View {
        section("Your devices") {
            if list.isEmpty {
                Text("None yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            }
            ForEach(Array(list.enumerated()), id: \.element.id) { index, device in
                if index > 0 { divider }
                HStack(spacing: 12) {
                    Image(systemName: device.kind == "web" ? "globe" : device.name.contains("iPad") ? "ipad" : "iphone")
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.mutedForeground)
                        .frame(width: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(device.name).font(.system(size: 15, weight: .medium))
                        Text(device.kind == "ios" ? "Dishes app" : "Web").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                    }
                    Spacer()
                    if busy == device.id {
                        ProgressView()
                    } else {
                        Button(role: .destructive) {
                            Task { await remove(device) }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.destructive)
                                .frame(width: 34, height: 34)
                                .background(Theme.destructive.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Stop notifications to \(device.name)")
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
        }
    }

    // MARK: Layout

    private var divider: some View { Rectangle().fill(Theme.border).frame(height: 1) }

    private func groups(_ settings: APIClient.NotificationSettings) -> [String] {
        var seen: [String] = []
        for kind in settings.types where !seen.contains(kind.group) { seen.append(kind.group) }
        return seen
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            VStack(spacing: 0) { content() }.card()
        }
    }

    // MARK: Server

    private func load() async {
        await push.refreshAuthorization()
        do {
            settings = try await app.api.notificationSettings()
            error = nil
        } catch {
            if settings == nil { self.error = String(describing: error) }
        }
    }

    private func set(_ id: String, _ on: Bool) async {
        busy = id
        defer { busy = nil }
        do {
            settings = try await app.api.setNotification(id, enabled: on)
        } catch {
            app.toast = "Couldn’t change that — check your connection."
        }
    }

    private func remove(_ device: APIClient.NotificationSettings.Device) async {
        busy = device.id
        defer { busy = nil }
        do {
            try await app.api.removeNotificationDevice(id: device.id)
            settings?.devices.removeAll { $0.id == device.id }
        } catch {
            app.toast = "Couldn’t remove that device."
        }
    }

    private func sendTest() async {
        guard let token = push.token else { return }
        testing = true
        defer { testing = false }
        do {
            try await app.api.sendTestPush(token: token)
            app.toast = "Test sent — it should arrive in a moment."
        } catch APIError.http(_, _, let message) {
            app.toast = message
        } catch {
            app.toast = "Couldn’t send a test: \(error)"
        }
    }
}
