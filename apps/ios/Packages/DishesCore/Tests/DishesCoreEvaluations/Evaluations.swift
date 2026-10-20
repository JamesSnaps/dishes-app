// The on-device AI's evaluations (TODO_MOBILE.md, Phase D2): a fixed set per
// job, scored against expected answers, deciding whether the job may start on
// the device (Gate). Each run leaves its record in fixtures/evals/results/.
// Re-run after each iOS point release.
//
//   cd apps/ios/Packages/DishesCore
//   DISHES_EVALS=1 swift test --filter DishesCoreEvaluations
//
// macOS 27 with Apple Intelligence on: the Mac runs the same on-device model
// as the iPad (check `DeviceAI.modelDescription` matches the devices').

import CoreGraphics
import Evaluations
import ImageIO
import Foundation
import Testing
@testable import DishesCore

enum IngredientEval {
    struct Parts: Codable, Sendable, Hashable {
        var amount: String
        var unit: String
        var name: String
        var preparation: String
    }
}

/// What each sample did, beside the framework's metrics: the gate and the record need it.
actor Recorder {
    var samples: [EvalRecord.Sample] = []
    func add(_ s: EvalRecord.Sample) { samples.append(s) }
}

// MARK: Ingredient lines

@available(macOS 27, iOS 27, *)
struct IngredientLineEvaluation: Evaluation {
    let fixtures: [String: IngredientLineFixture]
    let recorder: Recorder
    let score = Metric("score")
    let structure = Metric("structure")

    var dataset: ArrayLoader<ModelSample<IngredientEval.Parts>> {
        ArrayLoader(samples: fixtures.values.sorted { $0.line < $1.line }.map {
            ModelSample(prompt: $0.line, expected: IngredientEval.Parts(amount: $0.expected.amount, unit: $0.expected.unit,
                                                                         name: $0.expected.name, preparation: $0.expected.preparation))
        })
    }

