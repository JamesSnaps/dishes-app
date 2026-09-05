"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChefHat,
  Download,
  KeyRound,
  Loader2,
  Share2,
  ShoppingCart,
  Sparkles,
  Smartphone,
  UtensilsCrossed,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
} from "@dishes/ui";
import { saveAiConfig } from "@/app/actions/settings";
import { completeOnboarding } from "@/app/actions/onboarding";

/**
 * First-run tour. Shown once per member (tracked by
 * household_members.onboarding_completed_at) and re-runnable from Settings.
 *
 * The two configuration steps are deliberately skippable: a new user should be
 * able to reach their recipes without an OpenAI account, and the install step
 * is a no-op on a desktop browser that has already installed the app.
 */

interface Props {
  displayName: string;
  /** Admins own the household's AI settings; everyone else can't set the key. */
  isAdmin: boolean;
  /** Household already has an API key — skip the AI step entirely. */
  hasAiKey: boolean;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const FEATURES = [
  {
    icon: BookOpen,
    title: "Your recipe book",
    body: "Add recipes by hand or import them. Ingredients are structured, so scaling a recipe up for guests actually works.",
  },
  {
    icon: Sparkles,
    title: "AI that suggests, you choose",
    body: "Describe what you fancy and Dishes offers a handful of concepts. Pick one and it writes the full recipe.",
  },
  {
    icon: CalendarDays,
    title: "Plan the week",
    body: "Drag recipes onto a week view, set servings per meal, and see what tonight holds at a glance.",
  },
  {
    icon: ShoppingCart,
    title: "Shopping lists that add up",
    body: "Build a list straight from your plan. Duplicate ingredients get combined instead of listed twice.",
  },
  {
    icon: ChefHat,
    title: "Cooking mode",
    body: "Big text, step-by-step, timers built into the steps, and the screen stays awake while your hands are messy.",
  },
  {
    icon: Share2,
    title: "Share and borrow",
    body: "Send anyone a link to a recipe. If they use Dishes too, one tap saves their own copy.",
  },
] as const;

export function WelcomeWizard({ displayName, isAdmin, hasAiKey }: Props) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Chromium fires this instead of showing its own install UI; stashing it lets
  // us put the real prompt behind our button. Safari/iOS never fires it, hence
  // the manual instructions below.
  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Resolved after mount, not during render: the server has no window, and
  // branching on it inline would desync hydration.
  const [alreadyStandalone, setAlreadyStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setAlreadyStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari's non-standard flag.
        (window.navigator as { standalone?: boolean }).standalone === true
    );
    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
  }, []);

  // Frozen at mount on purpose. Saving the key revalidates, which flips
  // hasAiKey to true; recomputing on that would drop the AI step out of the
  // list mid-flow and slide every later step down an index, skipping the one
  // the user was about to see.
  const [hadAiKeyAtStart] = useState(hasAiKey);

  // Steps are assembled per-user: no AI step for non-admins or a household
  // that is already configured, no install step inside an installed app.
  const steps = useMemo(() => {
    const list: ("welcome" | "features" | "ai" | "install" | "done")[] = [
      "welcome",
      "features",
    ];
    if (isAdmin && !hadAiKeyAtStart) list.push("ai");
    if (!alreadyStandalone) list.push("install");
    list.push("done");
    return list;
  }, [isAdmin, hadAiKeyAtStart, alreadyStandalone]);

  const current = steps[Math.min(step, steps.length - 1)]!;
  const isLast = step >= steps.length - 1;

  function finish() {
    setOpen(false);
    startTransition(async () => {
      await completeOnboarding();
    });
  }

  function next() {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }

  function handleSaveKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) return next();

    setKeyError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("apiKey", trimmed);
        await saveAiConfig(fd);
        setKeySaved(true);
        setApiKey("");
        setTimeout(next, 600);
      } catch (e) {
        setKeyError(e instanceof Error ? e.message : "Couldn't save that key.");
      }
    });
  }

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border-primary/20 bg-gradient-to-b from-primary/[0.08] via-background to-background p-0">
        {/* Progress */}
        <div className="flex gap-1.5 px-6 pt-6">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-primary/15"
              }`}
            />
          ))}
        </div>

        <div className="px-6 pb-6 pt-5">
          {current === "welcome" && (
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-lg shadow-primary/30">
                <UtensilsCrossed className="h-8 w-8" />
              </div>
              <DialogTitle className="mt-5 text-2xl font-bold tracking-tight">
                Welcome to Dishes, {displayName.split(" ")[0]}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">
                Your own private kitchen: recipes, a weekly plan, and a shopping
                list that writes itself. Nothing here is shared with anyone else
                unless you send them a link.
              </DialogDescription>
              <p className="mt-4 text-xs text-muted-foreground">
                Two minutes to set up. You can skip anything.
              </p>
            </div>
          )}

          {current === "features" && (
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight">
                What&apos;s in here
              </DialogTitle>
              <DialogDescription className="sr-only">
                An overview of the main features of Dishes.
              </DialogDescription>
              <div className="mt-4 space-y-2.5">
                {FEATURES.map((f) => (
                  <div
                    key={f.title}
                    className="flex gap-3 rounded-xl border bg-gradient-to-br from-card to-primary/[0.04] p-3 shadow-sm"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <f.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{f.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {f.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {current === "ai" && (
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-500/25">
                <KeyRound className="h-6 w-6" />
              </div>
              <DialogTitle className="mt-4 text-xl font-bold tracking-tight">
                Turn on the AI features
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">
                Recipe generation, imports and food photos run on your own OpenAI
                key, so the usage is billed to you and nobody else can see it.
                Create one at{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  platform.openai.com
                </a>
                .
              </DialogDescription>

              <div className="mt-4">
                <Label htmlFor="wizard-api-key" className="text-xs">
                  OpenAI API key
                </Label>
                <Input
                  id="wizard-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="mt-1.5"
                />
                {keyError && (
                  <p className="mt-2 text-xs text-destructive">{keyError}</p>
                )}
                {keySaved && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Key saved
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Stored encrypted on the server, never sent to the browser. You can
                  add it later in Settings → AI.
                </p>
              </div>
            </div>
          )}

          {current === "install" && (
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/25">
                <Smartphone className="h-6 w-6" />
              </div>
              <DialogTitle className="mt-4 text-xl font-bold tracking-tight">
                Put it on your home screen
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">
                Dishes installs like a normal app — full screen, its own icon, and
                it keeps working when the kitchen wifi doesn&apos;t.
              </DialogDescription>

              <div className="mt-4">
                {installed ? (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="h-4 w-4" /> Installed — open it from your home
                    screen next time.
                  </p>
                ) : installEvent ? (
                  <Button onClick={handleInstall} className="w-full gap-2">
                    <Download className="h-4 w-4" />
                    Install Dishes
                  </Button>
                ) : isIos ? (
                  <ol className="space-y-2 rounded-xl border bg-card/60 p-3.5 text-sm">
                    <li className="flex gap-2.5">
                      <span className="font-semibold text-primary">1.</span>
                      Tap the Share button in Safari&apos;s toolbar.
                    </li>
                    <li className="flex gap-2.5">
                      <span className="font-semibold text-primary">2.</span>
                      Scroll down and choose &ldquo;Add to Home Screen&rdquo;.
                    </li>
                    <li className="flex gap-2.5">
                      <span className="font-semibold text-primary">3.</span>
                      Tap Add. Dishes appears with your other apps.
                    </li>
                  </ol>
                ) : (
                  <p className="rounded-xl border bg-card/60 p-3.5 text-sm text-muted-foreground">
                    Look for the install icon in your browser&apos;s address bar, or
                    open this page on your phone and add it to the home screen from
                    the browser menu.
                  </p>
                )}
              </div>
            </div>
          )}

          {current === "done" && (
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
                <Check className="h-8 w-8" />
              </div>
              <DialogTitle className="mt-5 text-2xl font-bold tracking-tight">
                You&apos;re set up
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">
                Start by adding a recipe you cook often, or open a share link
                someone sent you. Everything here is re-runnable from Settings if
                you want the tour again.
              </DialogDescription>
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 flex items-center gap-3">
            {!isLast && (
              <button
                type="button"
                onClick={finish}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Skip
              </button>
            )}
            <Button
              className="ml-auto min-w-32 gap-2"
              disabled={isPending}
              onClick={current === "ai" ? handleSaveKey : next}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {current === "ai"
                ? apiKey.trim()
                  ? "Save & continue"
                  : "I'll do this later"
                : isLast
                  ? "Start cooking"
                  : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
