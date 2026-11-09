"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  /** Rendered at the end of the label row, e.g. "Forgot password?". */
  aside?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

const inputClass =
  "h-11 w-full rounded-[10px] border border-line bg-transparent px-3.5 text-[15px] text-text placeholder:text-faint transition-colors hover:border-[#3a3170] focus:border-primary focus:outline-none";

export function AuthField({ id, label, error, aside, type, className, ...props }: AuthFieldProps) {
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(inputClass, isPassword && "pr-12", error && "border-accent", className)}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-faint hover:text-text"
          >
            {shown ? <EyeOff className="size-[18px]" strokeWidth={1.8} aria-hidden /> : <Eye className="size-[18px]" strokeWidth={1.8} aria-hidden />}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[10px] border border-accent/60 bg-accent/10 px-3 py-2.5 text-sm text-text">
      {message}
    </p>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-[10px] border border-line bg-surface px-3 py-2.5 text-sm text-muted">
      {children}
    </p>
  );
}

/** Full-width submit button; reads as quiet until the form has input, like the design. */
export function SubmitButton({ ready, pending, children }: { ready: boolean; pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "mt-2 h-11 w-full rounded-[10px] text-[15px] font-semibold transition-[background-color,color,box-shadow] duration-200 disabled:cursor-not-allowed",
        ready
          ? "bg-primary text-white hover:shadow-[0_8px_24px_rgba(112,92,187,0.35)] disabled:opacity-70"
          : "bg-surface text-faint hover:bg-surface-2 hover:text-muted",
      )}
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-4 text-[13px] text-faint" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-line" />
      OR
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export const textLink = "font-medium text-highlight underline decoration-highlight/40 underline-offset-4 hover:decoration-highlight";
