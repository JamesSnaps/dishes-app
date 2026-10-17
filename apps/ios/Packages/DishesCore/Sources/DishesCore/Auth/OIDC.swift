// A small OpenID Connect client for Authelia: authorisation code + PKCE (S256),
// as a native app should (RFC 8252). It doesn't open a browser itself; the
// caller does (ASWebAuthenticationSession in the app), so it can be tested
// without one.
//
// Copied from Keepsake's KeepsakeCore (same Authelia, same flow); keep the two
// in step until they're worth extracting into a shared package.
//
//   let oidc = OIDCClient(config: .dishesIOS())
//   let request = try await oidc.authorisationRequest()
//   let callback = try await presentBrowser(request.url)        // returns the redirect URL
//   let tokens = try await oidc.exchange(callback: callback, for: request)
//   let fresh = try await oidc.refresh(tokens.refreshToken!)
//
// The Swift twin of scripts/oidc-token.mjs (same issuer, client and scopes).

import CryptoKit
import Foundation

public struct OIDCConfig: Sendable {
    public var issuer: URL
    public var clientId: String
    public var redirectURI: String
    public var scope: String

    public init(issuer: URL, clientId: String, redirectURI: String,
                scope: String = "openid profile email groups offline_access") {
        self.issuer = issuer
        self.clientId = clientId
        self.redirectURI = redirectURI
        self.scope = scope
    }

    /// The Authelia client `dishes-mobile` (README, "Native app sign-in").
    public static func dishesIOS(redirectURI: String = "dishes://auth/callback",
                                 issuer: URL = URL(string: "https://auth.collardserver.co.uk")!) -> OIDCConfig {
        OIDCConfig(issuer: issuer, clientId: "dishes-mobile", redirectURI: redirectURI)
    }
}

public struct TokenSet: Codable, Hashable, Sendable {
    public var accessToken: String
    public var refreshToken: String?
    /** Unix ms; nil if the server didn't say. */
    public var expiresAt: Int?

    public init(accessToken: String, refreshToken: String?, expiresAt: Int?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// True when it has expired or will within `margin` seconds.
    public func isExpiring(now: Date = Date(), margin: TimeInterval = 60) -> Bool {
        guard let expiresAt else { return false }
        return Double(expiresAt) / 1000 - margin <= now.timeIntervalSince1970
    }
}

public struct AuthorisationRequest: Sendable {
    public var url: URL
    public var state: String
    public var verifier: String
    public var redirectURI: String
}

public enum OIDCError: Error, Equatable, Sendable, CustomStringConvertible {
    case discovery(String)
    case denied(String)
    case stateMismatch
    case noCode
    /// The refresh token was turned down (expired, revoked): sign in again.
    case invalidGrant(String)
    case tokenEndpoint(status: Int, error: String)

    public var description: String {
        switch self {
        case .discovery(let m): "Couldn’t reach the sign-in server: \(m)"
        case .denied(let e): "Sign-in was cancelled or refused (\(e))"
        case .stateMismatch: "The sign-in reply didn’t match the request"
        case .noCode: "The sign-in reply had no code"
        case .invalidGrant(let m): "Sign in again (\(m))"
        case .tokenEndpoint(let status, let error): "The sign-in server answered \(status): \(error)"
        }
    }
}

public actor OIDCClient {
    public let config: OIDCConfig
    let session: URLSession
    private var endpoints: (authorisation: URL, token: URL)?

    public init(config: OIDCConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    /// Random URL-safe text, for the PKCE verifier and `state`.
    static func randomURLSafe(bytes: Int = 32) -> String {
        var data = Data(count: bytes)
        for i in 0..<bytes { data[i] = UInt8.random(in: 0...255) }
        return base64URL(data)
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The S256 challenge for a verifier.
    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    func discover() async throws -> (authorisation: URL, token: URL) {
        if let endpoints { return endpoints }
        struct Discovery: Decodable { var authorization_endpoint: URL; var token_endpoint: URL }
        let url = config.issuer.appendingPathComponent(".well-known/openid-configuration")
        do {
            let (data, response) = try await session.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw OIDCError.discovery("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
            let doc = try JSONDecoder().decode(Discovery.self, from: data)
            endpoints = (doc.authorization_endpoint, doc.token_endpoint)
            return endpoints!
        } catch let error as OIDCError {
            throw error
        } catch {
            throw OIDCError.discovery(error.localizedDescription)
        }
    }

    public func authorisationRequest() async throws -> AuthorisationRequest {
        let (authorisation, _) = try await discover()
        let verifier = Self.randomURLSafe()
        let state = Self.randomURLSafe(bytes: 16)
        var c = URLComponents(url: authorisation, resolvingAgainstBaseURL: false)!
        c.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: config.redirectURI),
            URLQueryItem(name: "scope", value: config.scope),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        return AuthorisationRequest(url: c.url!, state: state, verifier: verifier, redirectURI: config.redirectURI)
    }

    /// Checks the redirect Authelia sent back and swaps its code for tokens.
    public func exchange(callback: URL, for request: AuthorisationRequest) async throws -> TokenSet {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        if let error = value("error") { throw OIDCError.denied(value("error_description") ?? error) }
        guard value("state") == request.state else { throw OIDCError.stateMismatch }
        guard let code = value("code") else { throw OIDCError.noCode }
        return try await token([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": request.redirectURI,
            "client_id": config.clientId,
            "code_verifier": request.verifier,
        ], keeping: nil)
    }

    public func refresh(_ refreshToken: String) async throws -> TokenSet {
        try await token([
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": config.clientId,
        ], keeping: refreshToken)
    }

    func token(_ form: [String: String], keeping oldRefresh: String?) async throws -> TokenSet {
        let (_, tokenURL) = try await discover()
        var r = URLRequest(url: tokenURL)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        r.httpBody = Data((body.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)

        let (data, response) = try await session.data(for: r)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        struct Reply: Decodable {
            var access_token: String?
            var refresh_token: String?
            var expires_in: Double?
            var error: String?
            var error_description: String?
        }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        if let error = reply?.error {
            if error == "invalid_grant" { throw OIDCError.invalidGrant(reply?.error_description ?? error) }
            throw OIDCError.tokenEndpoint(status: status, error: reply?.error_description ?? error)
        }
        guard status == 200, let access = reply?.access_token else {
            throw OIDCError.tokenEndpoint(status: status, error: String(decoding: data.prefix(200), as: UTF8.self))
        }
        let expiresAt = reply?.expires_in.map { Int((Date().timeIntervalSince1970 + $0) * 1000) }
        // Authelia rotates refresh tokens; keep the old one only if it didn't send a new one.
        return TokenSet(accessToken: access, refreshToken: reply?.refresh_token ?? oldRefresh, expiresAt: expiresAt)
    }
}
