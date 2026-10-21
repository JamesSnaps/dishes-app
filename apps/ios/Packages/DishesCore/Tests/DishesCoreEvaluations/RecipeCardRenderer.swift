// Prints a recipe as a cookbook page or a recipe card, so the scan evaluation
// has photos with known answers: twenty styles across body fonts (handwriting
// ones included), one or two columns, a slight tilt and a paper tint. Not a
// substitute for real photos — fixtures/evals/recipe-photos/ takes those — but
// it exercises Vision, the layouts and the model the same way.

import CoreGraphics
import CoreText
import Foundation
@testable import DishesCore

struct CardStyle: CustomStringConvertible {
    enum Layout: String { case page, twoColumn, card }
    var font: String
    var layout: Layout
    var tilt: Double
    var paper: (CGFloat, CGFloat, CGFloat)

    var description: String { "\(layout.rawValue), \(font)\(tilt == 0 ? "" : ", tilted")" }

    static let cream = (CGFloat(0.98), CGFloat(0.96), CGFloat(0.90))
    static let white = (CGFloat(1), CGFloat(1), CGFloat(1))
    static let grey = (CGFloat(0.93), CGFloat(0.93), CGFloat(0.92))

    /// The twenty styles, in the order the samples use them.
    static let all: [CardStyle] = [
        .init(font: "Georgia", layout: .page, tilt: 0, paper: white),
        .init(font: "Helvetica Neue", layout: .twoColumn, tilt: 0, paper: white),
        .init(font: "Avenir Next", layout: .card, tilt: 0, paper: cream),
        .init(font: "Noteworthy", layout: .card, tilt: 1.2, paper: cream),
        .init(font: "Times New Roman", layout: .page, tilt: -1, paper: grey),
        .init(font: "Georgia", layout: .twoColumn, tilt: 0.8, paper: cream),
        .init(font: "Bradley Hand", layout: .card, tilt: -1.5, paper: white),
        .init(font: "Helvetica Neue", layout: .page, tilt: 0, paper: cream),
        .init(font: "Avenir Next", layout: .twoColumn, tilt: -0.6, paper: grey),
        .init(font: "Courier New", layout: .page, tilt: 0, paper: white),
        .init(font: "Noteworthy", layout: .page, tilt: 0.5, paper: white),
        .init(font: "Georgia", layout: .card, tilt: 0, paper: grey),
        .init(font: "Times New Roman", layout: .twoColumn, tilt: 0, paper: cream),
        .init(font: "Bradley Hand", layout: .page, tilt: 1, paper: cream),
        .init(font: "Helvetica Neue", layout: .card, tilt: -0.8, paper: white),
        .init(font: "Avenir Next", layout: .page, tilt: 1.5, paper: white),
        .init(font: "Courier New", layout: .twoColumn, tilt: 0, paper: grey),
        .init(font: "Noteworthy", layout: .twoColumn, tilt: -1, paper: cream),
        .init(font: "Georgia", layout: .page, tilt: -1.2, paper: cream),
        .init(font: "Bradley Hand", layout: .twoColumn, tilt: 0.6, paper: white),
    ]
}

enum RecipeCardRenderer {
    /// "250g plain flour, sifted" — the way a cookbook prints a row.
    static func line(_ i: GeneratedRecipe.Ingredient) -> String {
        let shortUnits: Set<String> = ["g", "kg", "ml", "l"]
        let quantity = i.unit.isEmpty ? i.amount
            : shortUnits.contains(i.unit) ? i.amount + i.unit : "\(i.amount) \(i.unit)"
        var out = [quantity, i.ingredientName].filter { !$0.isEmpty }.joined(separator: " ")
        if !i.preparation.isEmpty { out += ", \(i.preparation)" }
        if i.isOptional { out += " (optional)" }
        return out
    }

