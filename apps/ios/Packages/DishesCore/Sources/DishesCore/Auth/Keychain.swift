// Small Keychain wrappers: where the sign-in tokens live. Items use
// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, so background sync can
// read them while the phone is locked, but they never go into a backup or onto
// another device.
//
//   let tokens = KeychainTokenStore()           // service "uk.collco.dishes"
//   try tokens.save(tokenSet); let t = try tokens.load(); try tokens.clear()
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

    static func query(_ service: String, _ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public static func read(service: String = defaultService, account: String) throws -> Data? {
        var q = query(service, account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return result as? Data
    }

    public static func write(_ data: Data, service: String = defaultService, account: String) throws {
        let q = query(service, account)
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(update) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public static func delete(service: String = defaultService, account: String) throws {
        let status = SecItemDelete(query(service, account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

public struct KeychainTokenStore: TokenStore {
    let service: String
    let account: String

    public init(service: String = Keychain.defaultService, account: String = "tokens") {
        self.service = service
        self.account = account
    }

    public func load() throws -> TokenSet? {
        try Keychain.read(service: service, account: account).map { try JSONDecoder().decode(TokenSet.self, from: $0) }
    }

    public func save(_ tokens: TokenSet) throws {
        try Keychain.write(try JSONEncoder().encode(tokens), service: service, account: account)
    }

    public func clear() throws {
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
