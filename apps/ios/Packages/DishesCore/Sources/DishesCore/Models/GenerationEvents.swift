// What the server says while the AI works, line by line (NDJSON), so a wait
// can show real progress: the week planner's facts and photos and each meal
// as it's written, each idea as it's written, how far a recipe has got.
// The shapes are lib/ai/job-types.ts on the web. Kinds a newer server sends
// that this build doesn't know decode as `.unknown` and are ignored.

import Foundation

/// A recipe being written: the part the AI is on (ingredients, then the
/// method, then nutrition — the schema's own order), the ingredients named so
/// far and how many steps. `grounding` is reading real recipes first;
/// `revising` is the heart-healthy second pass.
public struct RecipeProgress: Decodable, Hashable, Sendable {
    public enum Stage: String, Decodable, Sendable { case grounding, ingredients, method, nutrition }
    public var stage: Stage
    public var ingredients: [String]
    public var steps: Int
    public var revising: Bool?

    public init(stage: Stage, ingredients: [String] = [], steps: Int = 0, revising: Bool? = nil) {
        self.stage = stage; self.ingredients = ingredients; self.steps = steps; self.revising = revising
    }

    /// How far through the recipe it is, 0–1, from the part it's on.
    public var fraction: Double {
        switch stage {
        case .grounding: 0.1
        case .ingredients: 0.15 + Double(min(ingredients.count, 12)) * 0.015
        case .method: 0.4 + Double(min(steps, 10)) * 0.04
        case .nutrition: 0.9
        }
    }

    /// In a few words: "Method · step 3".
    public var label: String {
        let label = switch stage {
        case .grounding: "Reading real recipes for reference"
        case .ingredients: ingredients.isEmpty ? "Starting on the ingredients" : "Ingredients · \(ingredients.count) so far"
        case .method: steps > 0 ? "Method · step \(steps)" : "Starting on the method"
        case .nutrition: "Working out the nutrition"
        }
        return revising == true ? "\(label) (second pass, for heart-healthy)" : label
    }
}

private enum EventKeys: String, CodingKey {
    case type, facts, photos, slot, slots, message, concept, concepts, recipeId, title, collectionName, index, progress
}

/// `POST /ai/meal-plan`, streamed.
public enum PlanEvent: Decodable, Sendable, Equatable {
    /// What the planner is weighing (all true, from the household's data) and library photos for the wait.
    case facts([String], photos: [String])
    /// A meal, the moment the AI has written it.
    case slot(APIClient.PlanSlot)
    case done([APIClient.PlanSlot])
    case error(String)
    case unknown

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: EventKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "facts": self = .facts(try c.decode([String].self, forKey: .facts), photos: try c.decodeIfPresent([String].self, forKey: .photos) ?? [])
        case "slot": self = .slot(try c.decode(APIClient.PlanSlot.self, forKey: .slot))
        case "done": self = .done(try c.decode([APIClient.PlanSlot].self, forKey: .slots))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown
        }
    }
}

/// `POST /ai/recipes`, streamed.
public enum RecipeEvent: Decodable, Sendable, Equatable {
    case progress(RecipeProgress)
    case done(APIClient.CreatedRecipe)
    case error(String)
    case unknown

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: EventKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "progress": self = .progress(try RecipeProgress(from: decoder))
        case "done": self = .done(try APIClient.CreatedRecipe(from: decoder))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown
        }
    }
}

/// `POST /ai/concepts`, streamed.
public enum ConceptsEvent: Decodable, Sendable, Equatable {
    case concept(APIClient.Concept)
    case done([APIClient.Concept])
    case error(String)
    case unknown

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: EventKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "concept": self = .concept(try c.decode(APIClient.Concept.self, forKey: .concept))
        case "done": self = .done(try c.decode([APIClient.Concept].self, forKey: .concepts))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown
        }
    }
}

/// `POST /ai/meal-plan/apply`, streamed: each new idea written out as a recipe,
/// by its index in the slots sent.
public enum PlanApplyEvent: Decodable, Sendable, Equatable {
    case writing(index: Int, progress: RecipeProgress?)
    case written(index: Int, recipeId: String)
    case failed(index: Int)
    case done
    case error(String)
    case unknown

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: EventKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "writing": self = .writing(index: try c.decode(Int.self, forKey: .index),
                                        progress: try c.decodeIfPresent(RecipeProgress.self, forKey: .progress))
        case "written": self = .written(index: try c.decode(Int.self, forKey: .index), recipeId: try c.decode(String.self, forKey: .recipeId))
        case "failed": self = .failed(index: try c.decode(Int.self, forKey: .index))
        case "done": self = .done
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown
        }
    }
}
