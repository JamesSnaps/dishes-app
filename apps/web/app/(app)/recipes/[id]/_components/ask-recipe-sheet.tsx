"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestion, Send, Loader2, RotateCcw } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@dishes/ui";

type Message = { role: "user" | "assistant"; content: string };

interface Props {
  recipeId: string;
  recipeTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Starter questions — the ones that are awkward to type on a phone and that
// benefit most from the model seeing the whole recipe.
const SUGGESTIONS = [
  "What should I serve with this?",
  "When should I start cooking to eat at 7pm?",
  "What can I prepare ahead of time?",
  "What wine or drink goes with this?",
  "How do I make this less rich?",
  "Can I freeze any of this?",
];

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

export function AskRecipeSheet({ recipeId, recipeTitle, open, onOpenChange }: Props) {
  const isDesktop = useIsDesktop();
  const [thread, setThread] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest content in view as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [thread, streaming]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  function reset() {
    setThread([]);
    setQuestion("");
    setStreaming("");
    setError(null);
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const newThread: Message[] = [...thread, { role: "user", content: trimmed }];
    setThread(newThread);
    setQuestion("");
    setStreaming("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recipe-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, messages: newThread }),
      });

      if (!res.ok) {
        setError((await res.text()) || "Something went wrong.");
        setThread(thread);
        setQuestion(trimmed);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setStreaming(answer);
      }
      setThread([...newThread, { role: "assistant", content: answer }]);
      setStreaming("");
    } catch {
      setError("Couldn't reach the assistant. Please try again.");
      setThread(thread);
      setQuestion(trimmed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={
          isDesktop
            ? "w-[440px] sm:max-w-[440px] flex flex-col p-0 overflow-hidden"
            : "h-[90dvh] flex flex-col p-0 overflow-hidden"
        }
      >
        <SheetHeader className="shrink-0 border-b px-4 pb-3 pr-12 pt-5">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4" />
            Ask about this recipe
          </SheetTitle>
          <p className="line-clamp-1 text-sm text-muted-foreground">{recipeTitle}</p>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {thread.length === 0 && !loading && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask anything about this dish — timings, sides, make-ahead, substitutions. The
                assistant can see the full ingredient list, method, and your past cooks.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void submit(s)}
                    className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {thread.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {m.content}
                </p>
              </div>
            ) : (
              <p
                key={i}
                className="whitespace-pre-line text-sm leading-relaxed text-foreground"
              >
                {m.content}
              </p>
            )
          )}

          {streaming && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {streaming}
            </p>
          )}

          {loading && !streaming && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t p-3">
          {thread.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Start over
            </button>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(question);
                }
              }}
              placeholder="Ask a question…"
              rows={2}
              className="min-h-[44px] flex-1 resize-none text-sm"
            />
            <Button
              type="button"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => void submit(question)}
              disabled={!question.trim() || loading}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
