// The server, signed in, from one of the app's extensions (the share sheet,
// the widgets): the tokens the app left in the shared Keychain group, or the
// app's dev server choice in a Debug build (Dishes/App/Developer.swift).
//
//   guard let api = ExtensionAPI.client() else { /* signed out */ }

import Foundation

public enum ExtensionAPI {
    /// nil when the app has never signed in (and isn't on a dev server).
    public static func client(bundle: Bundle = .main) -> APIClient? {
        let dev = devServer(bundle: bundle)
        let store = KeychainTokenStore.dishes(bundle: bundle)
        if dev == nil, (try? store.load()) == nil { return nil }
        let auth = AuthSession(oidc: OIDCClient(config: .dishesIOS()), store: store)
        return APIClient(baseURL: dev ?? server(bundle: bundle), tokens: dev == nil ? auth : nil)
    }

    /// The Debug build's dev server, which the app keeps in the shared Keychain group.
    public static func devServer(bundle: Bundle = .main) -> URL? {
        #if DEBUG
        guard let group = bundle.object(forInfoDictionaryKey: "DishesKeychainGroup") as? String,
              !group.contains("$("),
              let data = try? Keychain.read(account: "DishesDevServer", accessGroup: group) else { return nil }
        return URL(string: String(decoding: data, as: UTF8.self))
        #else
        return nil
        #endif
    }

    /// This build's server (`DishesAPIBase` in the Info.plist).
    public static func server(bundle: Bundle = .main) -> URL {
        URL(string: bundle.object(forInfoDictionaryKey: "DishesAPIBase") as? String ?? "https://dishes.collardserver.co.uk")!
    }
}
