/**
 * Structured output, streamed: the model's JSON arrives a few characters at a
 * time, and the OpenAI SDK parses what it has so far. `completedItems` turns
 * that into "each element of an array, once it's finished" — an element is
 * done when the next one has started, and the last when the whole answer is.
 * That's what lets "Help me choose" show dishes and picks as they come.
 */

import type OpenAI from "openai";
import type { ChatCompletionStreamParams } from "openai/lib/ChatCompletionStream";
import { LengthFinishReasonError } from "openai/error";
import { partialParse } from "openai/_vendor/partial-json-parser/parser";

/** Hands on each finished element of `parsed[key]` once, in order. */
export function completedItems<T>(key: string, onItem: (item: T, index: number) => void) {
  let sent = 0;
  return {
    /** A partial parse: everything but the last element is finished. */
    partial(parsed: unknown) {
      const list = (parsed as Record<string, unknown> | null)?.[key];
      if (!Array.isArray(list)) return;
      while (sent < list.length - 1) onItem(list[sent] as T, sent++);
    },
    /** The final answer: the rest are finished too. */
    done(parsed: unknown) {
      const list = (parsed as Record<string, unknown> | null)?.[key];
      if (!Array.isArray(list)) return;
      while (sent < list.length) onItem(list[sent] as T, sent++);
    },
  };
}

/**
 * Runs one streamed call. `onPartial` sees each partial parse; the result is
 * the final JSON, unvalidated (the caller parses it with its schema).
 *
 * The SDK only parses as it goes for a schema'd `response_format`; for plain
 * `json_object` (the meal planner, the concept ideas) the snapshot is parsed
 * here instead, with the same partial parser.
 */
export async function streamStructured(
  client: OpenAI,
  params: ChatCompletionStreamParams,
  onPartial: (parsed: unknown) => void
): Promise<unknown> {
  const completion = await streamCompletion(client, params, onPartial);
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("The AI returned nothing.");
  return JSON.parse(content);
}

/**
 * `streamStructured` for callers that need the whole completion back — the
 * finish reason, to retry a recipe that ran out of room. A schema'd answer cut
 * off by its length limit comes back as a completion with `finish_reason:
 * "length"`, not a throw, so it's handled like the unstreamed call.
 */
export async function streamCompletion(
  client: OpenAI,
  params: ChatCompletionStreamParams,
  onPartial: (parsed: unknown) => void
): Promise<OpenAI.ChatCompletion> {
  const stream = client.beta.chat.completions.stream({ ...params, stream: true });
  stream.on("content.delta", ({ parsed, snapshot }) => {
    try {
      onPartial(parsed ?? partialParse(snapshot));
    } catch {
      // a half-read element the caller couldn't use yet; the final parse decides
    }
  });
  try {
    return await stream.finalChatCompletion();
  } catch (err) {
    if (err instanceof LengthFinishReasonError) {
      const snapshot = stream.currentChatCompletionSnapshot;
      return {
        id: snapshot?.id ?? "",
        object: "chat.completion",
        created: snapshot?.created ?? 0,
        model: snapshot?.model ?? "",
        choices: [
          {
            index: 0,
            finish_reason: "length",
            logprobs: null,
            message: { role: "assistant", content: snapshot?.choices[0]?.message?.content ?? null, refusal: null },
          },
        ],
      };
    }
    throw err;
  }
}
