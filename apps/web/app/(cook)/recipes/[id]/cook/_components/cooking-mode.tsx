"use client";

import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import { saveCookAssistThread, deleteCookAssistThread } from "@/app/actions/cook-assist-threads";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Timer,
  Clock,
  Minus,
  Plus,
  CheckCircle2,
  HelpCircle,
  X,
  Send,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@dishes/ui";
import { CookDebrief } from "./cook-debrief";
import type { recipes, recipeIngredients, recipeSteps } from "@dishes/db/schema";

type Recipe = typeof recipes.$inferSelect;
type Ingredient = typeof recipeIngredients.$inferSelect;
type Step = typeof recipeSteps.$inferSelect;

type HouseholdMember = { id: string; displayName: string };

interface Props {
  recipe: Recipe;
  ingredients: Ingredient[];
  steps: Step[];
  householdMembers?: HouseholdMember[];
  avgDuration?: number | null;
  storageAvailable?: boolean;
  initialServings?: number;
  initialAssistThreads?: Array<{ id: string; stepNumber: number; messages: Array<{ role: "user" | "assistant"; content: string }> }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FRACTION_SYMBOLS: Record<string, string> = {
  "0.25": "¼",
  "0.5": "½",
  "0.75": "¾",
  "0.33": "⅓",
  "0.67": "⅔",
  "0.2": "⅕",
  "0.4": "⅖",
  "0.6": "⅗",
  "0.8": "⅘",
  "0.125": "⅛",
  "0.375": "⅜",
  "0.625": "⅝",
  "0.875": "⅞",
};

function parseMixedFraction(amount: string): number {
  // Handles "1 1/2", "1/2", "1", "1.5"
  const trimmed = amount.trim();
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) return parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
  return parseFloat(trimmed);
}

function formatAmount(amount: string | null, scale: number): string {
  if (!amount) return "";
  const raw = parseMixedFraction(amount);
  if (isNaN(raw)) return amount;
  const scaled = raw * scale;
  const whole = Math.floor(scaled);
  const frac = Math.round((scaled - whole) * 1000) / 1000;
  const fracSymbol = FRACTION_SYMBOLS[frac.toFixed(2)] ?? FRACTION_SYMBOLS[frac.toFixed(3)] ?? null;
  if (frac < 0.01) return String(whole || "");
  if (whole === 0) return fracSymbol ?? parseFloat(scaled.toFixed(2)).toString();
  return fracSymbol ? `${whole}${fracSymbol}` : parseFloat(scaled.toFixed(2)).toString();
}

