import type { EndpointDoc } from "@/lib/integrations-catalog";

export function MethodBadge({ method }: { method: EndpointDoc["method"] }) {
  return (
    <span
      className={`inline-block w-12 shrink-0 rounded-md py-0.5 text-center font-mono text-xs font-bold text-white shadow-sm ${
        method === "GET" ? "bg-gradient-to-br from-sky-500 to-blue-600" : "bg-gradient-to-br from-orange-500 to-rose-500"
      }`}
    >
      {method}
    </span>
  );
}
