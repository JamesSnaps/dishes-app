// Debug builds only: point the app at a dev server (`pnpm dev` on the Mac)
// instead of the real one. A development build of the web app signs a request
// with no token in as its stand-in user (lib/auth.ts, DEV_USER), so the
// simulator needs no Authelia. Release builds never read the setting.
//
//   Set from the sign-in screen or More → Developer, or for one launch:
//   xcrun simctl launch booted uk.collco.dishes -DishesDevServer http://localhost:3000
//
// The change applies the next time the app opens. Switching server removes
// this device's copy (AppModel.forgetOtherServer), so nothing goes to the wrong one.

import SwiftUI

enum Developer {
    static let key = "DishesDevServer"

    /// The dev server in use since launch, or nil for the real one.
    static let server: URL? = {
        #if DEBUG
        configured
        #else
        nil
        #endif
    }()

    /// What the next launch will use. A `-DishesDevServer` launch argument lands
    /// here too: arguments are read through UserDefaults' argument domain.
    static var configured: URL? {
        get { UserDefaults.standard.string(forKey: key).flatMap(URL.init(string:)) }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: key) }
    }
}

#if DEBUG
struct DeveloperSection: View {
    @State private var address = Developer.configured?.absoluteString ?? "http://localhost:3000"
    @State private var next = Developer.configured

    var body: some View {
        Section {
            LabeledContent("Now", value: Developer.server.map { "\($0.host() ?? ""):\($0.port ?? 80) (stand-in user)" } ?? "Real server")
            TextField("Dev server", text: $address)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Use this dev server") {
                guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)), url.scheme != nil else { return }
                Developer.configured = url
                next = url
            }
            Button("Start a 10-second test timer") {
                Task { await CookTimers.shared.start(label: "Test timer", dish: nil, seconds: 10) }
            }
            if next != nil {
                Button("Use the real server") {
                    Developer.configured = nil
                    next = nil
                }
            }
        } header: {
            Text("Developer")
        } footer: {
            Text(next == Developer.server
                 ? "Debug builds only."
                 : "Quit and reopen Dishes to switch. This device’s copy is removed when the server changes.")
        }
    }
}
#endif
