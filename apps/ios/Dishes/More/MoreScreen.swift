// Settings, in the web's card style: who's signed in, sync, the way to the
// website for everything that stays there, and sign out. On iPhone it's
// reached from the avatar on Home, as on the web; on iPad from the sidebar.

import DishesCore
import SwiftUI

struct MoreScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        if width != .regular {
                            Button { nav.tab = .home } label: {
                                Image(systemName: "chevron.left").font(.system(size: 17, weight: .medium))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.foreground)
                            .accessibilityLabel("Back to Home")
                        }
                        PageHeader(title: "Settings")
                    }

                    if let me = app.me {
                        HStack(spacing: 14) {
                            Avatar(name: me.user.displayName, size: 52)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(me.user.displayName).font(.system(size: 17, weight: .semibold))
                                Text("\(me.household.role.capitalized) · @\(me.user.username)")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                        }
                        .padding(16)
                        .card()
                    }

                    section("Sync", footer: "Everything here works offline. Changes are sent when there’s a connection.") {
                        row("Status") { SyncLine() }
                        if let last = app.status.lastSyncedAt {
                            divider
                            row("Last synced") {
                                Text("\(Text(last, style: .relative)) ago").foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        divider
                        Button { Task { await app.syncNow() } } label: {
                            Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.brand)
                    }

                    section("On the website", footer: "AI, imports, pantry, stats and household admin are on the website.") {
                        Button { openURL(AppModel.serverURL) } label: {
                            HStack {
                                Label("Open Dishes on the web", systemImage: "safari")
                                Spacer()
                                Image(systemName: "arrow.up.right").foregroundStyle(Theme.mutedForeground)
                            }
                            .padding(14)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.foreground)
                    }

                    #if DEBUG
                    section("Developer", footer: "Debug builds only.") {
                        DeveloperSection()
                    }
                    #endif

                    Button { confirmSignOut = true } label: {
                        Text("Sign out")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.destructive)
                            .frame(maxWidth: .infinity, minHeight: 46)
                            .card()
                    }
                    .buttonStyle(.plain)

                    Text("Dishes \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.mutedForeground)
                        .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, width == .regular ? 28 : 16)
                .padding(.vertical, 20)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of Dishes on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            } message: {
                Text(app.status.pending > 0
                     ? "\(app.status.pending) changes haven’t been sent yet and will be lost."
                     : "The household’s data is removed from this device.")
            }
        }
    }

    private var divider: some View { Rectangle().fill(Theme.border).frame(height: 1) }

    private func section(_ title: String, footer: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            VStack(spacing: 0) { content() }
                .font(.system(size: 15))
                .card()
            Text(footer).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
        }
    }

    private func row(_ label: String, @ViewBuilder value: () -> some View) -> some View {
        HStack {
            Text(label).foregroundStyle(Theme.foreground)
            Spacer()
            value()
        }
        .padding(14)
    }
}
