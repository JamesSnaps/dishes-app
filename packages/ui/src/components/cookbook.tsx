import * as React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/utils";
import { Button, type ButtonProps } from "./button";

// Small pieces of the Cookbook design system (DESIGN.md → Components) that
// the shadcn set doesn't have.

/** The small-caps overline: "BREAKFAST", "TONIGHT · 6:30PM", "JAPANESE · MAIN". */
export interface SectionLabelProps extends React.HTMLAttributes<HTMLParagraphElement> {
  tone?: "muted" | "brand";
}

export const SectionLabel = React.forwardRef<HTMLParagraphElement, SectionLabelProps>(
  ({ className, tone = "muted", ...props }, ref) => (
    <p
      ref={ref}
      className={cn(
        "text-[11px] font-bold uppercase leading-tight tracking-[0.1em]",
        tone === "brand" ? "text-primary" : "text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);
SectionLabel.displayName = "SectionLabel";

/**
 * A food image on the `plate` background. Without a photo it draws an empty
 * plate rather than a grey box with an icon. Size it with className
 * (`aspect-square w-full rounded-2xl`, `size-12 rounded-xl`…).
 */
export interface PlateProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt: string;
}

export const Plate = React.forwardRef<HTMLDivElement, PlateProps>(
  ({ src, alt, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative flex items-center justify-center overflow-hidden bg-plate", className)}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex aspect-square w-[62%] items-center justify-center rounded-full bg-card shadow-[0_6px_14px_rgb(70_45_20/0.18)]"
        >
          <div className="aspect-square w-[64%] rounded-full bg-plate" />
        </div>
      )}
    </div>
  )
);
Plate.displayName = "Plate";

/**
 * The one way AI features are marked: an ink pill with the sparkle. No
 * `asChild`: the icon plus children can't go into Radix's single-child Slot.
 * For a link, use `<Button asChild variant="ink">` with the Sparkles icon inside.
 */
export const AiButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "variant" | "asChild">>(
  ({ children, ...props }, ref) => (
    <Button ref={ref} variant="ink" {...props}>
      <Sparkles aria-hidden="true" />
      {children}
    </Button>
  )
);
AiButton.displayName = "AiButton";
