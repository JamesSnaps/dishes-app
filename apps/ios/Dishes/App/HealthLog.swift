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
//
// Meals eaten out go in too, written from the device that logged them (as a
// cook is): their figures are the server's estimate, which often arrives by
// sync after the sheet has closed, so `reconcileOutside` writes — or rewrites,
// when the estimate changes — after each sync.
//
//   HealthLog.shared.loggedHere(meal.id)
//   await HealthLog.shared.reconcileOutside(meals)

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

    /// The eight nutrients, in the order `figures` gives them.
    private static let types: [(HKQuantityTypeIdentifier, HKUnit)] = [
        (.dietaryEnergyConsumed, .kilocalorie()),
        (.dietaryProtein, .gram()),
        (.dietaryCarbohydrates, .gram()),
        (.dietaryFatTotal, .gram()),
        (.dietaryFatSaturated, .gram()),
        (.dietaryFiber, .gram()),
        (.dietarySugar, .gram()),
        (.dietarySodium, .gramUnit(with: .milli)),
    ]

    /// A recipe's figures (per serving), in `types` order.
    static func figures(_ r: Recipe) -> [Double?] {
        [r.calories, r.proteinG, r.carbsG, r.fatG, r.saturatedFatG, r.fiberG, r.sugarG, r.sodiumMg]
    }

    /// A meal out's figures (the whole portion eaten), in `types` order.
    static func figures(_ m: OutsideMeal) -> [Double?] {
        [m.calories, m.proteinG, m.carbsG, m.fatG, m.saturatedFatG, m.fiberG, m.sugarG, m.sodiumMg]
    }

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
        await write(key: cookId, title: recipe.title, figures: Self.figures(recipe), at: date, portion: portion,
                    metadata: ["DishesCookId": cookId])
    }

    func remove(cookId: String) async { await remove(key: cookId) }

    /// One food entry: the figures (times the portion) as samples inside it.
    private func write(key: String, title: String, figures: [Double?], at date: Date, portion: Double,
                       metadata: [String: Any], stamp: String? = nil) async {
        // Undecided again (Health reset, or a type added since): ask before writing.
        if Self.shareTypes.contains(where: { store.authorizationStatus(for: $0) == .notDetermined }) { _ = await authorise() }
        let samples: [HKQuantitySample] = zip(Self.types, figures).compactMap { type, value in
            guard let value, value > 0, let quantityType = HKQuantityType.quantityType(forIdentifier: type.0) else { return nil }
            return HKQuantitySample(type: quantityType, quantity: HKQuantity(unit: type.1, doubleValue: value * portion), start: date, end: date)
        }
        guard !samples.isEmpty else { return }
        var meta = metadata
        meta[HKMetadataKeyFoodType] = title
        let food = HKCorrelation(type: HKCorrelationType(.food), start: date, end: date, objects: Set(samples), metadata: meta)
        do {
            try await store.save(food)
            saved[key] = Saved(ids: ([food] + samples).map(\.uuid.uuidString), portion: portion, stamp: stamp)
        } catch {
            // Not allowed (turned off in Health), or Health unavailable: nothing to keep.
            Self.log.error("Health save failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func remove(key: String) async {
        guard let entry = saved[key] else { return }
        let ids = Set(entry.ids.compactMap(UUID.init(uuidString:)))
        let predicate = HKQuery.predicateForObjects(with: ids)
        for type in [HKCorrelationType(.food) as HKObjectType] + Self.types.compactMap({ HKQuantityType.quantityType(forIdentifier: $0.0) }) {
            _ = try? await store.deleteObjects(of: type, predicate: predicate)
        }
        saved[key] = nil
    }

    // MARK: Meals eaten out

    /// A meal out was logged (or edited) on this device: its entry is this
    /// device's to write. Only here — a second device with the same eater
    /// would write it twice.
    func loggedHere(_ mealId: String) {
        var here = outsideHere
        here.insert(mealId)
        outsideHere = here
    }

    /// Removed on this device: its entry goes too.
    func forgetOutside(_ mealId: String) async {
        await remove(key: Self.outsideKey(mealId))
        var here = outsideHere
        here.remove(mealId)
        outsideHere = here
    }

    /// After a sync: each meal out logged here gets the entry its figures call
    /// for now — written once the estimate arrives, rewritten if it changes,
    /// taken out if this device's person is no longer among who ate it. A meal
    /// missing from `meals` is left alone: the store may be mid-snapshot, and a
    /// meal removed on this device was taken out by `forgetOutside` already.
    func reconcileOutside(_ meals: [OutsideMeal]) async {
        guard Self.available else { return }
        let byId = Dictionary(meals.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for id in outsideHere {
            guard let meal = byId[id] else { continue }
            let key = Self.outsideKey(id)
            let wanted = enabled && meal.countsAsMeal && meal.hasNutrition && appliesOutside(meal)
            let stamp = Self.stamp(meal)
            if wanted, saved[key]?.stamp == stamp { continue }
            await remove(key: key)
            guard wanted, let at = Self.when(meal) else { continue }
            await write(key: key, title: meal.label, figures: Self.figures(meal), at: at, portion: 1,
                        metadata: ["DishesOutsideMealId": id], stamp: stamp)
        }
    }

    /// Nobody named means everyone ate it.
    private func appliesOutside(_ meal: OutsideMeal) -> Bool {
        meal.eatenBy.isEmpty ? (Self.available && enabled && eater != nil) : applies(to: meal.eatenBy)
    }

    private static func outsideKey(_ id: String) -> String { "outside:" + id }

    /// What the entry was written from: a different stamp means rewrite it.
    private static func stamp(_ meal: OutsideMeal) -> String {
        ([meal.date, meal.mealType] + figures(meal).map { $0.map { String($0) } ?? "-" } + meal.eatenBy.sorted())
            .joined(separator: "|")
    }

    /// The meal's date at a usual hour for its type — Health wants a time,
    /// and the day is all that was logged.
    private static func when(_ meal: OutsideMeal) -> Date? {
        let hour = ["breakfast": 8, "lunch": 13, "snack": 16, "dinner": 19, "dessert": 20][meal.mealType] ?? 19
        let parts = meal.date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: hour))
    }

    @ObservationIgnored private var outsideHere: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "health.outsideHere") ?? []) }
        set { UserDefaults.standard.set(newValue.sorted(), forKey: "health.outsideHere") }
    }

    /// The portion written for a cook, for its edit sheet.
    func portion(for cookId: String) -> Double? { saved[cookId]?.portion }

    // MARK: What was written

    /// `stamp`: for a meal out, what it was written from (nil for a cook).
    struct Saved: Codable { var ids: [String]; var portion: Double; var stamp: String? = nil }

    @ObservationIgnored private var saved: [String: Saved] {
        get { (UserDefaults.standard.data(forKey: "health.saved")).flatMap { try? JSONDecoder().decode([String: Saved].self, from: $0) } ?? [:] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "health.saved") }
    }
}