    func subject(from sample: ModelSample<IngredientEval.Parts>) async throws -> ModelSubject<IngredientEval.Parts> {
        let line = sample.promptDescription
        let start = Date()
        let run = await IngredientLineReader.read(line)
        let got = run?.value ?? GeneratedRecipe.Ingredient(ingredientName: "")
        let expected = sample.expected!
        let rules = IngredientRules.parse(line) ?? GeneratedRecipe.Ingredient(ingredientName: "")
        await recorder.add(.init(name: line, deviceScore: Score.line(got, expected), serverScore: Score.line(rules, expected),
                                 engine: run?.engine.rawValue ?? "none",
                                 problems: run?.engine == .device ? IngredientChecks.problems(got, line: line) : [],
                                 seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: IngredientEval.Parts(amount: got.amount, unit: got.unit, name: got.ingredientName,
                                                        preparation: got.preparation))
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<IngredientEval.Parts>> { sample, subject in
            let got = GeneratedRecipe.Ingredient(ingredientName: subject.value.name, amount: subject.value.amount,
                                                 unit: subject.value.unit, preparation: subject.value.preparation)
            return score.scoring(Score.line(got, sample.expected!))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
        aggregator.computeMean(of: score)
    }
}

// MARK: Recipe cards

@available(macOS 27, iOS 27, *)
struct RecipeScanEvaluation: Evaluation {
    struct Card: Sendable {
        var name: String
        var image: CGImage
        var expected: GeneratedRecipe
    }

    let cards: [String: Card]
    let context: AIContext
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<GeneratedRecipe>> {
        ArrayLoader(samples: cards.keys.sorted().map { ModelSample(prompt: $0, expected: cards[$0]!.expected) })
    }

    func subject(from sample: ModelSample<GeneratedRecipe>) async throws -> ModelSubject<GeneratedRecipe> {
        let card = cards[sample.promptDescription]!
        let start = Date()
        var problems: [String]
        var got = GeneratedRecipe(title: "", ingredients: [], steps: [])
        do {
            let reading = try await RecipeReader.read([card.image], context: context)
            got = reading.recipe
            problems = RecipeChecks.problems(got, metric: context.measurementSystem == "metric", pageText: reading.pageText)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        await recorder.add(.init(name: card.name, deviceScore: Score.recipe(got, card.expected), serverScore: nil,
                                 engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: got)
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<GeneratedRecipe>> { sample, subject in
            score.scoring(Score.recipe(subject.value, sample.expected!))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
        aggregator.computeMean(of: score)
    }

    /// The seed recipes in the twenty printed styles, then any real photos
    /// in fixtures/evals/recipe-photos (<name>.jpg + <name>.json).
    static func cards() throws -> [String: Card] {
        struct File: Decodable { var recipes: [GeneratedRecipe] }
        let recipes = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("evals/recipe-cards.json"))).recipes
        var out: [String: Card] = [:]
        for (n, style) in CardStyle.all.enumerated() {
            let recipe = recipes[n % recipes.count]
            let name = String(format: "%02d %@ (%@)", n + 1, recipe.title, style.description)
            out[name] = Card(name: name, image: RecipeCardRenderer.render(recipe, style: style), expected: recipe)
        }
        let photos = fixtureURL("evals/recipe-photos")
        for json in (try? FileManager.default.contentsOfDirectory(at: photos, includingPropertiesForKeys: nil)) ?? []
        where json.pathExtension == "json" {
            let jpg = json.deletingPathExtension().appendingPathExtension("jpg")
            guard let source = CGImageSourceCreateWithURL(jpg as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
            let name = "photo " + json.deletingPathExtension().lastPathComponent
            out[name] = Card(name: name, image: image, expected: try JSONDecoder().decode(GeneratedRecipe.self, from: Data(contentsOf: json)))
        }
        return out
    }
}

// MARK: Running them

@Suite(.serialized, .enabled(if: evaluationsWanted, "DISHES_EVALS=1 to run the on-device AI's evaluations"))
struct AIEvaluations {
    @available(macOS 27, iOS 27, *)
    func record(_ job: AITask, _ recorder: Recorder, serverIs: String) async throws -> Gate {
        let samples = await recorder.samples.sorted { $0.name < $1.name }
        let structure = samples.filter(\.problems.isEmpty).count
        let device = samples.map(\.deviceScore).reduce(0, +) / Double(max(samples.count, 1))
        let servers = samples.compactMap(\.serverScore)
        let server = servers.count == samples.count && !samples.isEmpty ? servers.reduce(0, +) / Double(servers.count) : nil
        let gate = Gate(structurePassed: structure, samples: samples.count, deviceScore: device, serverScore: server)
        try EvalRecord(job: job.rawValue, date: Date(), model: DeviceAI.modelDescription ?? "unavailable", samples: samples.count,
                       structurePassed: structure, deviceScore: device, serverScore: server, serverIs: serverIs,
                       passes: gate.passes, perSample: samples).save()
        print("[eval] \(job.rawValue): \(gate.summary)")
        for s in samples where s.deviceScore < 0.75 || !s.problems.isEmpty {
            print(String(format: "[eval]   %.2f %@ %@", s.deviceScore, s.name, s.problems.joined(separator: "; ")))
        }
        return gate
    }

    @Test func ingredientLines() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let fixtures = Dictionary(try loadLines().map { ($0.line, $0) }, uniquingKeysWith: { a, _ in a })
        let recorder = Recorder()
        let result = try await IngredientLineEvaluation(fixtures: fixtures, recorder: recorder).run()
        print("[eval] ingredientLine framework mean: \(result.aggregateValue(.mean(of: Metric("score"))))")
        let gate = try await record(.ingredientLine, recorder, serverIs: "the rules (the server's paste import uses the same)")
        if AITask.ingredientLine.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func recipeCards() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let context = AIContext(configured: true, measurementSystem: "metric", defaultPrompt: nil, kitchenEquipment: nil,
                                webGrounding: false, members: [], tasteProfile: nil, collections: [])
        let recorder = Recorder()
        let result = try await RecipeScanEvaluation(cards: try RecipeScanEvaluation.cards(), context: context, recorder: recorder).run()
        print("[eval] scanRecipe framework mean: \(result.aggregateValue(.mean(of: Metric("score"))))")
        let gate = try await record(.scanRecipe, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.scanRecipe.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    /// DISHES_EVAL_CARDS=<folder>: the printed cards as PNGs, to look at.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["DISHES_EVAL_CARDS"] != nil))
    func writesTheCards() throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        let folder = URL(filePath: ProcessInfo.processInfo.environment["DISHES_EVAL_CARDS"]!)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for card in try RecipeScanEvaluation.cards().values {
            let url = folder.appending(path: card.name + ".png")
            let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, card.image, nil)
            CGImageDestinationFinalize(dest)
        }
    }

    func loadLines() throws -> [IngredientLineFixture] {
        struct File: Decodable { var lines: [IngredientLineFixture] }
        return try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("ingredient-lines.json"))).lines
    }
}

struct IngredientLineFixture: Decodable, Sendable {
    struct Parts: Decodable, Sendable { var amount: String; var unit: String; var name: String; var preparation: String }
    var line: String
    var expected: Parts
}
