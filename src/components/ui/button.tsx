import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/*
 * Vicaria Care component contracts: primary = family-berry with deep hover;
 * secondary = leaf-soft surface with leaf-green text (never grey); 8px radius.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "bg-success-soft text-success border border-success/20 hover:border-success/40",
  ghost: "text-foreground hover:bg-warm",
  danger: "bg-danger text-white hover:opacity-90",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
