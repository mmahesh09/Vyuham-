import type { ButtonHTMLAttributes, InputHTMLAttributes, Ref } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" };

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary"
          ? "btn-lift bg-primary font-semibold text-white"
          : "border border-line bg-transparent font-medium text-text hover:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  error?: string;
  ref?: Ref<HTMLInputElement>;
};

export function Field({ label, id, error, className, ...props }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "min-h-11 rounded-[10px] border border-line bg-bg px-3 text-[15px] text-text placeholder:text-faint focus:border-primary focus:outline-none",
          error && "border-line",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
