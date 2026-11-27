"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown } from "lucide-react";

export const controlClass =
  "h-9 w-full rounded-[6px] border border-control-soft bg-panel px-2.5 text-[13px] text-figure placeholder:text-meta transition-colors duration-150 hover:border-control focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0 aria-[invalid=true]:border-bad disabled:opacity-50";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  optional,
  className,
}: {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] text-meta">
        {label}
        {optional && <span className="ml-1 text-meta/80">· optional</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-bad-text">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-meta">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string }>(function Input(
  { className, invalid, prefix, ...rest },
  ref,
) {
  if (prefix) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-meta">{prefix}</span>
        <input ref={ref} aria-invalid={invalid || undefined} className={clsx(controlClass, "tnum pl-11", className)} {...rest} />
      </div>
    );
  }
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(controlClass, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={clsx(controlClass, "appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-meta" />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(controlClass, "h-auto min-h-[72px] resize-y py-2 leading-relaxed", className)} {...rest} />;
});

/** Segmented control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={clsx("inline-flex rounded-[8px] border border-hairline-strong p-[3px]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={active}
            disabled={o.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const enabled = options.filter((x) => !x.disabled);
              const i = enabled.findIndex((x) => x.value === value);
              const next = enabled[(i + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
              onChange(next.value);
              const parent = e.currentTarget.parentElement;
              requestAnimationFrame(() => (parent?.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus());
            }}
            className={clsx(
              "rounded-[6px] font-[510] transition-colors duration-150 disabled:opacity-40",
              size === "md" ? "h-7 px-3 text-[13px]" : "h-6 px-2 text-xs",
              active ? "bg-active text-figure shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]" : "text-meta hover:text-label",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string; disabled?: boolean }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className={clsx("inline-flex cursor-default items-center gap-2 text-[13px] text-label", disabled && "opacity-50")}>
      <span className="relative inline-flex">
        <input id={cid} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span
          className={clsx(
            "flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            checked ? "border-accent bg-accent" : "border-control bg-transparent",
          )}
        >
          {checked && <Check size={11} strokeWidth={3} className="text-white" />}
        </span>
      </span>
      {label}
    </label>
  );
}

export function Radio({ checked, onChange, label, name, value, disabled, hint }: { checked: boolean; onChange: () => void; label: ReactNode; name: string; value: string; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={clsx("inline-flex cursor-default items-center gap-2 text-[13px] text-label", disabled && "opacity-50")}>
      <span className="relative inline-flex">
        <input id={id} type="radio" name={name} value={value} className="peer sr-only" checked={checked} disabled={disabled} onChange={onChange} />
        <span
          className={clsx(
            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            checked ? "border-accent" : "border-control",
          )}
        >
          {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
      </span>
      <span>
        {label}
        {hint && <span className="ml-1 text-meta">{hint}</span>}
      </span>
    </label>
  );
}