    static func render(_ recipe: GeneratedRecipe, style: CardStyle) -> CGImage {
        let size = style.layout == .card ? CGSize(width: 1800, height: 1300) : CGSize(width: 1500, height: 2000)
        let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
                                bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(red: 0.35, green: 0.33, blue: 0.3, alpha: 1)   // the table under the page
        context.fill(CGRect(origin: .zero, size: size))
        context.translateBy(x: size.width / 2, y: size.height / 2)
        context.rotate(by: style.tilt * .pi / 180)
        context.translateBy(x: -size.width / 2, y: -size.height / 2)
        let paper = CGRect(origin: .zero, size: size).insetBy(dx: 40, dy: 40)
        context.setFillColor(red: style.paper.0, green: style.paper.1, blue: style.paper.2, alpha: 1)
        context.fill(paper)
        if style.layout == .card {
            context.setStrokeColor(red: 0.75, green: 0.3, blue: 0.25, alpha: 1)
            context.setLineWidth(4)
            context.stroke(paper.insetBy(dx: 24, dy: 24))
        }

        let body: CGFloat = style.layout == .card ? 30 : 32
        let text = paper.insetBy(dx: 90, dy: 90)
        let head = NSMutableAttributedString()
        head.append(styled(recipe.title + "\n", style.font, body * 1.8, bold: true))
        if !recipe.description.isEmpty { head.append(styled(recipe.description + "\n", style.font, body * 0.9)) }
        var facts = ["Serves \(recipe.servings)"]
        if let prep = recipe.prepTimeMinutes { facts.append("Prep \(prep) min") }
        if let cook = recipe.cookTimeMinutes { facts.append("Cook \(cook) min") }
        head.append(styled(facts.joined(separator: "  ·  ") + "\n\n", style.font, body * 0.85))

        let ingredients = NSMutableAttributedString(attributedString: styled("Ingredients\n", style.font, body * 1.15, bold: true))
        var group = ""
        for i in recipe.ingredients {
            if i.groupLabel != group, !i.groupLabel.isEmpty {
                ingredients.append(styled(i.groupLabel + ":\n", style.font, body, bold: true))
            }
            group = i.groupLabel
            ingredients.append(styled(line(i) + "\n", style.font, body))
        }
        let method = NSMutableAttributedString(attributedString: styled("\nMethod\n", style.font, body * 1.15, bold: true))
        for (n, step) in recipe.steps.enumerated() {
            method.append(styled("\(n + 1). \(step.instruction)\n", style.font, body))
        }

        let headHeight = height(of: head, width: text.width)
        let headRect = CGRect(x: text.minX, y: text.maxY - headHeight, width: text.width, height: headHeight)
        draw(head, in: headRect, context)
        let below = CGRect(x: text.minX, y: text.minY, width: text.width, height: text.height - headHeight)
        if style.layout == .page {
            let all = NSMutableAttributedString(attributedString: ingredients)
            all.append(method)
            draw(all, in: below, context)
        } else {
            let left = below.width * 0.36
            draw(ingredients, in: CGRect(x: below.minX, y: below.minY, width: left - 30, height: below.height), context)
            method.deleteCharacters(in: NSRange(location: 0, length: 1))   // no blank line above "Method" in its own column
            draw(method, in: CGRect(x: below.minX + left + 30, y: below.minY, width: below.width - left - 30, height: below.height), context)
        }
        return context.makeImage()!
    }

    static func styled(_ s: String, _ font: String, _ size: CGFloat, bold: Bool = false) -> NSAttributedString {
        var ctFont = CTFontCreateWithName(font as CFString, size, nil)
        if bold, let b = CTFontCreateCopyWithSymbolicTraits(ctFont, size, nil, .traitBold, .traitBold) { ctFont = b }
        return NSAttributedString(string: s, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): ctFont,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0.12, green: 0.1, blue: 0.08, alpha: 1),
        ])
    }

    static func height(of s: NSAttributedString, width: CGFloat) -> CGFloat {
        let setter = CTFramesetterCreateWithAttributedString(s)
        return ceil(CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(), nil, CGSize(width: width, height: .greatestFiniteMagnitude), nil).height)
    }

    static func draw(_ s: NSAttributedString, in rect: CGRect, _ context: CGContext) {
        let setter = CTFramesetterCreateWithAttributedString(s)
        let frame = CTFramesetterCreateFrame(setter, CFRange(), CGPath(rect: rect, transform: nil), nil)
        CTFrameDraw(frame, context)
    }
}
