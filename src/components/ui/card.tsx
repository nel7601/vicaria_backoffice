import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A card is a raised white plane on the cream canvas. The shadow does the
 * separating; the border only draws its edge. Without both, a white card on a
 * near-white page reads as one flat sheet and nothing groups.
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-5 shadow-card",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A card's own heading: full-strength copy, so it outranks the muted text
 * inside it. Secondary lines under a title stay muted.
 */
export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}
