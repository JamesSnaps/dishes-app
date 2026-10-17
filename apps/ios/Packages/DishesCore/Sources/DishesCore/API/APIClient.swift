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

    // MARK: Meal plan

    public struct ShoppingAddResult: Decodable, Sendable {
        public var added: Int
        public var merged: Int
        public var skipped: [String]
    }

    /// Puts every meal in a week that isn't on the list yet onto it. Server-side
    /// on purpose (Phase B): the result depends on pantry stock and merging.
    public func addWeekToShopping(mealPlanId: String) async throws -> ShoppingAddResult {
        struct Body: Encodable { var mealPlanId: String }
        return try await request("/meal-plan/generate-shopping", method: "POST", json: Body(mealPlanId: mealPlanId))
    }

    // MARK: Household

    public struct Member: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var displayName: String
        public var role: String
    }

    /// Active members, for "who ate it" and per-person ratings.
    public func members() async throws -> [Member] {
        struct Reply: Decodable { var members: [Member] }
        return try await request("/members", as: Reply.self).members
    }

    // MARK: Cook history

    public struct LogCook: Encodable, Sendable {
        public struct MemberRating: Encodable, Sendable {
            public var name: String
            public var rating: Double
            public init(name: String, rating: Double) { self.name = name; self.rating = rating }
        }
        public var recipeId: String
        public var rating: Double?
        public var notes: String?
        public var cookedFor: [String]?
        public var memberRatings: [MemberRating]?

        public init(recipeId: String, rating: Double?, notes: String?, cookedFor: [String]?, memberRatings: [MemberRating]?) {
            self.recipeId = recipeId
            self.rating = rating
            self.notes = notes
            self.cookedFor = cookedFor
            self.memberRatings = memberRatings
        }
    }

    /// Logs a cook. Not a sync mutation yet (cook history is read-only over
    /// sync), so this needs a connection; the entry arrives in the next pull.
    @discardableResult
    public func logCook(_ cook: LogCook) async throws -> String {
        struct Reply: Decodable { var id: String }
        return try await request("/cook-history", method: "POST", json: cook, as: Reply.self).id
    }

    /// 204, no body — so not through `request`, which decodes one.
    public func deleteCook(id: String) async throws {
        _ = try await send { token in authorisedRequest(url("/cook-history/\(id)"), method: "DELETE", token: token) }
    }

    // MARK: Shopping

    public struct GenerateResult: Decodable, Sendable { public var listId: String; public var changed: Bool }

    /// Puts a recipe's ingredients on the active list at a number of servings,
    /// skipping what the pantry covers and merging lines (server-side, as the web).
    public func addRecipeToShopping(recipeId: String, servings: Double?) async throws -> GenerateResult {
        struct Body: Encodable { var recipeId: String; var servings: Double? }
        return try await request("/shopping/generate", method: "POST", json: Body(recipeId: recipeId, servings: servings))
    }

    // MARK: Collections

    public struct Collection: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var icon: String?
        public var description: String?
        public var recipeIds: [String]
    }

    public func collections() async throws -> [Collection] {
        struct Reply: Decodable { var collections: [Collection] }
        return try await request("/collections", as: Reply.self).collections
    }

    public func createCollection(name: String, icon: String?) async throws -> Collection {
        struct Body: Encodable { var name: String; var icon: String? }
        return try await request("/collections", method: "POST", json: Body(name: name, icon: icon))
    }

    /// 204, no body.
    public func setRecipe(_ recipeId: String, inCollection collectionId: String, _ inside: Bool) async throws {
        _ = try await send { token in
            authorisedRequest(url("/collections/\(collectionId)/recipes/\(recipeId)"),
                              method: inside ? "PUT" : "DELETE", token: token)
        }
    }

    // MARK: Writing recipes

    /// Creates (`id == nil`) or replaces a recipe. `payload` is the full
    /// recipe in /api/v1's write format (lib/api/schemas/recipe.ts): a replace
    /// sets every field, so anything left out is cleared. Answers the id.
    @discardableResult
    public func saveRecipe(id: String?, payload: JSONValue) async throws -> String {
        struct Reply: Decodable { var recipe: JSONValue }
        let reply = try await request(id.map { "/recipes/\($0)" } ?? "/recipes", method: id == nil ? "POST" : "PUT",
                                      json: payload, as: Reply.self)
        guard let saved = reply.recipe.id else { throw APIError.http(status: 500, code: "internal_error", message: "No id") }
        return saved
    }

    public func deleteRecipe(id: String) async throws {
        _ = try await send { token in authorisedRequest(url("/recipes/\(id)"), method: "DELETE", token: token) }
    }

    // MARK: Photos

    /// A dish photo for a logged cook; the server resizes and thumbnails it.
    @discardableResult
    public func uploadCookPhoto(cookId: String, image: Data, mime: String = "image/jpeg") async throws -> String {
        struct Reply: Decodable { var url: String }
        let data = try await send { token in
            var r = authorisedRequest(url("/cook-history/\(cookId)/photo"), method: "POST", token: token)
            r.httpBody = image
            r.setValue(mime, forHTTPHeaderField: "Content-Type")
            r.timeoutInterval = 60
            return r
        }
        return try JSONDecoder().decode(Reply.self, from: data).url
    }

    // MARK: Recipes

    /// Flips a recipe's favourite flag; answers the new value. Not a sync
    /// mutation (A3 left recipe writes out), so the app patches its copy locally.
    public func toggleFavourite(recipeId: String) async throws -> Bool {
        struct Reply: Decodable { var isFavourite: Bool }
        return try await request("/recipes/\(recipeId)/favourite", method: "POST", as: Reply.self).isFavourite
    }

    // MARK: Notifications

    /// Your notification choices and the devices they go to (Settings → Notifications).
    public struct NotificationSettings: Codable, Hashable, Sendable {
        public struct Kind: Codable, Hashable, Sendable, Identifiable {
            public var id: String
            public var title: String
            public var description: String
            public var group: String
            public var enabled: Bool
        }
        public struct Device: Codable, Hashable, Sendable, Identifiable {
            public var id: String
            /// "web" or "ios".
            public var kind: String
            public var name: String
            public var createdAt: String
        }
        public var types: [Kind]
        public var devices: [Device]
    }

    public func notificationSettings() async throws -> NotificationSettings {
        try await request("/notifications")
    }

    /// Turns one kind on or off; answers the settings as they now stand.
    public func setNotification(_ type: String, enabled: Bool) async throws -> NotificationSettings {
        struct Body: Encodable { var type: String; var enabled: Bool }
        return try await request("/notifications", method: "PATCH", json: Body(type: type, enabled: enabled))
    }

    /// 204, no body.
    public func removeNotificationDevice(id: String) async throws {
        _ = try await send { token in authorisedRequest(url("/notifications/devices/\(id)"), method: "DELETE", token: token) }
    }

    /// Registers this device's APNs token. `sandbox` for an Xcode (debug) build.
    public func registerPushDevice(token: String, sandbox: Bool, name: String) async throws {
        struct Body: Encodable { var token: String; var environment: String; var deviceName: String }
        struct Reply: Decodable { var id: String }
        _ = try await request("/push/devices", method: "POST",
                              json: Body(token: token, environment: sandbox ? "sandbox" : "production", deviceName: name),
                              as: Reply.self)
    }

    public func unregisterPushDevice(token: String) async throws {
        struct Body: Encodable { var token: String }
        let body = try JSONEncoder().encode(Body(token: token))
        _ = try await send { bearer in
            var r = authorisedRequest(url("/push/devices"), method: "DELETE", token: bearer)
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
        }
    }

    public func sendTestPush(token: String) async throws {
        struct Body: Encodable { var token: String }
        struct Reply: Decodable { var ok: Bool }
        _ = try await request("/push/test", method: "POST", json: Body(token: token), as: Reply.self)
    }
}
