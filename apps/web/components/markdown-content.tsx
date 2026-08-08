"use client";

import type { ReactNode } from "react";

// ─── Lightweight markdown renderer ───────────────────────────────────────────
//
// AI answers come back as markdown. Rather than pull in a full parser for the
// small subset the models actually use, this handles bold, italics, headings,
// bullet lists and numbered lists. Anything else renders as plain text.

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type Block =
  | { type: "p" | "ul" | "ol"; items: string[] }
  | { type: "h"; items: string[]; level: number };

export function MarkdownContent({
  text,
  className = "text-sm leading-relaxed space-y-1.5",
}: {
  text: string;
  className?: string;
}) {
  const blocks: Block[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    // Bullets may be indented for nesting; treat them all as one flat list.
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.+)/);
    const last = blocks[blocks.length - 1];

    if (headingMatch) {
      blocks.push({ type: "h", items: [headingMatch[2]], level: headingMatch[1].length });
    } else if (ulMatch) {
      if (last?.type === "ul") last.items.push(ulMatch[1]);
      else blocks.push({ type: "ul", items: [ulMatch[1]] });
    } else if (olMatch) {
      if (last?.type === "ol") last.items.push(olMatch[1]);
      else blocks.push({ type: "ol", items: [olMatch[1]] });
    } else {
      blocks.push({ type: "p", items: [line] });
    }
  }

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.type === "ul")
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        if (block.type === "ol")
          return (
            <ol key={i} className="list-decimal space-y-0.5 pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        if (block.type === "h")
          return (
            <p
              key={i}
              className={`font-semibold ${block.level <= 2 ? "text-base" : "text-sm"} pt-1`}
            >
              {renderInline(block.items[0])}
            </p>
          );
        return <p key={i}>{renderInline(block.items[0])}</p>;
      })}
    </div>
  );
}
