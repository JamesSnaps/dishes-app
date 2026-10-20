// The signed-in session: holds the tokens, hands out a fresh access token to
// every request, and refreshes in one place. It's an actor, so twenty requests
// that all find the token expired cause one refresh, not twenty (Authelia
// rotates refresh tokens, so parallel refreshes would sign the phone out).
//
//   let auth = AuthSession(oidc: OIDCClient(config: .dishesIOS()), store: KeychainTokenStore())
//   try await auth.signIn { url in try await WebAuthenticator.present(url, callbackScheme: "dishes") }
//   let api = APIClient(baseURL: base, tokens: auth)
//
// If a refresh is refused, the tokens are dropped and requests throw
// APIError.signedOut; local data and the outbox stay, and the app asks the
// person to sign in again.
//
// The share extension signs in with the same stored tokens (a shared Keychain
// group), so another process may have refreshed since these were loaded. A
// refresh therefore reads the store first: refreshing with a refresh token
// that's already been used would get it refused, and sign everyone out.

import Foundation

public actor AuthSession: TokenProvider {
    let oidc: OIDCClient
    let store: any TokenStore
    let now: @Sendable () -> Date
    private var tokens: TokenSet?
    private var loaded = false
    private var refreshing: Task<TokenSet?, Error>?

    public init(oidc: OIDCClient, store: any TokenStore, now: @escaping @Sendable () -> Date = { Date() }) {
        self.oidc = oidc
        self.store = store
        self.now = now
    }

    public var isSignedIn: Bool {
        get throws { try current() != nil }
    }

    /// Runs the browser sign-in. `present` opens the URL and returns the redirect it ends on.
    public func signIn(present: @Sendable (URL) async throws -> URL) async throws {
        let request = try await oidc.authorisationRequest()
        let callback = try await present(request.url)
        let fresh = try await oidc.exchange(callback: callback, for: request)
        try store.save(fresh)
        tokens = fresh
        loaded = true
    }

    /// Forgets the tokens (signing out, or after a wipe).
    public func signOut() throws {
        refreshing?.cancel()
        refreshing = nil
        tokens = nil
        loaded = true
        try store.clear()
    }

    public func accessToken() async throws -> String? {
        guard let tokens = try current() else { return nil }
        if tokens.isExpiring(now: now()) { return try await refreshOnce()?.accessToken }
        return tokens.accessToken
    }

    public func refresh(after rejected: String) async throws -> String? {
        // Someone else already replaced the token the server turned down.
        if let tokens = try current(), tokens.accessToken != rejected, !tokens.isExpiring(now: now()) {
            return tokens.accessToken
        }
        return try await refreshOnce()?.accessToken
    }

    private func current() throws -> TokenSet? {
        if !loaded {
            tokens = try store.load()
            loaded = true
        }
        return tokens
    }

    private func refreshOnce() async throws -> TokenSet? {
        if let refreshing { return try await refreshing.value }
        // Another process (the app, or its share extension) may have refreshed already.
        if let stored = try store.load(), stored != tokens {
            tokens = stored
            loaded = true
            if !stored.isExpiring(now: now()) { return stored }
        }
        guard let refreshToken = try current()?.refreshToken else {
            try signOut()
            return nil
        }
        let oidc = oidc
        let task = Task<TokenSet?, Error> { try await oidc.refresh(refreshToken) }
        refreshing = task
        defer { refreshing = nil }
        do {
            guard let fresh = try await task.value else { return nil }
            try store.save(fresh)
            tokens = fresh
            return fresh
        } catch OIDCError.invalidGrant {
            // Refused because the other process spent this refresh token first?
            // Then its new pair is (or is about to be) in the store: use that
            // rather than sign out, which would clear the store and sign out both.
            if let theirs = try await pairSavedElsewhere(replacing: refreshToken) {
                tokens = theirs
                return theirs
            }
            try signOut()
            return nil
        }
    }

    /// A pair another process saved in place of `spent`, allowing it a moment
    /// to finish saving after its own refresh succeeded.
    private func pairSavedElsewhere(replacing spent: String) async throws -> TokenSet? {
        for attempt in 0..<2 {
            if let stored = try store.load(), stored.refreshToken != spent { return stored }
            if attempt == 0 { try? await Task.sleep(for: .seconds(1)) }
        }
        return nil
    }
}
