// The Dishes client API over URLSession — the Swift twin of
// packages/client/src/api.ts. Adds the bearer token to every request, turns
// the server's error envelope into APIError, and refreshes the token once when
// the server says it has expired.
//
//   let api = APIClient(baseURL: URL(string: "https://dishes.collardserver.co.uk")!, tokens: auth)
//   let me = try await api.whoami()
//
// `tokens: nil` is the dev-server path: a development build of the web app
// signs a token-less request in as its stand-in user (lib/auth.ts, DEV_USER).
//
// Errors: `{"error": {"code", "message"}}` from the server (lib/api/respond.ts).

import Foundation

public enum APIError: Error, Equatable, Sendable, CustomStringConvertible {
    /// Signed out (refresh refused, or no tokens): local data and the outbox stay.
    case signedOut
    /// The server answered with an error. Reaching it at all means the connection is fine.
    case http(status: Int, code: String, message: String)

    public var code: String? {
        switch self {
        case .signedOut: "unauthenticated"
        case .http(_, let code, _): code
        }
    }

    public var description: String {
        switch self {
        case .signedOut: "Signed out"
        case .http(let status, let code, let message): "\(status) \(code): \(message)"
        }
    }
}

/// Where requests get their bearer token (AuthSession in the app).
public protocol TokenProvider: Sendable {
    /// A token that isn't about to expire (refreshing first if needed), or nil when signed out.
    func accessToken() async throws -> String?
    /// The server turned `rejected` down: get a new one (once, however many requests ask).
    func refresh(after rejected: String) async throws -> String?
}

/// What the sync engine needs from the network, so tests can stand in for it.
public protocol SyncTransport: Sendable {
    func pull(cursor: String?, limit: Int) async throws -> PullResponse
    func push(_ mutations: [QueuedMutation]) async throws -> PushResponse
}

struct ErrorEnvelope: Decodable {
    struct Body: Decodable { var code: String?; var message: String? }
    var error: Body?
}

public final class APIClient: SyncTransport, Sendable {
    public let baseURL: URL
    let tokens: (any TokenProvider)?
    let session: URLSession
    /// How long a request may hang before the phone counts as offline. The
    /// question isn't how slow the server can be but how long one bar of
    /// signal should hold a connection open (api.ts uses 8s for the same reason).
    let timeout: TimeInterval

    public init(baseURL: URL, tokens: (any TokenProvider)?, session: URLSession = .shared, timeout: TimeInterval = 10) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.session = session
        self.timeout = timeout
    }

    /// `/api/v1` + path, with an optional query string.
    public func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent("api/v1" + path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query }
        return c.url!
    }

    /// A request with the headers every call needs.
    public func authorisedRequest(_ url: URL, method: String = "GET", token: String?) -> URLRequest {
        var r = URLRequest(url: url, timeoutInterval: timeout)
        r.httpMethod = method
        // Not tidiness: Authelia answers a request that accepts HTML with a 302
        // to its login portal. Asking for JSON gets a 401 we can act on.
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return r
    }

    /// Sends a request, refreshing the token and trying once more on a 401.
    /// `make` builds the request for a given token so it can be rebuilt.
    public func send(_ make: (String?) -> URLRequest) async throws -> Data {
        let token = try await tokens?.accessToken()
        if tokens != nil && token == nil { throw APIError.signedOut }
        do {
            return try Self.check(try await session.data(for: make(token)))
        } catch APIError.http(401, _, _) where tokens != nil && token != nil {
            guard let fresh = try await tokens?.refresh(after: token!) else { throw APIError.signedOut }
            do {
                return try Self.check(try await session.data(for: make(fresh)))
            } catch APIError.http(401, _, _) {
                throw APIError.signedOut
            }
        }
    }

    /// Turns a response into its body, or the error it describes.
    public static func check(_ result: (Data, URLResponse)) throws -> Data {
        let (data, response) = result
        guard let http = response as? HTTPURLResponse else { return data }
        let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
        // An HTML page is Authelia's login portal, not the API.
        if type.contains("text/html") { throw APIError.signedOut }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw APIError.http(status: http.statusCode, code: envelope?.error?.code ?? "http_error",
                                message: envelope?.error?.message ?? "HTTP \(http.statusCode)")
        }
        return data
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", query: [URLQueryItem] = [],
                               json body: (some Encodable)? = Optional<Int>.none, as type: T.Type = T.self) async throws -> T {
        let encoded = try body.map { try JSONEncoder().encode($0) }
        let data = try await send { token in
            var r = authorisedRequest(url(path, query: query), method: method, token: token)
            if let encoded {
                r.httpBody = encoded
                r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            return r
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Calls

    public func whoami() async throws -> WhoAmI {
        try await request("/auth/whoami")
    }

    /// Omit the cursor for a full snapshot.
    public func pull(cursor: String?, limit: Int) async throws -> PullResponse {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request("/sync", query: query)
    }

    public func push(_ mutations: [QueuedMutation]) async throws -> PushResponse {
        struct Wire: Encodable { var opId: String; var type: String; var payload: JSONValue }
        struct Body: Encodable { var mutations: [Wire] }
        // queuedAt and temporary are local bookkeeping; the server neither wants nor accepts them.
        let body = Body(mutations: mutations.map { Wire(opId: $0.opId, type: $0.type, payload: $0.payload) })
        return try await request("/sync", method: "POST", json: body)
    }

    // MARK: Recipes

    /// Flips a recipe's favourite flag; answers the new value. Not a sync
    /// mutation (A3 left recipe writes out), so the app patches its copy locally.
    public func toggleFavourite(recipeId: String) async throws -> Bool {
        struct Reply: Decodable { var isFavourite: Bool }
        return try await request("/recipes/\(recipeId)/favourite", method: "POST", as: Reply.self).isFavourite
    }
}
