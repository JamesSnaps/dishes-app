// What the server's AI prompts know about the household, for the same prompts
// on the device (TODO_MOBILE.md, Phase D): GET /api/v1/ai/context, shaped as
// apps/web/lib/services/ai-context.ts. Never the key or the budget.
//
// Kept as a plain JSON file in the App Group container rather than in the
// database, so the share extension can read it without opening SQLite:
//
//   try context.save()                 // the app, after a sync
//   let context = AIContext.cached     // anywhere, offline

import Foundation

public struct AIContext: Codable, Hashable, Sendable {
    public struct Member: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var displayName: String
        public var role: String
        public var birthYear: Int?
        public var dietaryFlags: [String]
        public var dislikes: [String]
        public var preferences: [String]
        public var customNotes: String?
    }

    public struct TasteProfile: Codable, Hashable, Sendable {
        public struct Cuisine: Codable, Hashable, Sendable {
            public var name: String
            /// 1–5.
            public var score: Double
        }

        public var ratedCookCount: Int
        public var preferredCuisines: [Cuisine]
        public var lovedIngredients: [String]
        public var dislikedIngredients: [String]
    }

    public struct Collection: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var description: String?
    }

    /// The household has a key, so the server can take a job the device can't.
    public var configured: Bool
    /// "metric" or "imperial".
    public var measurementSystem: String
    public var defaultPrompt: String?
    public var kitchenEquipment: String?
    public var webGrounding: Bool
    public var members: [Member]
    /// nil until there are enough rated cooks to mean anything.
    public var tasteProfile: TasteProfile?
    public var collections: [Collection]

    // MARK: The cached copy

    static let fileName = "ai-context.json"

    /// The last copy saved on this device, or nil before the first sync.
    public static var cached: AIContext? { load(from: defaultFolder) }

    /// Saved for the app and its extensions; atomically, so a reader never sees half.
    public func save() throws { try save(to: Self.defaultFolder) }

    /// Signing out: the next household's settings aren't these.
    public static func forget() { forget(in: defaultFolder) }

    /// The App Group container, or the app's own Caches in a build signed without it.
    static var defaultFolder: URL {
        AppGroup.containerURL ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    static func load(from folder: URL) -> AIContext? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(fileName)) else { return nil }
        return try? JSONDecoder().decode(AIContext.self, from: data)
    }

    func save(to folder: URL) throws {
        try JSONEncoder().encode(self).write(to: folder.appendingPathComponent(Self.fileName), options: .atomic)
    }

    static func forget(in folder: URL) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(fileName))
    }
}
