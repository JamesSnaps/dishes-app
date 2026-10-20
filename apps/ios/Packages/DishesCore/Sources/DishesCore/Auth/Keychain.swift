// Small Keychain wrappers: where the sign-in tokens live. Items use
// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, so background sync can
// read them while the phone is locked, but they never go into a backup or onto
// another device.
//
//   let tokens = KeychainTokenStore()           // service "uk.collco.dishes"
//   try tokens.save(tokenSet); let t = try tokens.load(); try tokens.clear()
//
// With an access group (the app and its share extension both list it under
// keychain-access-groups), the tokens are shared between them:
//
//   KeychainTokenStore(accessGroup: "C729B84RYG.uk.collco.dishes.shared")
//
// Tokens saved before the group existed sit in the app's own group; the first
// load moves them across, so nobody has to sign in again.
//
// InMemoryTokenStore is for tests.

import Foundation
import Security

public protocol TokenStore: Sendable {
    func load() throws -> TokenSet?
    func save(_ tokens: TokenSet) throws
    func clear() throws
}

public struct KeychainError: LocalizedError, CustomStringConvertible {
    public let status: OSStatus
    public var description: String {
        "Keychain error \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
    }
    public var errorDescription: String? { description }
}

public enum Keychain {
    public static let defaultService = "uk.collco.dishes"

    static func query(_ service: String, _ account: String, _ accessGroup: String? = nil) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    /// Reads from `accessGroup` only when one is given; otherwise from any group this process can see.
    public static func read(service: String = defaultService, account: String, accessGroup: String? = nil) throws -> Data? {
        var q = query(service, account, accessGroup)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return result as? Data
    }

    public static func write(_ data: Data, service: String = defaultService, account: String,
                             accessGroup: String? = nil) throws {
        let q = query(service, account, accessGroup)
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(update) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public static func delete(service: String = defaultService, account: String, accessGroup: String? = nil) throws {
        let status = SecItemDelete(query(service, account, accessGroup) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }

    /// `read` in a group, or nil when this build isn't entitled to it.
    static func readIfEntitled(service: String, account: String, accessGroup: String) throws -> Data? {
        do {
            return try read(service: service, account: account, accessGroup: accessGroup)
        } catch let error as KeychainError where error.status == errSecMissingEntitlement {
            return nil
        }
    }

    /// Moves an item saved before `accessGroup` existed (in the app's own group) into it.
    static func move(service: String, account: String, into accessGroup: String) throws {
        let status = SecItemUpdate(query(service, account) as CFDictionary,
                                   [kSecAttrAccessGroup as String: accessGroup] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

public struct KeychainTokenStore: TokenStore {
    let service: String
    let account: String
    let accessGroup: String?

    public init(service: String = Keychain.defaultService, account: String = "tokens", accessGroup: String? = nil) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }

    /// The app's and the share extension's tokens, in the group the bundle's
    /// Info.plist names (`DishesKeychainGroup`, from `$(AppIdentifierPrefix)`).
    public static func dishes(bundle: Bundle = .main) -> KeychainTokenStore {
        let group = bundle.object(forInfoDictionaryKey: "DishesKeychainGroup") as? String
        return KeychainTokenStore(accessGroup: group.flatMap { $0.isEmpty || $0.contains("$(") ? nil : $0 })
    }

    public func load() throws -> TokenSet? {
        if let accessGroup {
            if let data = try Keychain.readIfEntitled(service: service, account: account, accessGroup: accessGroup) {
                return try JSONDecoder().decode(TokenSet.self, from: data)
            }
            // Saved before the shared group: move it there (an extension can't
            // see the app's own group, so this only ever happens in the app).
            guard let data = try Keychain.read(service: service, account: account) else { return nil }
            try? Keychain.move(service: service, account: account, into: accessGroup)
            return try JSONDecoder().decode(TokenSet.self, from: data)
        }
        return try Keychain.read(service: service, account: account).map { try JSONDecoder().decode(TokenSet.self, from: $0) }
    }

    public func save(_ tokens: TokenSet) throws {
        let data = try JSONEncoder().encode(tokens)
        do {
            try Keychain.write(data, service: service, account: account, accessGroup: accessGroup)
        } catch let error as KeychainError where error.status == errSecMissingEntitlement && accessGroup != nil {
            // A build signed without the group (a local simulator build): keep the
            // app signed in; only the share extension goes without.
            try Keychain.write(data, service: service, account: account)
        }
    }

    public func clear() throws {
        guard let accessGroup else { return try Keychain.delete(service: service, account: account) }
        try? Keychain.delete(service: service, account: account, accessGroup: accessGroup)
        // And any copy left in the app's own group (from before the move, or an unentitled build).
        try Keychain.delete(service: service, account: account)
    }
}

public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: TokenSet?

    public init(_ tokens: TokenSet? = nil) { self.tokens = tokens }
    public func load() throws -> TokenSet? { lock.withLock { tokens } }
    public func save(_ tokens: TokenSet) throws { lock.withLock { self.tokens = tokens } }
    public func clear() throws { lock.withLock { tokens = nil } }
}
