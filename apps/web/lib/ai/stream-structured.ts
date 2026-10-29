/**
 * Structured output, streamed: the model's JSON arrives a few characters at a
 * time, and the OpenAI SDK parses what it has so far. `completedItems` turns
 * that into "each element of an array, once it's finished" — an element is
 * done when the next one has started, and the last when the whole answer is.
 * That's what lets "Help me choose" show dishes and picks as they come.
 */

import type OpenAI from "openai";
import type { ChatCompletionStreamParams } from "openai/lib/ChatCompletionStream";

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
 */
export async function streamStructured(
  client: OpenAI,
  params: ChatCompletionStreamParams,
  onPartial: (parsed: unknown) => void
): Promise<unknown> {
  const stream = client.beta.chat.completions.stream({ ...params, stream: true });
  stream.on("content.delta", ({ parsed }) => {
    try {
      onPartial(parsed);
    } catch {
      // a half-read element the caller couldn't use yet; the final parse decides
    }
  });
  const content = await stream.finalContent();
  if (!content) throw new Error("The AI returned nothing.");
  return JSON.parse(content);
}
