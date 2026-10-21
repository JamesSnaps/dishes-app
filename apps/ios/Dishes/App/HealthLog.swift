// Logged cooks into Apple Health (TODO_MOBILE.md, C4 "Log a cook → HealthKit"):
// the recipe's per-serving nutrition, times the portion eaten, as one food
// entry dated the cook. Write-only — Dishes never reads Health.
//
// Off by default, and per device: Health belongs to whoever's Apple ID the
// device is signed into, so a shared kitchen iPad shouldn't write the family's
// meals to its owner. The setting says who eats from this device; a cook is
// written only when that person ate it (`cookedFor`, by display name). The
// sample ids are kept against the cook's id, so editing the cook rewrites the
// entry and deleting it removes it.
//
//   await HealthLog.record(cookId: id, recipe: recipe, cookedFor: names, at: .now, portion: 1)
//   await HealthLog.remove(cookId: id)

import DishesCore
import Foundation
import HealthKit
import Observation
import os

@MainActor @Observable
final class HealthLog {
    static let shared = HealthLog()

    /// Health is on this device (not on every iPad model before iPadOS 17).
    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    /// "Add meals I eat to Health", for this device.
    var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: "health.enabled") } }
    /// Who eats from this device (a member's display name).
    var eater: String? { didSet { UserDefaults.standard.set(eater, forKey: "health.eater") } }

    @ObservationIgnored private let store = HKHealthStore()
    private static let log = Logger(subsystem: "uk.collco.dishes", category: "health")
    /// Portions offered on the review sheets.
    static let portions: [Double] = [0.5, 1, 1.5, 2]

    private init() {
        enabled = UserDefaults.standard.bool(forKey: "health.enabled")
        eater = UserDefaults.standard.string(forKey: "health.eater")
    }

    /// Whether a cook eaten by `cookedFor` is written: on, someone chosen, and they ate.
    func applies(to cookedFor: [String]) -> Bool {
        guard Self.available, enabled, let eater else { return false }
        return cookedFor.contains { $0.caseInsensitiveCompare(eater) == .orderedSame }
    }

    private static let types: [(HKQuantityTypeIdentifier, KeyPath<Recipe, Double?>, HKUnit)] = [
        (.dietaryEnergyConsumed, \.calories, .kilocalorie()),
        (.dietaryProtein, \.proteinG, .gram()),
        (.dietaryCarbohydrates, \.carbsG, .gram()),
        (.dietaryFatTotal, \.fatG, .gram()),
        (.dietaryFatSaturated, \.saturatedFatG, .gram()),
        (.dietaryFiber, \.fiberG, .gram()),
        (.dietarySugar, \.sugarG, .gram()),
        (.dietarySodium, \.sodiumMg, .gramUnit(with: .milli)),
    ]

    /// What's asked for: the nutrients. The food entry holding them needs no
    /// permission of its own (asking for it throws).
    private static var shareTypes: [HKQuantityType] {
        types.compactMap { HKQuantityType.quantityType(forIdentifier: $0.0) }
    }

    /// Asks once, the first time it's useful: switching the setting on (and
    /// again before a write if a type is still undecided).
    func authorise() async -> Bool {
        guard Self.available else { return false }
        do {
            try await store.requestAuthorization(toShare: Set(Self.shareTypes), read: [])
            return true
        } catch {
            Self.log.error("Health authorisation failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    /// Writes (or rewrites) the cook's entry when it applies; otherwise
    /// removes any it had, so unticking yourself on an edit takes it out.
    func record(cookId: String, recipe: Recipe, cookedFor: [String], at date: Date, portion: Double) async {
        await remove(cookId: cookId)
        guard applies(to: cookedFor), recipe.hasNutrition, recipe.nutritionSource != "none" else { return }
        // Undecided again (Health reset, or a type added since): ask before writing.
        if Self.shareTypes.contains(where: { store.authorizationStatus(for: $0) == .notDetermined }) { _ = await authorise() }
        let samples: [HKQuantitySample] = Self.types.compactMap { id, path, unit in
            guard let value = recipe[keyPath: path], value > 0, let type = HKQuantityType.quantityType(forIdentifier: id) else { return nil }
            return HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: value * portion), start: date, end: date)
        }
        guard !samples.isEmpty else { return }
        let food = HKCorrelation(type: HKCorrelationType(.food), start: date, end: date, objects: Set(samples),
                                 metadata: [HKMetadataKeyFoodType: recipe.title, "DishesCookId": cookId])
        do {
            try await store.save(food)
            saved[cookId] = Saved(ids: ([food] + samples).map(\.uuid.uuidString), portion: portion)
        } catch {
            // Not allowed (turned off in Health), or Health unavailable: nothing to keep.
            Self.log.error("Health save failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func remove(cookId: String) async {
        guard let entry = saved[cookId] else { return }
        let ids = Set(entry.ids.compactMap(UUID.init(uuidString:)))
        let predicate = HKQuery.predicateForObjects(with: ids)
        for type in [HKCorrelationType(.food) as HKObjectType] + Self.types.compactMap({ HKQuantityType.quantityType(forIdentifier: $0.0) }) {
            _ = try? await store.deleteObjects(of: type, predicate: predicate)
        }
        saved[cookId] = nil
    }

    /// The portion written for a cook, for its edit sheet.
    func portion(for cookId: String) -> Double? { saved[cookId]?.portion }

    // MARK: What was written

    struct Saved: Codable { var ids: [String]; var portion: Double }

    @ObservationIgnored private var saved: [String: Saved] {
        get { (UserDefaults.standard.data(forKey: "health.saved")).flatMap { try? JSONDecoder().decode([String: Saved].self, from: $0) } ?? [:] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "health.saved") }
    }
}
