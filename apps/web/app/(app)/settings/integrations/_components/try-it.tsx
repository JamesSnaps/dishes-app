"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Loader2, Send } from "lucide-react";
import { INTEGRATION_ENDPOINTS, type EndpointDoc } from "@/lib/integrations-catalog";
import { MethodBadge } from "./method-badge";

/** Fired by CreateTokenForm so a freshly minted token can be tried immediately. */
export const TOKEN_CREATED_EVENT = "dishes:integration-token-created";

type Result = { status: number; ms: number; body: string; json: unknown };

const inputClass =
  "w-full rounded-lg border border-orange-200 bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-400 dark:border-orange-900/60";

function defaultParams(ep: EndpointDoc): Record<string, string> {
  return Object.fromEntries((ep.params ?? []).map((p) => [p.name, p.example ?? ""]));
}

function defaultBody(ep: EndpointDoc): string {
  return ep.body ? JSON.stringify(ep.body.example, null, 2) : "";
}

/** Recipes mentioned anywhere in a response, so they can be opened with getRecipe in one tap. */
function findRecipes(value: unknown, found = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    value.forEach((v) => findRecipes(v, found));
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const recipe = obj.recipe as Record<string, unknown> | undefined;
    if (recipe && typeof recipe.id === "string" && typeof recipe.title === "string" && !("ingredients" in recipe)) {
      found.set(recipe.id, recipe.title);
    }
    if (typeof obj.recipeId === "string" && typeof obj.recipeTitle === "string") {
      found.set(obj.recipeId, obj.recipeTitle);
    }
    Object.values(obj).forEach((v) => findRecipes(v, found));
  }
  return found;
}

export function TryIt() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [endpointId, setEndpointId] = useState(INTEGRATION_ENDPOINTS[0]!.id);
  const ep = INTEGRATION_ENDPOINTS.find((e) => e.id === endpointId)!;
  const [params, setParams] = useState<Record<string, string>>(() => defaultParams(ep));
  const [body, setBody] = useState(() => defaultBody(ep));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onCreated(e: Event) {
      setToken((e as CustomEvent<string>).detail);
    }
    window.addEventListener(TOKEN_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(TOKEN_CREATED_EVENT, onCreated);
  }, []);

  function selectEndpoint(id: string, overrides?: Record<string, string>) {
    const next = INTEGRATION_ENDPOINTS.find((e) => e.id === id)!;
    setEndpointId(id);
    setParams({ ...defaultParams(next), ...overrides });
    setBody(defaultBody(next));
    setError(null);
  }

  function buildUrl(): string | null {
    let path = ep.path;
    const query = new URLSearchParams();
    for (const p of ep.params ?? []) {
      const value = params[p.name]?.trim() ?? "";
      if (p.in === "path") {
        if (!value) return null;
        path = path.replace(`{${p.name}}`, encodeURIComponent(value));
      } else if (value) {
        query.set(p.name, value);
      }
    }
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  }

  async function send() {
    setError(null);
    const url = buildUrl();
    if (!token.trim()) return setError("Paste a token first.");
    if (!url) return setError("Fill in the path parameter.");
    if (ep.body) {
      try {
        JSON.parse(body);
      } catch {
        return setError("Request body isn't valid JSON.");
      }
    }

    setLoading(true);
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: ep.method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: "application/json",
          ...(ep.body ? { "Content-Type": "application/json" } : {}),
        },
        body: ep.body ? body : undefined,
      });
      const text = await res.text();
      let json: unknown = null;
      let pretty = text;
      try {
        json = JSON.parse(text);
        pretty = JSON.stringify(json, null, 2);
      } catch {
        // Non-JSON (e.g. a proxy error page) — show it raw.
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), body: pretty, json });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const recipes = result?.status && result.status < 300 ? [...findRecipes(result.json)] : [];
  const statusOk = result && result.status < 300;

  return (
    <div className="rounded-xl border border-orange-200/70 bg-gradient-to-br from-orange-50 via-card to-rose-50/50 p-4 shadow-sm dark:border-orange-900/40 dark:from-orange-950/30 dark:to-rose-950/20">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Token</label>
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste an integration token"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              aria-label={showToken ? "Hide token" : "Show token"}
              className="shrink-0 rounded-lg border border-orange-200 bg-background px-3 text-muted-foreground shadow-sm hover:text-foreground dark:border-orange-900/60"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Only kept on this page — never saved. Creating a token below fills it in automatically.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Endpoint</label>
          <select value={endpointId} onChange={(e) => selectEndpoint(e.target.value)} className={inputClass}>
            {INTEGRATION_ENDPOINTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.method} {e.path.replace("/api/integrations", "")} — {e.summary}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-background/70 px-3 py-2">
          <MethodBadge method={ep.method} />
          <code className="min-w-0 flex-1 break-all text-xs">{buildUrl() ?? ep.path}</code>
        </div>

        {(ep.params ?? []).map((p) => (
          <div key={p.name}>
            <label className="mb-1 block text-sm font-medium">
              {p.name} <span className="text-xs font-normal text-muted-foreground">({p.in}{p.required ? ", required" : ""})</span>
            </label>
            <input
              value={params[p.name] ?? ""}
              onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
              placeholder={p.schema.format === "date" ? "YYYY-MM-DD" : p.schema.format === "uuid" ? "Recipe id from /today or /meal-plan/week" : ""}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
          </div>
        ))}

        {ep.body && (
          <div>
            <label className="mb-1 block text-sm font-medium">Request body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={Math.min(12, body.split("\n").length + 1)}
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
        )}

        {ep.method === "POST" && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {ep.costly
              ? "This runs for real: it generates recipes with your AI key (uses credit, can take a minute or more) and writes them into the meal plan."
              : "This runs for real and changes your household's data."}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? "Sending…" : "Send request"}
        </button>
      </div>

      {result && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-mono font-bold text-white ${statusOk ? "bg-emerald-500" : "bg-rose-500"}`}
            >
              {result.status}
            </span>
            <span className="text-muted-foreground">{result.ms} ms</span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100 shadow-inner">
            {result.body || "(empty response)"}
          </pre>
          {recipes.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-muted-foreground">Fetch the full recipe:</p>
              <div className="flex flex-wrap gap-1.5">
                {recipes.map(([id, title]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      selectEndpoint("getRecipe", { id });
                      setResult(null);
                    }}
                    className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-800 transition-colors hover:bg-sky-500/25 dark:text-sky-200"
                  >
                    {title} →
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
