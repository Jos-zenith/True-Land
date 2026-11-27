"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-shimmer rounded-[6px] bg-group", className)} />;
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx("flex flex-col", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-4 border-b border-hairline px-6">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1 max-w-[280px]" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, icon, className }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-start gap-2 px-6 py-10", className)}>
      {icon && <div className="mb-1 text-meta">{icon}</div>}
      <h3 className="text-[14px] font-[590] text-figure">{title}</h3>
      {body && <p className="max-w-[460px] text-[13px] text-meta">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-10" role="alert">
      <h3 className="text-[14px] font-[590] text-figure">{title}</h3>
      <p className="max-w-[460px] text-[13px] text-meta">{message}</p>
      {onRetry && (
        <Button className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action, className }: { tone?: "info" | "warn" | "error" | "short"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = tone === "error" ? CircleAlert : tone === "info" ? Info : TriangleAlert;
  const color = tone === "error" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "short" ? "text-short" : "text-meta";
  return (
    <div className={clsx("flex gap-2.5 rounded-[9px] border border-hairline bg-group/60 px-3.5 py-3", className)} role={tone === "error" ? "alert" : undefined}>
      <Icon size={15} className={clsx("mt-[2px] shrink-0", color)} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px]">
        {title && <div className="font-[590] text-figure">{title}</div>}
        {children && <div className={clsx("text-meta", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
