import { ChevronDown } from "lucide-react";
import {
  COMMON_ERRORS,
  INTEGRATION_ENDPOINTS,
  curlExample,
  flattenFields,
  type EndpointDoc,
} from "@/lib/integrations-catalog";
import { CopyButton } from "./copy-button";
import { MethodBadge } from "./method-badge";

function CodeBlock({ code, copy }: { code: string; copy?: boolean }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 pr-20 font-mono text-xs leading-relaxed text-slate-100 shadow-inner">
        {code}
      </pre>
      {copy && <CopyButton text={code} className="absolute right-2 top-2" />}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

function FieldTable({ rows }: { rows: { name: string; type: string; required: boolean; description: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-muted/60">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.name} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">
                {r.name}
                {r.required && <span className="ml-1 text-rose-500">*</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{r.type}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointCard({ ep, origin }: { ep: EndpointDoc; origin: string }) {
  const paramRows = (ep.params ?? []).map((p) => ({
    name: p.in === "path" ? `{${p.name}}` : `?${p.name}`,
    type: p.schema.format ?? p.schema.type ?? "string",
    required: p.required,
    description: p.description,
  }));

  return (
    <details className="group rounded-xl border border-orange-200/70 bg-gradient-to-br from-card via-card to-orange-50/60 shadow-sm open:shadow-md dark:border-orange-900/40 dark:to-orange-950/20">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <MethodBadge method={ep.method} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-semibold">{ep.path.replace("/api/integrations", "")}</p>
          <p className="truncate text-xs text-muted-foreground">{ep.summary}</p>
        </div>
        <code className="hidden shrink-0 rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-700 sm:inline dark:text-orange-300">
          {ep.scope}
        </code>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-orange-200/60 px-4 pb-4 pt-3 dark:border-orange-900/40">
        <p className="font-mono text-xs text-muted-foreground break-all">
          {ep.method} {ep.path}
        </p>
        <p className="mt-2 text-sm">{ep.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Scope: <code className="rounded bg-muted px-1">{ep.scope}</code>
          {" · "}operationId: <code className="rounded bg-muted px-1">{ep.id}</code>
        </p>

        {paramRows.length > 0 && (
          <>
            <SubHeading>Parameters</SubHeading>
            <FieldTable rows={paramRows} />
          </>
        )}

        {ep.body && (
          <>
            <SubHeading>Request body</SubHeading>
            <FieldTable rows={flattenFields(ep.body.schema)} />
            <div className="mt-2">
              <CodeBlock code={JSON.stringify(ep.body.example, null, 2)} />
            </div>
          </>
        )}

        <SubHeading>Response {ep.response.status}</SubHeading>
        <p className="mb-1.5 text-xs text-muted-foreground">{ep.response.description}</p>
        <CodeBlock code={JSON.stringify(ep.response.example, null, 2)} />

        {ep.errors && ep.errors.length > 0 && (
          <>
            <SubHeading>Errors</SubHeading>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {ep.errors.map((e) => (
                <li key={e.status}>
                  <span className="font-mono font-semibold text-foreground">{e.status}</span> — {e.description}
                </li>
              ))}
            </ul>
          </>
        )}

        <SubHeading>curl</SubHeading>
        <CodeBlock code={curlExample(ep, origin)} copy />
      </div>
    </details>
  );
}

export function EndpointReference({ origin }: { origin: string }) {
  return (
    <div className="space-y-2">
      {INTEGRATION_ENDPOINTS.map((ep) => (
        <EndpointCard key={ep.id} ep={ep} origin={origin} />
      ))}
      <div className="rounded-xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Every endpoint can also return</p>
        <ul className="space-y-0.5">
          {COMMON_ERRORS.map((e) => (
            <li key={e.status}>
              <span className="font-mono font-semibold text-foreground">{e.status}</span> — {e.description}
            </li>
          ))}
        </ul>
        <p className="mt-1">
          Errors are always <code className="rounded bg-muted px-1">{`{ "error": "message" }`}</code>.
        </p>
      </div>
    </div>
  );
}
