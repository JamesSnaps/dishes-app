// Settings, in the web's card style: who's signed in, sync, the way to the
// website for everything that stays there, and sign out. A tab of its own,
// and the avatar on Home (iPhone) opens it too, as on the web.

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
                    PageHeader(title: "Settings")

                    if let me = app.me {
                        HStack(spacing: 14) {
                            Avatar(name: me.user.displayName, url: app.myAvatarUrl, size: 52)
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

                    section("Notifications", footer: "Choose which ones you get. The same choices apply on the web.") {
                        NavigationLink {
                            NotificationsScreen()
                        } label: {
                            HStack {
                                Label("Choose notifications", systemImage: "bell.badge")
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                            .padding(14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.foreground)
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

                    section("Kitchen", footer: "These need a connection.") {
                        link("Pantry", "cabinet") { PantryScreen() }
                        divider
                        link("Deliveries", "truck.box") { DeliveriesScreen() }
                        divider
                        link("Saved meals", "rectangle.stack") { SavedMealsScreen() }
                        divider
                        link("Notes", "note.text") { NotesScreen() }
                    }

                    section("Insights", footer: "What the household has been eating, and what it likes.") {
                        link("Stats", "chart.bar") { StatsScreen() }
                        divider
                        link("Wrapped", "gift") { WrappedScreen() }
                        divider
                        link("Taste profile", "heart.text.square") { TasteScreen() }
                    }

                    section("Household", footer: "Members, diets and dislikes, sharing, and the household’s AI key.") {
                        link("Household & members", "person.3") { HouseholdScreen() }
                        divider
                        link("Sharing", "square.and.arrow.up.on.square") { SharingScreen() }
                        divider
                        link("AI settings", "sparkles") { AISettingsScreen() }
                    }

                    section("On the website", footer: "Integrations, email and diagnostics are on the website.") {
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

    private func link(_ title: String, _ icon: String, @ViewBuilder _ destination: @escaping () -> some View) -> some View {
        NavigationLink(destination: destination) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.foreground)
    }

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
