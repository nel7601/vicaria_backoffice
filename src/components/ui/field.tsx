import * as React from "react";
import { cn } from "@/lib/utils";

/* Form control contract: warm border, 8px radius, leaf-green focus state. */
export const inputClass =
  "w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm transition-colors focus-visible:border-success focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/25";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";
