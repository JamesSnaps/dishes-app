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

    /// One planned dish (not part of a combined meal) onto the list, at its servings.
    public func addEntryToShopping(entryId: String) async throws -> ShoppingAddResult {
        struct Body: Encodable {}
        return try await request("/meal-plan/entries/\(entryId)/shopping-list", method: "POST", json: Body())
    }

    // MARK: AI

    /// The household's AI prompt inputs, for AI on the device. Cached by the
    /// app after each sync (AIContext.save) so it works offline.
    public func aiContext() async throws -> AIContext {
        try await request("/ai/context")
    }

    // MARK: Household

    public struct Member: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var displayName: String
        public var role: String
        public var avatarUrl: String?
        /// On a cholesterol-lowering diet: ticking them switches Heart-healthy on.
        public var cholesterolDiet: Bool?
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
        /// Minutes it actually took.
        public var actualDuration: Int?
        public var occasion: String?

        public init(recipeId: String, rating: Double?, notes: String?, cookedFor: [String]?, memberRatings: [MemberRating]?,
                    actualDuration: Int? = nil, occasion: String? = nil) {
            self.recipeId = recipeId
            self.rating = rating
            self.notes = notes
            self.cookedFor = cookedFor
            self.memberRatings = memberRatings
            self.actualDuration = actualDuration
            self.occasion = occasion
        }
    }

    /// Every field of a logged cook, for editing it. Empty fields are sent as
    /// null, so clearing one on the form clears it on the server.
    public struct UpdateCook: Encodable, Sendable {
        public var rating: Double?
        public var notes: String?
        public var cookedFor: [String]?
        public var memberRatings: [LogCook.MemberRating]?
        public var actualDuration: Int?
        public var occasion: String?
        public var removePhoto: Bool

        public init(rating: Double?, notes: String?, cookedFor: [String]?, memberRatings: [LogCook.MemberRating]?,
                    actualDuration: Int?, occasion: String?, removePhoto: Bool) {
            self.rating = rating; self.notes = notes; self.cookedFor = cookedFor; self.memberRatings = memberRatings
            self.actualDuration = actualDuration; self.occasion = occasion; self.removePhoto = removePhoto
        }

        enum Keys: String, CodingKey { case rating, notes, cookedFor, memberRatings, actualDuration, occasion, removePhoto }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(rating, forKey: .rating)
            try c.encode(notes, forKey: .notes)
            try c.encode(cookedFor, forKey: .cookedFor)
            try c.encode(memberRatings, forKey: .memberRatings)
            try c.encode(actualDuration, forKey: .actualDuration)
            try c.encode(occasion, forKey: .occasion)
            try c.encode(removePhoto, forKey: .removePhoto)
        }
    }

    /// Edits a logged cook (every field). 200 with the entry; the change syncs down.
    public func updateCook(id: String, _ cook: UpdateCook) async throws {
        let body = try JSONEncoder().encode(cook)
        _ = try await send { token in
            var r = authorisedRequest(url("/cook-history/\(id)"), method: "PATCH", token: token)
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
        }
    }

    /// The AI's take on the cook's photo, as the web shows after saving.
    public func cookPhotoFeedback(cookId: String) async throws -> String {
        struct Reply: Decodable { var feedback: String }
        return try await slowPost("/cook-history/\(cookId)/feedback", json: [String: String](), timeout: 60, as: Reply.self).feedback
    }

    /// The recipe's cook time, from how long a cook really took.
    public func setCookTime(recipeId: String, minutes: Int) async throws {
        let body = try JSONEncoder().encode(["minutes": minutes])
        _ = try await send { token in
            var r = authorisedRequest(url("/recipes/\(recipeId)/cook-time"), method: "POST", token: token)
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
        }
    }

    /// "Mark ingredients as used from pantry".
    public func usePantry(recipeId: String, servings: Double) async throws {
        let body = try JSONEncoder().encode(["servings": servings])
        _ = try await send { token in
            var r = authorisedRequest(url("/recipes/\(recipeId)/use-pantry"), method: "POST", token: token)
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
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

    // MARK: Notification actions

    public struct Snoozed: Decodable, Sendable { public var dinnerTime: String; public var remindAt: String? }

    /// "Push back 30 min" on a dinner reminder: moves that date's dinner time.
    public func snoozeDinner(date: String) async throws -> Snoozed {
        struct Body: Encodable { var date: String }
        return try await request("/dinner-reminders/snooze", method: "POST", json: Body(date: date))
    }

    /// "Mark as ordered" on a delivery reminder.
    public func markDeliveryOrdered(date: String) async throws {
        struct Body: Encodable { var date: String }
        struct Reply: Decodable { var date: String }
        _ = try await request("/deliveries/ordered", method: "POST", json: Body(date: date), as: Reply.self)
    }

    // MARK: Meal schedule

    /// A planned meal's schedule as clock times (epoch ms), for the Live Activity.
    public struct MealClock: Decodable, Sendable {
        public struct Cue: Decodable, Sendable, Hashable {
            public var id: String
            public var at: Double
            /// The dish this starts, and its step; nil for a note or the serve cue.
            public var recipeId: String?
            public var stepIndex: Int?
            public var dish: String?
            public var text: String
            /// A combined prep step (AI schedules): the dishes' steps it does at once.
            public var covers: [CueStep]?

            public init(id: String, at: Double, recipeId: String?, stepIndex: Int?, dish: String?, text: String,
                        covers: [CueStep]? = nil) {
                self.id = id; self.at = at; self.recipeId = recipeId; self.stepIndex = stepIndex; self.dish = dish; self.text = text
                self.covers = covers
            }
        }
        public struct CueStep: Codable, Sendable, Hashable {
            public var recipeId: String
            public var stepIndex: Int
            public init(recipeId: String, stepIndex: Int) { self.recipeId = recipeId; self.stepIndex = stepIndex }
        }
        public var groupId: String
        public var title: String
        public var serveAt: Double
        public var cues: [Cue]
        /// Frozen for a cook in progress (timeline.freeze).
        public var frozen: Bool?
    }

    public func mealClock(groupId: String) async throws -> MealClock {
        try await request("/meal-plan/groups/\(groupId)/clock")
    }

    /// Hands a meal-schedule Live Activity's push token to the server, which
    /// then keeps it current. 204, no body.
    public func registerLiveActivity(groupId: String, token: String, sandbox: Bool) async throws {
        struct Body: Encodable { var groupId: String; var token: String; var environment: String }
        let body = try JSONEncoder().encode(Body(groupId: groupId, token: token, environment: sandbox ? "sandbox" : "production"))
        _ = try await send { bearer in
            var r = authorisedRequest(url("/live-activities"), method: "POST", token: bearer)
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
        }
    }

    // MARK: Cooking sessions (a cook in progress, followed from other devices)

    /// A cook in progress as the device cooking it publishes it, so the
    /// household's other devices (and the Watch, through its phone) can follow
    /// it. Only the cooking device writes it; times are epoch ms
    /// (apps/web/lib/cooking-sessions.ts).
    public struct CookingSession: Codable, Sendable, Equatable {
        public struct Timer: Codable, Sendable, Equatable {
            public var id: String
            public var label: String
            public var dish: String?
            public var endsAt: Double?
            public var remainingMs: Double
            /// The whole length, added minutes included.
            public var durationMs: Double?
            /// "running", "paused" or "finished".
            public var state: String

            public init(id: String, label: String, dish: String?, endsAt: Double?, remainingMs: Double,
                        durationMs: Double?, state: String) {
                self.id = id; self.label = label; self.dish = dish; self.endsAt = endsAt
                self.remainingMs = remainingMs; self.durationMs = durationMs; self.state = state
            }
        }

        public var id: String
        /// Goes up with every change, so the server can turn down one that arrives out of order.
        public var version: Int
        public var startedAt: Double
        public var title: String
        /// "iPad", "iPhone".
        public var device: String
        public var dish: String
        public var step: Int
        public var totalSteps: Int
        public var instruction: String
        public var timers: [Timer]
        /// Set by the server.
        public var updatedAt: Double?
        public var memberName: String?

        public init(id: String, version: Int, startedAt: Double, title: String, device: String, dish: String,
                    step: Int, totalSteps: Int, instruction: String, timers: [Timer]) {
            self.id = id; self.version = version; self.startedAt = startedAt; self.title = title
            self.device = device; self.dish = dish; self.step = step; self.totalSteps = totalSteps
            self.instruction = instruction; self.timers = timers
        }
    }

    /// Publishes this device's cook. False when the server has finished with
    /// this session (ended, or started too long ago): stop publishing it.
    public func publishCooking(_ session: CookingSession) async throws -> Bool {
        struct Reply: Decodable { var ok: Bool }
        do {
            _ = try await request("/cooking-sessions/\(session.id)", method: "PUT", json: session, as: Reply.self)
            return true
        } catch APIError.http(status: 410, _, _) {
            return false
        } catch APIError.http(status: 409, _, _) {
            // Overtaken by a newer version of the same cook: nothing to do.
            return true
        }
    }

    public func endCooking(id: String) async throws {
        _ = try await send { bearer in authorisedRequest(url("/cooking-sessions/\(id)"), method: "DELETE", token: bearer) }
    }

    /// The household's cooks in progress, newest first.
    public func cookingSessions() async throws -> [CookingSession] {
        struct Reply: Decodable { var sessions: [CookingSession] }
        return try await request("/cooking-sessions", as: Reply.self).sessions
    }

    // MARK: AI (the household's own OpenAI key, server-side)

    public struct AIStatus: Decodable, Sendable { public var configured: Bool }

    public func aiStatus() async throws -> AIStatus { try await request("/ai/status") }

    /// AI calls take tens of seconds: a POST with its own timeout, decoding the reply.
    func slowPost<T: Decodable>(_ path: String, json body: some Encodable, timeout seconds: TimeInterval = 150,
                                as type: T.Type = T.self) async throws -> T {
        let encoded = try JSONEncoder().encode(body)
        let data = try await send { token in
            var r = authorisedRequest(url(path), method: "POST", token: token)
            r.timeoutInterval = seconds
            r.httpBody = encoded
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            return r
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    public struct Concept: Codable, Hashable, Sendable, Identifiable {
        public var title: String
        public var description: String
        public var cuisine: String
        public var tags: [String]
        public var difficulty: String
        public var id: String { title }

        public init(title: String, description: String, cuisine: String = "", tags: [String] = [], difficulty: String = "medium") {
            self.title = title; self.description = description; self.cuisine = cuisine; self.tags = tags; self.difficulty = difficulty
        }
    }

    public struct ConceptRequest: Encodable, Sendable {
        public var prompt: String
        public var memberIds: [String]?
        public var mealType: String?
        public var heartHealthy: Bool?
        public init(prompt: String, memberIds: [String]? = nil, mealType: String? = nil, heartHealthy: Bool? = nil) {
            self.prompt = prompt; self.memberIds = memberIds; self.mealType = mealType; self.heartHealthy = heartHealthy
        }
    }

    /// Step one of the concierge: five ideas.
    public func recipeConcepts(_ ask: ConceptRequest) async throws -> [Concept] {
        struct Reply: Decodable { var concepts: [Concept] }
        return try await slowPost("/ai/concepts", json: ask, timeout: 90, as: Reply.self).concepts
    }

    public struct CreatedRecipe: Decodable, Hashable, Sendable {
        public var recipeId: String
        public var title: String
        public var collectionName: String?
    }

    /// Step two: the chosen idea written out in full and saved; it syncs down next.
    public func createRecipe(from concept: Concept, memberIds: [String]?, mealType: String?, heartHealthy: Bool?) async throws -> CreatedRecipe {
        struct Body: Encodable { var concept: Concept; var memberIds: [String]?; var mealType: String?; var heartHealthy: Bool? }
        return try await slowPost("/ai/recipes", json: Body(concept: concept, memberIds: memberIds, mealType: mealType, heartHealthy: heartHealthy))
    }

    /// A photo of a cookbook page or recipe card, read and saved as a recipe.
    public func recipeFromPhoto(_ image: Data, mime: String = "image/jpeg") async throws -> CreatedRecipe {
        struct Body: Encodable { var image: String; var mimeType: String }
        return try await slowPost("/ai/photo-recipe", json: Body(image: image.base64EncodedString(), mimeType: mime))
    }

    public struct ImportedRecipe: Decodable, Hashable, Sendable {
        public var recipeId: String
        public var title: String
        /// How it was read: "recipe-data", "recipe-data+ai" or "ai".
        public var via: String?
        /// Something to pass on, e.g. the photo couldn't be copied.
        public var notice: String?
    }

    /// A recipe page read in (the web's Import from web) and saved; it syncs down next.
    public func recipeFromWeb(_ url: String) async throws -> ImportedRecipe {
        struct Body: Encodable { var url: String }
        return try await slowPost("/recipes/import-url", json: Body(url: url), timeout: 120)
    }

    public struct PlanSlot: Codable, Hashable, Sendable, Identifiable {
        public var dayOfWeek: Int
        public var mealType: String
        public var title: String
        public var description: String
        public var cuisine: String
        public var difficulty: String
        public var recipeId: String?
        public var id: String { "\(dayOfWeek)-\(mealType)" }
    }

    public struct PlanRequest: Encodable, Sendable {
        public struct Slot: Encodable, Sendable { public var dayOfWeek: Int; public var mealType: String }
        public var weekStartDate: String
        public var slots: [Slot]
        public var preferences: String
        public var memberIds: [String]?
        public var favouritesOnly: Bool?
        public var heartHealthy: Bool?
        public init(weekStartDate: String, slots: [(Int, String)], preferences: String, memberIds: [String]?, favouritesOnly: Bool?,
                    heartHealthy: Bool? = nil) {
            self.heartHealthy = heartHealthy
            self.weekStartDate = weekStartDate
            self.slots = slots.map { Slot(dayOfWeek: $0.0, mealType: $0.1) }
            self.preferences = preferences
            self.memberIds = memberIds
            self.favouritesOnly = favouritesOnly
        }
    }

    /// A draft week; nothing is saved until `applyMealPlan`.
    public func draftMealPlan(_ ask: PlanRequest) async throws -> [PlanSlot] {
        struct Reply: Decodable { var slots: [PlanSlot] }
        return try await slowPost("/ai/meal-plan", json: ask, timeout: 120, as: Reply.self).slots
    }

    /// Adds the draft; new ideas are written out as recipes first, so it's slow.
    public func applyMealPlan(weekStartDate: String, slots: [PlanSlot], memberIds: [String]?, heartHealthy: Bool? = nil) async throws {
        struct Body: Encodable { var weekStartDate: String; var slots: [PlanSlot]; var memberIds: [String]?; var heartHealthy: Bool? }
        struct Reply: Decodable { var success: Bool? }
        _ = try await slowPost("/ai/meal-plan/apply", json: Body(weekStartDate: weekStartDate, slots: slots, memberIds: memberIds,
                                                                  heartHealthy: heartHealthy),
                               timeout: 600, as: Reply.self)
    }

    public struct AssistMessage: Codable, Hashable, Sendable {
        public var role: String
        public var content: String
        public init(role: String, content: String) { self.role = role; self.content = content }
    }

    public struct CookAssistContext: Encodable, Sendable {
        public struct Ingredient: Encodable, Sendable { public var amount: String?; public var unit: String?; public var name: String
            public init(amount: String?, unit: String?, name: String) { self.amount = amount; self.unit = unit; self.name = name } }
        public struct Step: Encodable, Sendable { public var number: Int; public var instruction: String
            public init(number: Int, instruction: String) { self.number = number; self.instruction = instruction } }
        public var recipeTitle: String
        public var stepNumber: Int
        public var stepInstruction: String
        public var stepIngredients: [Ingredient]
        public var allIngredients: [Ingredient]
        public var allSteps: [Step]
        public var servingsSummary: String?
        public var messages: [AssistMessage]
        public init(recipeTitle: String, stepNumber: Int, stepInstruction: String, stepIngredients: [Ingredient],
                    allIngredients: [Ingredient], allSteps: [Step], servingsSummary: String?, messages: [AssistMessage]) {
            self.recipeTitle = recipeTitle; self.stepNumber = stepNumber; self.stepInstruction = stepInstruction
            self.stepIngredients = stepIngredients; self.allIngredients = allIngredients; self.allSteps = allSteps
            self.servingsSummary = servingsSummary; self.messages = messages
        }
    }

    /// "Ask about this step": the answer as it's written, chunk by chunk.
    public func cookAssist(_ context: CookAssistContext) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let token = try await tokens?.accessToken()
                    if tokens != nil && token == nil { throw APIError.signedOut }
                    var r = authorisedRequest(url("/cook-assist"), method: "POST", token: token)
                    r.timeoutInterval = 120
                    r.setValue("text/plain", forHTTPHeaderField: "Accept")
                    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    r.httpBody = try JSONEncoder().encode(context)
                    let (bytes, response) = try await session.bytes(for: r)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var text = ""
                        for try await line in bytes.lines { text += line }
                        throw APIError.http(status: http.statusCode, code: "http_error", message: text.isEmpty ? "HTTP \(http.statusCode)" : text)
                    }
                    var buffer = [UInt8]()
                    for try await byte in bytes {
                        buffer.append(byte)
                        // A word at a time (and only whole UTF-8 characters), not a redraw per byte.
                        guard byte == 0x20 || byte == 0x0A || buffer.count >= 24,
                              let text = String(bytes: buffer, encoding: .utf8) else { continue }
                        continuation.yield(text)
                        buffer.removeAll(keepingCapacity: true)
                    }
                    if let rest = String(bytes: buffer, encoding: .utf8), !rest.isEmpty { continuation.yield(rest) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: The website's features (POST /api/v1/actions/{name})

    /// One of the web's actions by name (apps/web/lib/api/v1-actions.ts),
    /// answering its result decoded as `T`. `args` are the action's arguments,
    /// in order. AI actions (`ai.*`, `timeline.planWithAi`, `wrapped.recap`)
    /// get a long timeout.
    public func action<T: Decodable & Sendable>(_ name: String, _ args: [JSONValue] = [], as type: T.Type = T.self) async throws -> T {
        let slow = name.hasPrefix("ai.") || name == "timeline.planWithAi" || name == "wrapped.recap" || name == "library.import"
        return try await slowPost("/actions/\(name)", json: ActionBody(args: args), timeout: slow ? 150 : 20, as: ActionReply<T>.self).result
    }

    /// An action whose answer doesn't matter.
    public func run(_ name: String, _ args: [JSONValue] = []) async throws {
        _ = try await action(name, args, as: JSONValue.self)
    }
}

struct ActionBody: Encodable { var args: [JSONValue] }
struct ActionReply<R: Decodable>: Decodable { var result: R }
