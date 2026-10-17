// Who's signed in, where the data comes from and how fresh it is, and the
// door back to the website for everything else — the web app remains the
// admin surface (TODO_MOBILE.md, C3).

import DishesCore
import SwiftUI

struct MoreScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                if let me = app.me {
                    Section("Signed in") {
                        LabeledContent("Name", value: me.user.displayName)
                        LabeledContent("Role", value: me.household.role.capitalized)
                    }
                }
                Section {
                    LabeledContent("Status", value: statusText)
                    if let last = app.status.lastSyncedAt {
                        LabeledContent("Last synced") { Text("\(Text(last, style: .relative)) ago") }
                    }
                    if app.status.pending > 0 {
                        LabeledContent("Waiting to send", value: "\(app.status.pending)")
                    }
                    Button("Sync now") { Task { await app.syncNow() } }
                } header: {
                    Text("Sync")
                } footer: {
                    Text("Everything here works offline. Changes are sent when there’s a connection.")
                }
                Section {
                    Button("Open Dishes on the web") { openURL(AppModel.serverURL) }
                } footer: {
                    Text("Settings, AI, imports and household admin are on the website.")
                }
                #if DEBUG
                DeveloperSection()
                #endif
                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("Dishes \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .navigationTitle("More")
            .confirmationDialog("Sign out of Dishes on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            } message: {
                Text(app.status.pending > 0
                     ? "\(app.status.pending) changes haven’t been sent yet and will be lost."
                     : "The household’s data is removed from this device.")
            }
        }
    }

    private var statusText: String {
        switch app.status.state {
        case .starting: "Starting"
        case .syncing: "Syncing…"
        case .idle: "Up to date"
        case .offline: app.online ? "Can’t reach the server" : "Offline"
        }
    }
}
