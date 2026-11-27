"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { clsx } from "clsx";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: ReactNode;
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

/** Neutral toast, bottom centre (wireframe: Behaviour → Feedback). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" ? 7000 : 4500);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-[480px] animate-toast-in items-start gap-2.5 rounded-[8px] border border-hairline-strong bg-active px-3.5 py-2.5 text-[13px] text-figure shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
          >
            <span className={clsx("mt-[3px] shrink-0", t.kind === "error" ? "text-bad-text" : "text-label")}>
              {t.kind === "error" ? <CircleAlert size={14} /> : <Check size={14} strokeWidth={2.5} />}
            </span>
            <span className="flex-1 leading-snug">{t.text}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-[5px] px-1.5 text-[13px] font-[510] text-accent-hover hover:bg-hover"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="mt-[1px] shrink-0 rounded-[4px] p-0.5 text-meta hover:text-label">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return {
    success: (text: ReactNode, action?: Toast["action"]) => push({ kind: "success", text, action }),
    error: (text: ReactNode) => push({ kind: "error", text }),
    info: (text: ReactNode) => push({ kind: "info", text }),
  };
}
