import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai-jobs");

// AI generation that outlives the page that asked for it. A job runs detached
// inside this server process and parks its result here, so leaving the page —
// or the iPad backgrounding the PWA — no longer throws the answer away: the
// page (or the app-wide tray, if the page is gone) collects it by polling
// GET /api/ai-jobs/{id}.
//
// Redis when configured, else process memory. Both are fine for a single app
// container: the work itself lives in this process either way. When the
// worker container arrives (Phase 2) the same records can be written from there.

export type AiJobKind = "recipe" | "recipe-batch" | "concepts" | "meal-plan";
export type AiJobStatus = "running" | "done" | "failed";

export interface AiJob<R = unknown, P = unknown> {
  id: string;
  kind: AiJobKind;
  householdId: string;
  label: string;
  status: AiJobStatus;
  result?: R;
  progress?: P;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Long enough to come back to a finished recipe later in the evening. */
const TTL_SECONDS = 6 * 60 * 60;
/** A job still "running" after this was lost to a restart or a hung call. */
const STALE_AFTER_MS = 10 * 60 * 1000;

const key = (id: string) => `ai-job:${id}`;
const memory = new Map<string, AiJob>();

async function save(job: AiJob): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key(job.id), JSON.stringify(job), "EX", TTL_SECONDS);
      return;
    } catch (err) {
      log.warn(`Redis write failed for job ${job.id}, keeping it in memory`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  memory.set(job.id, job);
  // Sweep expired in-memory jobs so a long-lived process doesn't accumulate them.
  const cutoff = Date.now() - TTL_SECONDS * 1000;
  for (const [id, j] of memory) if (j.startedAt < cutoff) memory.delete(id);
}

async function load(id: string): Promise<AiJob | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key(id));
      if (raw) return JSON.parse(raw) as AiJob;
    } catch {
      // fall through to memory
    }
  }
  return memory.get(id) ?? null;
}

/** The job, if it belongs to this household. */
export async function readAiJob(id: string, householdId: string): Promise<AiJob | null> {
  const job = await load(id);
  if (!job || job.householdId !== householdId) return null;
  if (job.status === "running" && Date.now() - job.startedAt > STALE_AFTER_MS) {
    return { ...job, status: "failed", error: "Generation was interrupted. Please try again." };
  }
  return job;
}

/**
 * Starts `work` without waiting for it and answers the job id straight away.
 * `work` gets a `report` callback for partial progress (a batch's per-recipe
 * status). Throw to fail the job; the message is shown to the user as-is.
 *
 * `work` must not touch request-scoped APIs (headers, cookies, revalidatePath
 * without a try) — resolve the household and session before calling this.
 */
export async function startAiJob<R, P = never>(
  meta: { householdId: string; kind: AiJobKind; label: string },
  work: (report: (progress: P) => Promise<void>) => Promise<R>
): Promise<string> {
  const job: AiJob<R, P> = {
    id: randomUUID(),
    ...meta,
    status: "running",
    startedAt: Date.now(),
  };
  await save(job);

  const report = async (progress: P) => {
    job.progress = progress;
    await save(job);
  };

  void (async () => {
    try {
      job.result = await work(report);
      job.status = "done";
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      log.warn(`AI job ${job.id} (${job.kind}) failed: ${job.error}`);
    }
    job.finishedAt = Date.now();
    await save(job).catch((err) => log.error(`Failed to store AI job ${job.id}:`, err));
  })();

  log.info(`Started AI job ${job.id} (${job.kind}): ${job.label}`);
  return job.id;
}
