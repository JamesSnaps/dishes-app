import type { EndpointDoc } from "@/lib/integrations-catalog";

export function MethodBadge({ method }: { method: EndpointDoc["method"] }) {
  return (
    <span
      className={`inline-block w-12 shrink-0 rounded-md py-0.5 text-center font-mono text-xs font-bold text-background shadow-sm ${
        method === "GET" ? "bg-ink" : "bg-primary"
      }`}
    >
      {method}
    </span>
  );
}
