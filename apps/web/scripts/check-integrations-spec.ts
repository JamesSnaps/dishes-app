/**
 * Checks the trimmed OpenAPI specs (`openapi.json?ops=…`) stay importable as
 * ChatGPT Actions — every operation's description and the spec's own at most
 * 300 characters — and serve exactly the operations their set names. Also
 * that the menu assistant's instructions only name operations its spec has
 * and fit a custom GPT's 8,000-character Instructions box.
 *
 * Usage (from apps/web): npx tsx scripts/check-integrations-spec.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { INTEGRATION_ENDPOINTS, OPERATION_SETS } from "../lib/integrations-catalog";
import { buildIntegrationsOpenApi } from "../lib/integrations-openapi";
import { MENU_ASSISTANT_INSTRUCTIONS } from "../lib/menu-assistant";

const GPT_DESCRIPTION_MAX = 300;
const ids = new Set(INTEGRATION_ENDPOINTS.map((e) => e.id));

for (const [name, set] of Object.entries(OPERATION_SETS)) {
  assert.ok(set.description.length <= GPT_DESCRIPTION_MAX, `${name}: spec description is ${set.description.length} chars`);
  for (const id of set.ids) {
    assert.ok(ids.has(id), `${name}: no endpoint ${id}`);
    const ep = INTEGRATION_ENDPOINTS.find((e) => e.id === id)!;
    assert.ok(ep.shortDescription, `${name}: ${id} needs a shortDescription`);
    assert.ok(
      ep.shortDescription.length <= GPT_DESCRIPTION_MAX,
      `${name}: ${id} shortDescription is ${ep.shortDescription.length} chars`
    );
  }

  const spec = buildIntegrationsOpenApi("https://dishes.example.com", name);
  const served = Object.values(spec.paths).flatMap((methods) =>
    Object.values(methods).map((op) => (op as { operationId: string; description: string }))
  );
  assert.deepEqual(served.map((op) => op.operationId).sort(), [...set.ids].sort(), `${name}: serves its set exactly`);
  for (const op of served) {
    assert.ok(op.description.length <= GPT_DESCRIPTION_MAX, `${name}: ${op.operationId} served description too long`);
  }
}

assert.throws(() => buildIntegrationsOpenApi("https://dishes.example.com", "nope"), RangeError);
const full = buildIntegrationsOpenApi("https://dishes.example.com");
assert.equal(
  Object.values(full.paths).reduce((n, methods) => n + Object.keys(methods).length, 0),
  INTEGRATION_ENDPOINTS.length,
  "the full spec still has every endpoint"
);

// The instructions name operations; each must be in the spec the GPT imports.
const mealsOut = new Set(OPERATION_SETS["meals-out"]!.ids);
const named = MENU_ASSISTANT_INSTRUCTIONS.match(/\b(get|list|log|update)[A-Z]\w+/g) ?? [];
assert.ok(named.length > 0);
for (const op of named) assert.ok(mealsOut.has(op), `instructions name ${op}, which ?ops=meals-out doesn't serve`);
assert.ok(MENU_ASSISTANT_INSTRUCTIONS.length <= 8000, "fits a custom GPT's Instructions");

console.log("integrations spec checks passed");
