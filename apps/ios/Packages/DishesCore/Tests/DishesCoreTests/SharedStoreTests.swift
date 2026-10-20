// The App Group database (Store/SharedStore.swift) and the cached AI context
// (Models/AIContext.swift) — TODO_MOBILE.md, Phase D0.

import Foundation
import Testing
@testable import DishesCore

// Serialized: suspend() is process-wide, so a test writing alongside the suspend test could fail.
@Suite(.serialized) struct SharedStoreTests {
    let folder: URL = {
        let url = FileManager.default.temporaryDirectory.appending(path: "dishes-\(UUID().uuidString)", directoryHint: .isDirectory)
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    @Test func movesTheDatabaseWithItsWalOnce() async throws {
        let old = folder.appending(path: "old/dishes.sqlite")
        try FileManager.default.createDirectory(at: old.deletingLastPathComponent(), withIntermediateDirectories: true)
        do {
            let store = try LocalStore(path: old.path)
            try await store.write { try $0.setMeta("cursor", "abc") }
        }
        let new = folder.appending(path: "group/Library/Application Support/Dishes/dishes.sqlite")
        try LocalStore.moveDatabase(from: old, to: new)

        #expect(!FileManager.default.fileExists(atPath: old.path))
        let moved = try LocalStore(sharedPath: new.path)
        #expect(try await moved.read { try $0.cursor() } == "abc")

        // A second launch: the group copy is the one, whatever's left behind.
        try Data("not a database".utf8).write(to: old)
        try LocalStore.moveDatabase(from: old, to: new)
        #expect(try await moved.read { try $0.cursor() } == "abc")
    }

    @Test func nothingToMoveIsFine() throws {
        try LocalStore.moveDatabase(from: folder.appending(path: "none.sqlite"), to: folder.appending(path: "new.sqlite"))
        #expect(!FileManager.default.fileExists(atPath: folder.appending(path: "new.sqlite").path))
    }

    @Test func keepsItsWalFilesForReadOnlyProcesses() async throws {
        let path = folder.appending(path: "dishes.sqlite").path
        do {
            let store = try LocalStore(sharedPath: path)
            try await store.write { try $0.setMeta("cursor", "abc") }
        }
        // Persistent WAL: still there after the last connection closes, so a widget can open it.
        #expect(FileManager.default.fileExists(atPath: path + "-wal"))
        #expect(FileManager.default.fileExists(atPath: path + "-shm"))
    }

    @Test func aSuspendedStoreReadsButDoesNotWrite() async throws {
        let store = try LocalStore(sharedPath: folder.appending(path: "dishes.sqlite").path)
        try await store.write { try $0.setMeta("cursor", "abc") }

        LocalStore.suspend()
        #expect(try await store.read { try $0.cursor() } == "abc")
        await #expect(throws: (any Error).self) { try await store.write { try $0.setMeta("cursor", "def") } }

        LocalStore.resume()
        try await store.write { try $0.setMeta("cursor", "def") }
        #expect(try await store.read { try $0.cursor() } == "def")
    }

    @Test func aiContextFixtureDecodesAndRoundTrips() throws {
        // fixtures/wire/ai-context.json: GET /api/v1/ai/context (scripts/check-ai-context.ts checks its fields).
        let url = URL(filePath: #filePath).deletingLastPathComponent()
            .appending(path: "../../../../../../fixtures/wire/ai-context.json").standardized
        let context = try JSONDecoder().decode(AIContext.self, from: Data(contentsOf: url))
        #expect(context.measurementSystem == "metric")
        #expect(context.members.count == 2)
        #expect(context.members[1].birthYear == nil)
        #expect(context.tasteProfile?.preferredCuisines.first?.name == "Italian")
        #expect(context.collections.map(\.name) == ["Soups", "Weeknight"])

        #expect(AIContext.load(from: folder) == nil)
        try context.save(to: folder)
        #expect(AIContext.load(from: folder) == context)
        AIContext.forget(in: folder)
        #expect(AIContext.load(from: folder) == nil)
    }

    @Test func aHouseholdWithoutATasteProfileDecodes() throws {
        let json = #"""
        {"configured":false,"measurementSystem":"metric","defaultPrompt":null,"kitchenEquipment":null,
         "webGrounding":false,"members":[],"tasteProfile":null,"collections":[]}
        """#
        let context = try JSONDecoder().decode(AIContext.self, from: Data(json.utf8))
        #expect(!context.configured)
        #expect(context.tasteProfile == nil)
    }
}
