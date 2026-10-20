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

/// Authelia, stubbed: discovery, then a token endpoint that refuses every
/// refresh as already spent — after `onRefusal` has run (the other process
/// winning the race and saving its new pair).
final class StubAuthelia: URLProtocol {
    nonisolated(unsafe) static var onRefusal: (@Sendable () -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!
        let discovery = url.path.hasSuffix("openid-configuration")
        if !discovery { Self.onRefusal?() }
        let body = discovery
            ? #"{"authorization_endpoint":"https://auth.test/authorize","token_endpoint":"https://auth.test/token"}"#
            : #"{"error":"invalid_grant","error_description":"refresh token already used"}"#
        let response = HTTPURLResponse(url: url, statusCode: discovery ? 200 : 400, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@Suite(.serialized) struct AuthSessionRaceTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func tokens(_ access: String, refresh: String, expiresIn seconds: TimeInterval) -> TokenSet {
        TokenSet(accessToken: access, refreshToken: refresh,
                 expiresAt: Int((now.timeIntervalSince1970 + seconds) * 1000))
    }

    func session(store: InMemoryTokenStore) -> AuthSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubAuthelia.self]
        let oidc = OIDCClient(config: OIDCConfig(issuer: URL(string: "https://auth.test")!, clientId: "test",
                                                 redirectURI: "dishes://auth/callback"),
                              session: URLSession(configuration: config))
        let fixedNow = now
        return AuthSession(oidc: oidc, store: store, now: { fixedNow })
    }

    @Test func losingARefreshRaceKeepsTheWinnersTokens() async throws {
        let store = InMemoryTokenStore(tokens("old", refresh: "r1", expiresIn: 30))
        let winner = tokens("winner", refresh: "r2", expiresIn: 3600)
        StubAuthelia.onRefusal = { try? store.save(winner) }
        defer { StubAuthelia.onRefusal = nil }

        #expect(try await session(store: store).accessToken() == "winner")
        #expect(try store.load() == winner, "the winner's pair is not wiped")
    }

    @Test func aRefusedRefreshWithNothingNewerSignsOut() async throws {
        let store = InMemoryTokenStore(tokens("old", refresh: "r1", expiresIn: 30))
        StubAuthelia.onRefusal = nil

        #expect(try await session(store: store).accessToken() == nil)
        #expect(try store.load() == nil)
    }
}
