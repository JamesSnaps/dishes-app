import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { ndjsonResponse, wantsNdjson } from "@/lib/api/ndjson";
import { generateConcepts } from "@/app/actions/ai";
import type { ConceptsEvent } from "@/lib/ai/job-types";
import { fromAction } from "../respond";

const schema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  memberIds: z.array(z.string().uuid()).optional(),
  mealType: z.string().max(20).optional(),
  heartHealthy: z.boolean().optional(),
  mealRole: z.enum(["main", "side", "sauce", "other"]).optional(),
});

/**
 * POST — step one of the recipe concierge: five ideas for what was asked for,
 * shaped by the household's taste profile and the chosen members' diets.
 * → `{ concepts: [{ title, description, cuisine, tags, difficulty }] }`
 *
 * With `Accept: application/x-ndjson` it streams a `concept` event as each
 * idea is written, then `done` with all five, or `error`.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  const options = { heartHealthy: input.heartHealthy, mealRole: input.mealRole };
  if (!wantsNdjson(req)) {
    return fromAction(await generateConcepts(input.prompt, input.memberIds, input.mealType, undefined, options));
  }
  return ndjsonResponse<ConceptsEvent>(async (emit) => {
    const result = await generateConcepts(input.prompt, input.memberIds, input.mealType, undefined, options, (concept) =>
      emit({ type: "concept", concept })
    );
    emit(result.error || !result.concepts ? { type: "error", message: result.error ?? "No ideas came back." } : { type: "done", concepts: result.concepts });
  });
});
