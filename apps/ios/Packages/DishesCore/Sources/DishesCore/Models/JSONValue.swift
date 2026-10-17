// Any JSON value. Sync records are whole server rows, so the store keeps them
// as JSON and the typed models (Entities.swift) read the fields they need —
// a column the server adds later is kept, not dropped. Also used to build
// mutation payloads and to compare against the shared fixtures.
//
//   let value = try JSONValue(encoding: item)          // a model as JSON
//   value["ingredientName"]                            // .string("Milk")
//   value.contains(expected)                           // partial match, as Vitest's toMatchObject

import Foundation

public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    /// Any Encodable value as JSON (what it would look like on the wire).
    public init<T: Encodable>(encoding value: T) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }

    /// Turns this JSON into a model.
    public func decode<T: Decodable>(as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    /// A shallow merge: `other`'s keys over this object's (as `{ ...a, ...b }`).
    public func merging(_ other: JSONValue) -> JSONValue {
        guard case .object(var a) = self, case .object(let b) = other else { return other }
        for (k, v) in b { a[k] = v }
        return .object(a)
    }

    /// Does this value contain `expected`? Objects match when every expected key
    /// matches (a missing key counts as null); arrays need the same length with
    /// each element matching — the rules of Vitest's `toMatchObject`.
    public func contains(_ expected: JSONValue) -> Bool {
        switch (self, expected) {
        case (.object(let a), .object(let b)):
            return b.allSatisfy { key, want in (a[key] ?? .null).contains(want) }
        case (.array(let a), .array(let b)):
            return a.count == b.count && zip(a, b).allSatisfy { $0.contains($1) }
        default:
            return self == expected
        }
    }
}
