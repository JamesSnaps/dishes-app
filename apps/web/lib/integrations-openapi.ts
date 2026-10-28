import {
  COMMON_ERRORS,
  INTEGRATION_ENDPOINTS,
  OPERATION_SETS,
  SCOPE_DESCRIPTIONS,
  type EndpointDoc,
} from "@/lib/integrations-catalog";
import { APP_VERSION } from "@/lib/version";

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string", description: "Human-readable message." } },
};

function operation(ep: EndpointDoc, short: boolean) {
  const responses: Record<string, unknown> = {
    [String(ep.response.status)]: {
      description: ep.response.description,
      content: { "application/json": { example: ep.response.example } },
    },
  };
  for (const err of [...(ep.errors ?? []), ...COMMON_ERRORS]) {
    responses[String(err.status)] = {
      description: err.description,
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }

  return {
    operationId: ep.id,
    summary: ep.summary,
    // A trimmed spec keeps to the short text; the scope is still in x-required-scope.
    description: short
      ? (ep.shortDescription ?? ep.description)
      : ep.scope
        ? `${ep.description}\n\nRequired token scope: \`${ep.scope}\`.`
        : `${ep.description}\n\nAny valid token, whatever its scopes.`,
    ...(ep.scope ? { "x-required-scope": ep.scope } : {}),
    parameters: ep.params?.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
      schema: p.schema,
    })),
    requestBody: ep.body && {
      required: true,
      content: { "application/json": { schema: ep.body.schema, example: ep.body.example } },
    },
    responses,
  };
}

/**
 * OpenAPI 3.1 document for the Integrations API, built from the catalog — the
 * whole API, or one of the trimmed `OPERATION_SETS` by name (an unknown name
 * throws `RangeError`).
 */
export function buildIntegrationsOpenApi(origin: string, setName?: string) {
  const set = setName === undefined ? null : OPERATION_SETS[setName];
  if (set === undefined) throw new RangeError(`Unknown operation set: ${setName}`);

  const paths: Record<string, Record<string, unknown>> = {};
  for (const ep of INTEGRATION_ENDPOINTS) {
    if (set && !set.ids.includes(ep.id)) continue;
    paths[ep.path] ??= {};
    paths[ep.path]![ep.method.toLowerCase()] = operation(ep, !!set);
  }

  const scopeList = Object.entries(SCOPE_DESCRIPTIONS)
    .map(([scope, desc]) => `- \`${scope}\` — ${desc}`)
    .join("\n");

  return {
    openapi: "3.1.0",
    info: {
      title: set?.title ?? "Dishes Integrations API",
      version: APP_VERSION,
      description: set?.description ?? [
        "Household meal plan, recipe and shopping list access for automations and AI assistants.",
        "",
        "Authenticate with `Authorization: Bearer <token>`. Tokens are created by a household admin at Settings → Integrations and carry scopes:",
        scopeList,
        "",
        "Typical flow for \"what's for dinner and how do I make it?\": call getToday (or getWeekMealPlan), then getRecipe with the meal's recipe.id.",
        "",
        "Rate limit: 100 requests per minute per token.",
      ].join("\n"),
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Household integration token." },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    paths,
  };
}