function formatIngredientAmount(ing: Ingredient, scale: number): string {
  const parts: string[] = [];
  if (ing.amount) {
    const amt = formatAmount(ing.amount, scale);
    if (amt) parts.push(amt);
  }
  if (ing.unit) parts.push(ing.unit);
  return parts.join(" ");
}

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Q&A history ─────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ─── Lightweight markdown renderer ───────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: Array<{ type: "p" | "ul" | "ol"; items: string[] }> = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const ulMatch = line.match(/^[-*] (.+)/);
    const olMatch = line.match(/^\d+\. (.+)/);
    if (ulMatch) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(ulMatch[1]);
      else blocks.push({ type: "ul", items: [ulMatch[1]] });
    } else if (olMatch) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "ol") last.items.push(olMatch[1]);
      else blocks.push({ type: "ol", items: [olMatch[1]] });
    } else {
      blocks.push({ type: "p", items: [line] });
    }
  }

  return (
    <div className="text-sm leading-relaxed space-y-1.5">
      {blocks.map((block, i) => {
        if (block.type === "ul") return (
          <ul key={i} className="list-disc pl-4 space-y-0.5">
            {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
          </ul>
        );
        if (block.type === "ol") return (
          <ol key={i} className="list-decimal pl-4 space-y-0.5">
            {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
          </ol>
        );
        return <p key={i}>{renderInline(block.items[0])}</p>;
      })}
    </div>
  );
}

// ─── Timer state ──────────────────────────────────────────────────────────────

interface TimerState {
  remaining: number;
  running: boolean;
  done: boolean;
  totalSeconds: number;
  label: string | null;
  stepNumber: number;
}

// ─── Ingredient chip (inline in step text) ───────────────────────────────────

interface IngredientChipProps {
  name: string;
  label: string;
  amount: string;
  isOpen: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function IngredientChip({ name, label, amount, isOpen, onToggle, onMouseEnter, onMouseLeave }: IngredientChipProps) {
  return (
    <span className="relative inline-block">
      <span
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
        className="cursor-pointer font-semibold text-orange-600 dark:text-orange-400 underline decoration-dotted underline-offset-2 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
        aria-label={`${name}: ${amount || label}`}
      >
        {label}
      </span>
      {isOpen && amount && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 whitespace-nowrap rounded-lg bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-gray-900 shadow-lg pointer-events-none"
          role="tooltip"
        >
          {amount}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-100" />
        </span>
      )}
    </span>
  );
}

// ─── Step text with ingredient highlighting ───────────────────────────────────

interface StepTextProps {
  instruction: string;
  ingredients: Ingredient[];
  scale: number;
}

// Reduce a word to a canonical singular form used as a map key. The rules are
// deliberately simple and need not be linguistically perfect — they only have to
// be applied consistently to both the ingredient names and the words in the step
// text so the two sides line up (e.g. "onions" and "onion" both key to "onion").
function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|ses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

// Surface forms of a word to feed into the match regex: the word itself plus its
// singular and a plausible plural. canonical(form) is identical for every form,
// so whichever spelling the step text uses resolves back to the same ingredient.
function wordForms(word: string): string[] {
  const w = word.toLowerCase();
  const forms = new Set<string>([w]);
  forms.add(singularize(w));
  if (/[^aeiou]y$/.test(w)) forms.add(w.slice(0, -1) + "ies");
  else if (/(s|x|z|ch|sh)$/.test(w)) forms.add(w + "es");
  else forms.add(w + "s");
  return [...forms];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function StepText({ instruction, ingredients, scale }: StepTextProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const namedIngredients = ingredients
    .filter((ing) => ing.ingredientName)
    .sort((a, b) => b.ingredientName.length - a.ingredientName.length);

  if (namedIngredients.length === 0) {
    return <p className="text-xl lg:text-3xl leading-relaxed">{instruction}</p>;
  }

  // Full-name matches. Single-word names also match their singular/plural forms;
  // multi-word names ("celery sticks") match exactly. Keyed by canonical form.
  const patterns: string[] = [];
  const ingByName = new Map<string, Ingredient>();
  for (const ing of namedIngredients) {
    const name = ing.ingredientName.toLowerCase();
    if (name.includes(" ") || name.includes("-")) {
      ingByName.set(name, ing);
      patterns.push(escapeRegex(name));
    } else {
      ingByName.set(singularize(name), ing);
      for (const form of wordForms(name)) patterns.push(escapeRegex(form));
    }
  }

  const MODIFIER_WORDS = new Set([
    "long", "grain", "short", "fresh", "frozen", "dried", "raw", "cooked",
    "large", "small", "medium", "fine", "coarse", "chopped", "diced", "sliced",
    "minced", "grated", "beaten", "rinsed", "thawed", "peeled", "whole", "lean",
    "plain", "dark", "light", "extra", "young", "baby", "mixed", "taste", "and",
    "or", "the", "for", "with", "hot", "cut", "low", "cup", "can", "jar", "tin",
  ]);
  // For each candidate keyword we track who claims it, distinguishing the head
  // noun (last word of an ingredient name, e.g. "rice" in "brown rice") from a
  // mere modifier (e.g. "rice" in "rice wine vinegar"). A head-noun claim beats
  // a modifier claim, so an ambiguous word like "rice" still resolves to the
  // ingredient it actually names. Only genuine ties (same role, multiple
  // ingredients) are dropped as ambiguous.
  interface KeywordClaim {
    ing: Ingredient | null;
    head: boolean;
  }
  const keywordCandidates = new Map<string, KeywordClaim>();
  for (const ing of namedIngredients) {
    const words = ing.ingredientName.toLowerCase().split(/[\s\-,]+/);
    words.forEach((word, idx) => {
      const canonical = singularize(word);
      const isHead = idx === words.length - 1;
      if (word.length >= 3 && !MODIFIER_WORDS.has(word) && !ingByName.has(canonical)) {
        const existing = keywordCandidates.get(canonical);
        if (!existing) {
          keywordCandidates.set(canonical, { ing, head: isHead });
        } else if (isHead && !existing.head) {
          // This ingredient owns the word as its head noun; previous was a modifier.
          keywordCandidates.set(canonical, { ing, head: true });
        } else if (isHead === existing.head) {
          // Same role for two ingredients — genuinely ambiguous.
          keywordCandidates.set(canonical, { ing: null, head: existing.head });
        }
        // else: existing is a head claim and this is a modifier — keep existing.
      }
    });
  }
  const keywordToIng = new Map<string, Ingredient>(
    [...keywordCandidates.entries()]
      .filter((entry): entry is [string, KeywordClaim & { ing: Ingredient }] => entry[1].ing !== null)
      .map(([kw, claim]) => [kw, claim.ing])
  );

  const keywordPatterns = [...keywordToIng.keys()].flatMap((kw) =>
    wordForms(kw).map((form) => `\\b${escapeRegex(form)}\\b`)
  );
  const pattern = new RegExp(`(${[...patterns, ...keywordPatterns].join("|")})`, "gi");

  const parts = instruction.split(pattern);

  return (
    <p className="text-xl lg:text-3xl leading-relaxed">
      {parts.map((part, i) => {
        const key = singularize(part);
        const ing =
          ingByName.get(part.toLowerCase()) ??
          ingByName.get(key) ??
          keywordToIng.get(key);
        if (!ing) return part;

        const amount = formatIngredientAmount(ing, scale);
        const tooltipKey = `${ing.id}-${i}`;
        const isOpen = openId === tooltipKey;

        return (
          <IngredientChip
            key={tooltipKey}
            name={ing.ingredientName}
            label={part}
            amount={amount}
            isOpen={isOpen}
            onToggle={() => setOpenId(isOpen ? null : tooltipKey)}
            onMouseEnter={() => setOpenId(tooltipKey)}
            onMouseLeave={() => setOpenId(null)}
          />
        );
      })}
    </p>
  );
}

// ─── Timer sub-component (controlled) ────────────────────────────────────────

interface StepTimerProps {
  timer: TimerState;
  onToggle: () => void;
  onReset: () => void;
}

function StepTimer({ timer, onToggle, onReset }: StepTimerProps) {
  const { remaining, running, done, totalSeconds, label } = timer;
  const progress = (totalSeconds - remaining) / totalSeconds;

  return (
    <div className="mt-6 rounded-xl border bg-muted/40 p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Timer className="h-4 w-4" />
        {label ?? "Timer"}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span
          className={`font-mono text-4xl font-bold tabular-nums tracking-tight ${
            done ? "text-green-500" : remaining <= 30 && running ? "text-orange-500" : ""
          }`}
        >
          {done ? "Done!" : formatTimer(remaining)}
        </span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${done ? "bg-green-500" : "bg-primary"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={running ? "outline" : "default"} size="sm" onClick={onToggle} disabled={done} className="flex-1">
          {running ? <><Pause className="mr-1.5 h-4 w-4" /> Pause</> : <><Play className="mr-1.5 h-4 w-4" /> {remaining < totalSeconds ? "Resume" : "Start"}</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset} title="Reset timer">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Active timers panel (sidebar) ───────────────────────────────────────────

interface TimerPanelProps {
  timers: Map<number, TimerState>;
  onToggle: (idx: number) => void;
  onReset: (idx: number) => void;
  onJumpToStep: (idx: number) => void;
}

function ActiveTimersPanel({ timers, onToggle, onReset, onJumpToStep }: TimerPanelProps) {
  const active = [...timers.entries()].filter(([, t]) => t.remaining < t.totalSeconds || t.done);
  if (active.length === 0) return null;

  return (
    <div className="shrink-0 px-6 py-5 border-t">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5" />
        Active Timers
      </p>
      <div className="space-y-2.5">
        {active.map(([idx, timer]) => (
          <div
            key={idx}
            className={`rounded-lg border p-3 transition-colors ${
              timer.done
                ? "border-green-500/30 bg-green-500/5"
                : timer.running
                ? "border-orange-500/30 bg-orange-500/5"
                : "border-border bg-muted/30"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <button
                onClick={() => onJumpToStep(idx)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              >
                Step {timer.stepNumber}{timer.label ? ` · ${timer.label}` : ""}
              </button>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => onToggle(idx)}
                  disabled={timer.done}
                >
                  {timer.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => onReset(idx)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <span
              className={`font-mono text-xl font-bold tabular-nums ${
                timer.done ? "text-green-500" : timer.running && timer.remaining <= 30 ? "text-orange-500" : ""
              }`}
            >
              {timer.done ? "Done!" : formatTimer(timer.remaining)}
            </span>
            {!timer.done && (
              <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${timer.running ? "bg-orange-500" : "bg-primary/40"}`}
                  style={{ width: `${Math.round(((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mobile timer shelf ───────────────────────────────────────────────────────

function MobileTimerShelf({ timers, onToggle, onReset, onJumpToStep }: TimerPanelProps) {
  const active = [...timers.entries()].filter(([, t]) => t.remaining < t.totalSeconds || t.done);
  if (active.length === 0) return null;

  return (
    <div className="lg:hidden shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-none">
        {active.map(([idx, timer]) => (
          <div
            key={idx}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 ${
              timer.done
                ? "border-green-500/40 bg-green-500/10"
                : timer.running
                ? "border-orange-500/40 bg-orange-500/10"
                : "border-border bg-muted/40"
            }`}
          >
            <button
              onClick={() => onJumpToStep(idx)}
              className="flex items-center gap-1.5"
              aria-label={`Jump to step ${timer.stepNumber}`}
            >
              <Timer className={`h-3.5 w-3.5 ${timer.running ? "text-orange-500" : "text-muted-foreground"}`} />
              <span className={`font-mono text-sm font-bold tabular-nums ${timer.done ? "text-green-500" : ""}`}>
                {timer.done ? "Done!" : formatTimer(timer.remaining)}
              </span>
              <span className="text-xs text-muted-foreground">S{timer.stepNumber}</span>
            </button>
            <div className="flex gap-0.5">
              <button
                onClick={() => onToggle(idx)}
                disabled={timer.done}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-background disabled:opacity-40 transition-colors"
                aria-label={timer.running ? "Pause timer" : "Resume timer"}
              >
                {timer.running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onReset(idx)}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-background transition-colors"
                aria-label="Reset timer"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cook Assist (contextual AI quick-ask) ───────────────────────────────────

interface CookAssistProps {
  recipeTitle: string;
  stepNumber: number;
  stepInstruction: string;
  stepIngredients: Array<{ name: string; amount?: string; unit?: string }>;
  history: Array<{ id?: string; messages: Message[] }>;
  onSave: (thread: Message[], stepNumber: number) => void;
  onExchangeComplete: (thread: Message[]) => void;
  onDeleteThread: (id: string) => void;
}

function CookAssist({ recipeTitle, stepNumber, stepInstruction, stepIngredients, history, onSave, onExchangeComplete, onDeleteThread }: CookAssistProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  // Current conversational thread for this step session
  const [thread, setThread] = useState<Message[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Refs to access latest state in effects without adding them as deps
  const threadRef = useRef<Message[]>([]);
  threadRef.current = thread;
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; });
  const onExchangeCompleteRef = useRef(onExchangeComplete);
  useEffect(() => { onExchangeCompleteRef.current = onExchangeComplete; });

  // When navigating to a different step: save the current thread to history, then clear.
  // The thread must be attributed to the step we're *leaving*, not the one we're entering —
  // so we save against the previous step number, not the (already-updated) `stepNumber` prop.
  const prevStepRef = useRef(stepNumber);
  useEffect(() => {
    const prevStep = prevStepRef.current;
    if (prevStep !== stepNumber) {
      const currentThread = threadRef.current;
      if (currentThread.length > 0) {
        onSaveRef.current(currentThread, prevStep);
      }
    }
    prevStepRef.current = stepNumber;
    setThread([]);
    setStreamingAnswer("");
    setQuestion("");
    setError(null);
  }, [stepNumber]);

  // Auto-scroll to bottom when thread or streaming content changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, streamingAnswer]);

  function openModal() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeModal() {
    setOpen(false);
  }

  async function submit() {
    if (!question.trim() || loading) return;
    const userMsg: Message = { role: "user", content: question.trim() };
    const newThread = [...thread, userMsg];
    setThread(newThread);
    setQuestion("");
    setStreamingAnswer("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/cook-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeTitle,
          stepNumber,
          stepInstruction,
          stepIngredients,
          messages: newThread,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        setError(msg || "Something went wrong.");
        setThread(newThread.slice(0, -1));
        setQuestion(userMsg.content);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullAnswer += decoder.decode(value, { stream: true });
        setStreamingAnswer(fullAnswer);
      }

      // Commit the completed answer into the thread
      const completedThread: Message[] = [...newThread, { role: "assistant" as const, content: fullAnswer }];
      setThread(completedThread);
      setStreamingAnswer("");
      onExchangeCompleteRef.current(completedThread);
    } catch {
      setError("Could not reach the server. Check your connection.");
      setThread(newThread.slice(0, -1));
      setQuestion(userMsg.content);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Erase the most recent exchange from the working thread (assistant reply + its
  // question, or a lone unanswered question). Kept in sync with the parent's
  // save ref so a trimmed thread is what gets persisted on navigate/Done.
  function deleteLastExchange() {
    if (thread.length === 0 || loading) return;
    const next = [...thread];
    if (next[next.length - 1].role === "assistant") {
      next.pop();
      if (next.length && next[next.length - 1].role === "user") next.pop();
    } else {
      next.pop();
    }
    setThread(next);
    setError(null);
    onExchangeCompleteRef.current(next);
  }

  // Wipe the whole current session without saving it.
  function clearThread() {
    if (loading) return;
    setThread([]);
    setStreamingAnswer("");
    setError(null);
    onExchangeCompleteRef.current([]);
  }

  const stepPreview = stepInstruction.length > 80
    ? stepInstruction.slice(0, 80).trimEnd() + "…"
    : stepInstruction;

  const hasHistory = history.length > 0;
  const hasThread = thread.length > 0 || !!streamingAnswer || !!error;

  return (
    <>
      {/* Trigger button */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={openModal}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Ask a question about this step"
        >
          <HelpCircle className="h-4 w-4" />
          Ask about this step
        </button>
        {(hasHistory || thread.length > 0) && (
          <span
            onClick={openModal}
            className="cursor-pointer text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {thread.length > 0
              ? `· ${Math.floor(thread.length / 2)} ${Math.floor(thread.length / 2) === 1 ? "exchange" : "exchanges"} this session`
              : `· ${history.length} previous ${history.length === 1 ? "session" : "sessions"}`
            }
          </span>
        )}
      </div>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Ask a cooking question"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Panel — bottom sheet on mobile, centered card on sm+ */}
          <div className="relative z-10 w-full sm:max-w-lg mx-auto sm:mx-4 bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl border flex flex-col max-h-[85dvh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-orange-500" />
                <span className="font-semibold text-sm">Ask about Step {stepNumber}</span>
              </div>
              <button
                onClick={closeModal}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Step context */}
            <p className="px-5 pb-3 text-xs text-muted-foreground leading-relaxed shrink-0 border-b">
              {stepPreview}
            </p>

            {/* Scrollable conversation area */}
            {(hasHistory || hasThread) && (
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-5">
                {/* Past sessions for this step */}
                {hasHistory && (
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Previous sessions
                    </p>
                    <div className="space-y-4">
                      {history.map(({ id, messages }, ti) => (
                        <div key={id ?? ti} className={`space-y-3 ${ti < history.length - 1 ? "pb-4 border-b" : ""}`}>
                          {messages.map((msg, mi) => (
                            msg.role === "user" ? (
                              <p key={mi} className="text-xs font-medium text-foreground/60">{msg.content}</p>
                            ) : (
                              <MarkdownContent key={mi} text={msg.content} />
                            )
                          ))}
                          {id && (
                            <button
                              onClick={() => onDeleteThread(id)}
                              className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
                              aria-label="Delete this conversation"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {hasThread && <div className="mt-4 border-t" />}
                  </div>
                )}

                {/* Current conversational thread */}
                {hasThread && (
                  <div className="space-y-3">
                    {hasHistory && (
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        This session
                      </p>
                    )}
                    {thread.map((msg, i) => (
                      msg.role === "user" ? (
                        <p key={i} className="text-xs font-medium text-foreground/60">{msg.content}</p>
                      ) : (
                        <MarkdownContent key={i} text={msg.content} />
                      )
                    ))}
                    {/* Streaming answer */}
                    {error ? (
                      <p className="text-sm text-destructive">{error}</p>
                    ) : loading && !streamingAnswer ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Thinking…
                      </span>
                    ) : streamingAnswer ? (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {streamingAnswer}
                        {loading && (
                          <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 rounded-sm align-text-bottom" />
                        )}
                      </p>
                    ) : null}

                    {/* Erase controls for the working thread */}
                    {thread.length > 0 && !loading && !streamingAnswer && (
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={deleteLastExchange}
                          className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-destructive transition-colors"
                          aria-label="Delete the last exchange"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete last
                        </button>
                        <button
                          onClick={clearThread}
                          className="text-xs text-muted-foreground/60 hover:text-destructive transition-colors"
                          aria-label="Clear this session"
                        >
                          Clear session
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Input area */}
            <div className="shrink-0 px-5 py-4 border-t flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={thread.length > 0 ? "Ask a follow-up…" : "e.g. Can I substitute Greek yogurt here?"}
                rows={2}
                disabled={loading}
                className="flex-1 resize-none rounded-xl border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              <Button
                size="sm"
                onClick={submit}
                disabled={!question.trim() || loading}
                className="shrink-0 h-10 w-10 p-0"
                aria-label="Send question"
              >
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />
                }
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Scaling control ──────────────────────────────────────────────────────────

interface ScalingControlProps {
  originalServings: string | null;
  servingsUnit: string | null;
  currentServings: number;
  onChange: (n: number) => void;
}

function ScalingControl({ originalServings, servingsUnit, currentServings, onChange }: ScalingControlProps) {
  const step = currentServings >= 10 ? 2 : 1;
  const min = 0.5;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Serves</span>
      <div className="flex items-center gap-1 rounded-lg border bg-background">
        <button
          onClick={() => onChange(Math.max(min, currentServings - step))}
          className="flex h-8 w-8 items-center justify-center rounded-l-lg transition-colors hover:bg-muted"
          aria-label="Decrease servings"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums">
          {currentServings % 1 === 0 ? currentServings : currentServings.toFixed(1)}
        </span>
        <button
          onClick={() => onChange(currentServings + step)}
          className="flex h-8 w-8 items-center justify-center rounded-r-lg transition-colors hover:bg-muted"
          aria-label="Increase servings"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {servingsUnit && <span className="text-sm text-muted-foreground">{servingsUnit}</span>}
      {originalServings && parseFloat(originalServings) !== currentServings && (
        <button
          onClick={() => onChange(parseFloat(originalServings))}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          reset
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CookingMode({ recipe, ingredients, steps, householdMembers = [], avgDuration, storageAvailable, initialServings, initialAssistThreads }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const cookStartRef = useRef<number>(Date.now());
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());
  const originalServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const [currentServings, setCurrentServings] = useState(initialServings ?? originalServings ?? 4);
  const [stepHistory, setStepHistory] = useState<Map<number, Array<{ id?: string; messages: Message[] }>>>(() => {
    const map = new Map<number, Array<{ id?: string; messages: Message[] }>>();
    for (const { id, stepNumber, messages } of initialAssistThreads ?? []) {
      const idx = stepNumber - 1;
      map.set(idx, [...(map.get(idx) ?? []), { id, messages: messages as Message[] }]);
    }
    return map;
  });

  // Tracks the active thread for the current step so we can save it on Done
  const latestThreadRef = useRef<Message[]>([]);

  const saveStepThread = useCallback((stepIdx: number, thread: Message[]) => {
    setStepHistory((prev) => {
      const next = new Map(prev);
      next.set(stepIdx, [...(next.get(stepIdx) ?? []), { messages: thread }]);
      return next;
    });
    latestThreadRef.current = [];
    startTransition(() => {
      saveCookAssistThread(recipe.id, stepIdx + 1, thread).catch(console.error);
    });
  }, [recipe.id]);

  const deleteStepThread = useCallback((id: string) => {
    setStepHistory((prev) => {
      const next = new Map(prev);
      for (const [idx, threads] of next) {
        const filtered = threads.filter((t) => t.id !== id);
        if (filtered.length !== threads.length) {
          next.set(idx, filtered);
          break;
        }
      }
      return next;
    });
    startTransition(() => {
      deleteCookAssistThread(id).catch(console.error);
    });
  }, []);

  const handleExchangeComplete = useCallback((thread: Message[]) => {
    latestThreadRef.current = thread;
  }, []);

  // Global timer state — timers persist across step navigation
  const [timers, setTimers] = useState<Map<number, TimerState>>(() => {
    const map = new Map<number, TimerState>();
    steps.forEach((step, i) => {
      if (step.durationMinutes) {
        const totalSeconds = step.durationMinutes * 60;
        map.set(i, {
          remaining: totalSeconds,
          running: false,
          done: false,
          totalSeconds,
          label: step.timerLabel ?? null,
          stepNumber: i + 1,
        });
      }
    });
    return map;
  });

  // Single interval ticks all running timers
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [idx, timer] of next) {
          if (!timer.running || timer.done) continue;
          changed = true;
          if (timer.remaining <= 1) {
            next.set(idx, { ...timer, remaining: 0, running: false, done: true });
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              navigator.vibrate([300, 100, 300]);
            }
          } else {
            next.set(idx, { ...timer, remaining: timer.remaining - 1 });
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleTimer = useCallback((idx: number) => {
    setTimers((prev) => {
      const timer = prev.get(idx);
      if (!timer || timer.done) return prev;
      const next = new Map(prev);
      next.set(idx, { ...timer, running: !timer.running });
      return next;
    });
  }, []);

  const resetTimer = useCallback((idx: number) => {
    setTimers((prev) => {
      const timer = prev.get(idx);
      if (!timer) return prev;
      const next = new Map(prev);
      next.set(idx, { ...timer, remaining: timer.totalSeconds, running: false, done: false });
      return next;
    });
  }, []);

  const scale = originalServings && originalServings > 0 ? currentServings / originalServings : 1;
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const activeIngredientIds = new Set((currentStep?.ingredientIds as string[] | null) ?? []);
  const stepIngredients = ingredients.filter((ing) => activeIngredientIds.has(ing.id));

  // Wake lock — re-acquire when the tab regains visibility (browser drops it on hide)
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === "visible") {
        (navigator.wakeLock as { request: (type: string) => Promise<WakeLockSentinel> })
          .request("screen")
          .then((l) => { lock = l; })
          .catch(() => {});
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, []);

  const goNext = useCallback(() => { if (!isLast) setStepIndex((i) => i + 1); }, [isLast]);
  const goPrev = useCallback(() => { if (!isFirst) setStepIndex((i) => i - 1); }, [isFirst]);

  const toggleIngredient = (id: string) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Keyboard navigation — skip when a modal/dialog is open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  if (steps.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-muted-foreground">This recipe has no steps yet.</p>
        <Button asChild variant="outline">
          <Link href={`/recipes/${recipe.id}`}>Back to recipe</Link>
        </Button>
      </div>
    );
  }

  const currentTimer = timers.get(stepIndex);

  const timerProps: TimerPanelProps = {
    timers,
    onToggle: toggleTimer,
    onReset: resetTimer,
    onJumpToStep: setStepIndex,
  };

  const NavButtons = ({ className }: { className?: string }) => (
    <div className={`flex gap-3 ${className ?? ""}`}>
      <Button variant="outline" size="lg" onClick={goPrev} disabled={isFirst} className="flex-1">
        <ChevronLeft className="mr-1.5 h-5 w-5" />
        Previous
      </Button>
      {isLast ? (
        <Button
          size="lg"
          onClick={() => {
            if (isComplete) return;
            // Save the current step's thread if it has at least one complete exchange
            // (latestThreadRef is only updated on completed exchanges, but guard anyway)
            if (latestThreadRef.current.length >= 2) {
              saveStepThread(stepIndex, latestThreadRef.current);
            }
            const mins = Math.max(1, Math.round((Date.now() - cookStartRef.current) / 60000));
            setElapsedMinutes(mins);
            setIsComplete(true);
          }}
          className="flex-1"
        >
          <CheckCircle2 className="mr-1.5 h-5 w-5" />
          Done
        </Button>
      ) : (
        <Button size="lg" onClick={goNext} className="flex-1">
          Next
          <ChevronRight className="ml-1.5 h-5 w-5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="shrink-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="relative flex items-center px-4 py-3 h-14">
          {/* Exit button — icon only on small screens, full label on sm+ */}
          <Button asChild variant="ghost" size="sm" className="-ml-2 shrink-0">
            <Link href={`/recipes/${recipe.id}`}>
              <ChevronLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Exit Cooking Mode</span>
            </Link>
          </Button>

          {/* Title — absolutely centred so it's never pushed off-axis */}
          <div className="absolute inset-x-0 flex flex-col items-center px-20 sm:px-40 pointer-events-none">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Cooking Mode
            </p>
            <h1 className="text-sm font-semibold truncate w-full text-center">{recipe.title}</h1>
          </div>

          <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
            {stepIndex + 1} / {steps.length}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-border">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Main column: scrollable content + pinned desktop nav ─── */}
        <div className="flex flex-col flex-1 min-h-0">

          {/* ── Main content ─────────────────────────────────────────── */}
          <main className="flex-1 min-h-0 overflow-y-auto">
            {/* Recipe image */}
            {recipe.imageUrl && (
              <div className="h-20 sm:h-28 lg:h-auto lg:aspect-[21/8] w-full overflow-hidden bg-muted shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={recipe.imageUrl}
                  alt={recipe.title}
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div className="px-4 py-6 lg:px-10 lg:py-10">
              {/* Avg duration hint — mobile only, step 1 only */}
              {avgDuration && stepIndex === 0 && (
                <div className="mb-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground lg:hidden">
                  <Clock className="h-3 w-3 shrink-0" />
                  Usually takes you ~{avgDuration < 60 ? `${avgDuration} min` : `${Math.floor(avgDuration / 60)}h${avgDuration % 60 > 0 ? ` ${avgDuration % 60}m` : ""}`}
                </div>
              )}

              {/* Step dot nav (mobile only) */}
              <div className="mb-4 flex justify-center gap-1 lg:hidden">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStepIndex(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stepIndex ? "w-6 bg-primary" : "w-1.5 bg-border"
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              {/* Servings control (mobile only) */}
              {originalServings && (
                <div className="mb-6 flex justify-center lg:hidden">
                  <ScalingControl
                    originalServings={recipe.servings}
                    servingsUnit={recipe.servingsUnit ?? null}
                    currentServings={currentServings}
                    onChange={setCurrentServings}
                  />
                </div>
              )}

              {/* Step number badge + instruction */}
              {currentStep && (
                <div className="flex gap-4 lg:gap-6 mb-6">
                  <span className="flex h-10 w-10 lg:h-14 lg:w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white font-bold text-base lg:text-xl">
                    {stepIndex + 1}
                  </span>
                  <div className="flex-1 min-w-0 pt-1 lg:pt-2">
                    <StepText
                      instruction={currentStep.instruction}
                      ingredients={ingredients}
                      scale={scale}
                    />
                  </div>
                </div>
              )}

              {/* Timer for current step */}
              {currentTimer && (
                <StepTimer
                  timer={currentTimer}
                  onToggle={() => toggleTimer(stepIndex)}
                  onReset={() => resetTimer(stepIndex)}
                />
              )}

              {/* AI quick-ask */}
              {currentStep && (
                <CookAssist
                  recipeTitle={recipe.title}
                  stepNumber={stepIndex + 1}
                  stepInstruction={currentStep.instruction}
                  stepIngredients={stepIngredients.map((ing) => ({
                    name: ing.ingredientName,
                    amount: ing.amount ?? undefined,
                    unit: ing.unit ?? undefined,
                  }))}
                  history={stepHistory.get(stepIndex) ?? []}
                  onSave={(thread, stepNumber) => saveStepThread(stepNumber - 1, thread)}
                  onExchangeComplete={handleExchangeComplete}
                  onDeleteThread={deleteStepThread}
                />
              )}

              {/* Active ingredients — mobile only */}
              {stepIngredients.length > 0 && (
                <div className="mt-6 rounded-xl border bg-orange-500/5 border-orange-500/20 p-4 lg:hidden">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                    Used in this step
                  </p>
                  <ul className="space-y-1.5">
                    {stepIngredients.map((ing) => (
                      <li key={ing.id} className="flex items-baseline gap-2 text-sm">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500 mt-[5px]" />
                        <span>
                          {ing.amount && (
                            <span className="font-semibold">
                              {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                            </span>
                          )}
                          {ing.ingredientName}
                          {ing.preparation && ing.preparation.toLowerCase() !== "none" && (
                            <span className="text-muted-foreground">, {ing.preparation}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* All ingredients collapsed — mobile only */}
              {ingredients.length > 0 && (
                <details className="mt-4 rounded-xl border lg:hidden">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-muted/40 transition-colors">
                    All ingredients ({ingredients.length})
                    {scale !== 1 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        scaled ×{parseFloat(scale.toFixed(2))}
                      </span>
                    )}
                  </summary>
                  <ul className="space-y-1.5 px-4 pb-4 pt-2">
                    {ingredients.map((ing) => {
                      const isActive = activeIngredientIds.has(ing.id);
                      return (
                        <li
                          key={ing.id}
                          className={`flex items-baseline gap-2 text-sm transition-colors ${
                            isActive ? "text-foreground font-medium" : "text-muted-foreground"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full mt-[5px] ${
                              isActive ? "bg-orange-500" : "bg-muted-foreground/40"
                            }`}
                          />
                          <span>
                            {ing.amount && (
                              <span className={isActive ? "font-semibold" : "font-medium"}>
                                {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                              </span>
                            )}
                            {ing.ingredientName}
                            {ing.preparation && ing.preparation.toLowerCase() !== "none" && <span>, {ing.preparation}</span>}
                            {ing.isOptional && <span className="ml-1 text-xs">(optional)</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}


            </div>
          </main>

          {/* ── Desktop nav — pinned at bottom of content column ─────── */}
          <NavButtons className="hidden lg:flex shrink-0 px-10 py-4 border-t bg-background" />

        </div>{/* end main column */}

        {/* ── Sidebar (desktop only) ────────────────────────────────── */}
        <aside className="hidden lg:flex lg:w-[340px] xl:w-[380px] shrink-0 flex-col border-l h-full overflow-hidden">
          {/* Step progress */}
          <div className="shrink-0 px-6 py-5 border-b">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-semibold text-sm">Step {stepIndex + 1} of {steps.length}</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
            {avgDuration && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                Usually takes you ~{avgDuration < 60 ? `${avgDuration} min` : `${Math.floor(avgDuration / 60)}h${avgDuration % 60 > 0 ? ` ${avgDuration % 60}m` : ""}`}
              </p>
            )}
          </div>

          {/* Scaling */}
          {originalServings && (
            <div className="shrink-0 px-6 py-4 border-b">
              <ScalingControl
                originalServings={recipe.servings}
                servingsUnit={recipe.servingsUnit ?? null}
                currentServings={currentServings}
                onChange={setCurrentServings}
              />
            </div>
          )}

          {/* Ingredients checklist */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ingredients
              {scale !== 1 && (
                <span className="ml-2 normal-case font-normal">
                  scaled ×{parseFloat(scale.toFixed(2))}
                </span>
              )}
            </p>
            <ul className="space-y-2.5">
              {ingredients.map((ing) => {
                const isActive = activeIngredientIds.has(ing.id);
                const isChecked = checkedIngredients.has(ing.id);
                return (
                  <li
                    key={ing.id}
                    className={`flex items-start gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                      isActive && !isChecked ? "bg-orange-500/10" : ""
                    }`}
                  >
                    <button
                      onClick={() => toggleIngredient(ing.id)}
                      className={`mt-0.5 shrink-0 transition-colors ${
                        isChecked
                          ? "text-green-500"
                          : isActive
                          ? "text-orange-500"
                          : "text-muted-foreground/40 hover:text-muted-foreground"
                      }`}
                      aria-label={isChecked ? `Uncheck ${ing.ingredientName}` : `Check ${ing.ingredientName}`}
                    >
                      <CheckCircle2
                        className={`h-5 w-5 ${isChecked ? "fill-green-500/20" : isActive ? "fill-orange-500/10" : ""}`}
                      />
                    </button>
                    <span
                      className={`text-sm leading-relaxed transition-colors ${
                        isChecked
                          ? "text-muted-foreground/50 line-through"
                          : isActive
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {ing.amount && (
                        <span className={isActive && !isChecked ? "font-bold" : "font-medium"}>
                          {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                        </span>
                      )}
                      {ing.ingredientName}
                      {ing.preparation && ing.preparation.toLowerCase() !== "none" && <span className="font-normal">, {ing.preparation}</span>}
                      {ing.isOptional && <span className="ml-1 text-xs">(optional)</span>}
                    </span>
                    {isActive && !isChecked && (
                      <span className="ml-auto shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Active timers panel */}
          <ActiveTimersPanel {...timerProps} />

          {/* Up Next */}
          {!isLast && steps[stepIndex + 1] && (
            <div className="shrink-0 px-6 py-5 border-t bg-muted/30">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Up Next
              </p>
              <p className="text-sm text-muted-foreground line-clamp-3">
                {steps[stepIndex + 1].instruction}
              </p>
              <button
                onClick={goNext}
                className="mt-2 text-xs text-primary hover:underline underline-offset-2"
              >
                Skip ahead →
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* ── Mobile timer shelf — shown when timers are running/paused ── */}
      <MobileTimerShelf {...timerProps} />

      {/* ── Mobile footer nav ───────────────────────────────────────── */}
      <footer className="lg:hidden shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <NavButtons className="p-4" />
      </footer>

      {/* ── Post-cooking debrief overlay ────────────────────────────── */}
      {isComplete && (
        <CookDebrief
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          recipeServings={originalServings}
          storedCookTimeMinutes={recipe.cookTimeMinutes}
          elapsedMinutes={elapsedMinutes}
          currentServings={currentServings}
          householdMembers={householdMembers}
          storageAvailable={storageAvailable}
        />
      )}
    </div>
  );
}
