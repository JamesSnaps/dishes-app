/**
 * The Dishes MCP server, for Claude (Desktop, Code, or a claude.ai custom
 * connector): the eating-out tools — the diner brief, and logging what was
 * ordered as a meal out. Served statelessly by `/api/integrations/mcp`, one
 * server per request, built for whoever called.
 *
 * Tools are named after the integration API's operation ids and described
 * with the catalog's short descriptions, so `MENU_ASSISTANT_INSTRUCTIONS`
 * works unchanged for ChatGPT and Claude. A tool the caller can't use (a
 * missing scope, or a write with no member to file it under) isn't offered.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import { APP_VERSION } from "@/lib/version";
import { INTEGRATION_ENDPOINTS } from "@/lib/integrations-catalog";
import { MENU_ASSISTANT_INSTRUCTIONS } from "@/lib/menu-assistant";
import { renderDinerBrief } from "@/lib/diner-brief";
import { getDinerBrief, UnknownDinerError } from "@/lib/services/diner-brief";
import { householdClock } from "@/lib/integration-meal-times";
import { addDaysToDate } from "@/lib/dinner-reminders/time";
import {
  getOutsideMeal,
  listOutsideMeals,
  OutsideMealNotFoundError,
  OutsideMealValidationError,
} from "@/lib/services/outside-meals";
import {
  editMealOut,
  editOutsideMealSchema,
  logMealOut,
  outsideMealDetailJson,
  outsideMealWriteFields,
  UnknownEaterError,
} from "@/lib/integration-outside-meals";

/** Who's calling: a token's household and scopes, or a signed-in member. */
export type McpCaller = {
  householdId: string;
  /** Writes are filed under this member; null offers no write tools. */
  memberId: string | null;
  scopes: readonly string[];
  /** For the meals' links into the app. */
  origin: string;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const optionalFields = z.object(outsideMealWriteFields).partial().shape;

function describe(id: string): string {
  const ep = INTEGRATION_ENDPOINTS.find((e) => e.id === id);
  return ep?.shortDescription ?? ep?.description ?? id;
}

const json = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** What a tool says for a mistake the model can fix; anything else is thrown. */
function toolError(err: unknown): CallToolResult {
  if (err instanceof ZodError) {
    const text = err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
    return { isError: true, content: [{ type: "text", text }] };
  }
  if (
    err instanceof UnknownDinerError ||
    err instanceof UnknownEaterError ||
    err instanceof OutsideMealValidationError ||
    err instanceof OutsideMealNotFoundError
  ) {
    const text = err instanceof OutsideMealNotFoundError ? "No meal out with that id in this household." : err.message;
    return { isError: true, content: [{ type: "text", text }] };
  }
  throw err;
}

async function attempt(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return toolError(err);
  }
}

export function buildDishesMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: "dishes", title: "Dishes", version: APP_VERSION },
    { instructions: MENU_ASSISTANT_INSTRUCTIONS }
  );
  const can = (scope: string) => caller.scopes.includes(scope);
  const today = async () => (await householdClock(caller.householdId)).today;

  if (can("read:preferences")) {
    server.registerTool(
      "getDinerBrief",
      {
        title: "Diner brief",
        description: describe("getDinerBrief"),
        inputSchema: {
          members: z
            .array(z.string())
            .optional()
            .describe("Who's eating: display names, any case. Leave out for everyone."),
          date: date.optional().describe("The day of the meal, YYYY-MM-DD. Leave out for today."),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ members, date: day }) =>
        attempt(async () => {
          const brief = await getDinerBrief(caller.householdId, { date: day ?? (await today()), diners: members ?? [] });
          return { content: [{ type: "text", text: renderDinerBrief(brief) }] };
        })
    );
  }

  if (can("read:meal_plan")) {
    server.registerTool(
      "listOutsideMeals",
      {
        title: "Meals out",
        description: describe("listOutsideMeals"),
        inputSchema: {
          from: date.optional().describe("First day, inclusive. Defaults to this week's Monday."),
          to: date.optional().describe("Last day, inclusive. Defaults to this week's Sunday."),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ from, to }) =>
        attempt(async () => {
          const clock = await householdClock(caller.householdId);
          const range = { from: from ?? clock.weekStartDate, to: to ?? addDaysToDate(clock.weekStartDate, 6) };
          const meals = await listOutsideMeals(caller.householdId, range);
          return json({ ...range, meals: meals.map((m) => outsideMealDetailJson(m, caller.origin)) });
        })
    );

    server.registerTool(
      "getOutsideMeal",
      {
        title: "One meal out",
        description: describe("getOutsideMeal"),
        inputSchema: { id: z.string().uuid().describe("The meal's id.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ id }) =>
        attempt(async () => json(outsideMealDetailJson(await getOutsideMeal(caller, id), caller.origin)))
    );
  }

  const memberId = caller.memberId;
  if (can("write:outside_meals") && memberId) {
    const actor = { householdId: caller.householdId, memberId };

    server.registerTool(
      "logOutsideMeal",
      {
        title: "Log a meal out",
        description: describe("logOutsideMeal"),
        inputSchema: { ...optionalFields, date: date.optional().describe("YYYY-MM-DD. Leave out for today.") },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      (args) =>
        attempt(async () => {
          const { action, meal } = await logMealOut(actor, { ...args, date: args.date ?? (await today()) });
          return json({ action, meal: outsideMealDetailJson(meal, caller.origin) });
        })
    );

    server.registerTool(
      "updateOutsideMeal",
      {
        title: "Update a meal out",
        description: describe("updateOutsideMeal"),
        inputSchema: { id: z.string().uuid().describe("The meal's id."), ...optionalFields },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ id, ...fields }) =>
        attempt(async () => {
          const meal = await editMealOut(actor, id, editOutsideMealSchema.parse(fields));
          return json(outsideMealDetailJson(meal, caller.origin));
        })
    );
  }

  return server;
}
