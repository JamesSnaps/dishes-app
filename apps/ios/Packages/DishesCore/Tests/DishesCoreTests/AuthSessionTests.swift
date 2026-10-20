// The app and its share extension share one set of tokens; a refresh must
// pick up tokens the other process stored instead of reusing a spent refresh token.

import Foundation
import Testing
@testable import DishesCore

@Suite struct AuthSessionTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func tokens(_ access: String, refresh: String, expiresIn seconds: TimeInterval) -> TokenSet {
        TokenSet(accessToken: access, refreshToken: refresh,
                 expiresAt: Int((now.timeIntervalSince1970 + seconds) * 1000))
    }

    /// An OIDC client that fails any network call: these tests must never refresh.
    var oidc: OIDCClient {
        OIDCClient(config: OIDCConfig(issuer: URL(string: "https://auth.invalid")!, clientId: "test",
                                      redirectURI: "dishes://auth/callback"))
    }

    final class Clock: @unchecked Sendable {
        var now: Date
        init(_ now: Date) { self.now = now }
    }

    @Test func usesTokensAnotherProcessRefreshed() async throws {
        let store = InMemoryTokenStore(tokens("old", refresh: "r1", expiresIn: 3600))
        let clock = Clock(now)
        let auth = AuthSession(oidc: oidc, store: store, now: { clock.now })
        #expect(try await auth.accessToken() == "old")

        // The extension refreshed while this session still held "old"…
        try store.save(tokens("fresh", refresh: "r2", expiresIn: 7200))
        // …and now "old" is expiring: the stored pair is used, with no refresh
        // (which would have spent r1 a second time).
        clock.now = now.addingTimeInterval(3590)
        #expect(try await auth.accessToken() == "fresh")
    }

    @Test func refreshAfterRejectionPrefersStoredTokens() async throws {
        let store = InMemoryTokenStore(tokens("old", refresh: "r1", expiresIn: 3600))
        let fixedNow = now
        let auth = AuthSession(oidc: oidc, store: store, now: { fixedNow })
        #expect(try await auth.accessToken() == "old")

        // The server turned "old" down; the other process has a newer pair.
        try store.save(tokens("fresh", refresh: "r2", expiresIn: 3600))
        #expect(try await auth.refresh(after: "old") == "fresh")
    }
}
