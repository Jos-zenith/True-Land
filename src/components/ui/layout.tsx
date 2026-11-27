"use client";

import Link from "next/link";
import { ChevronRight, Menu as MenuIcon } from "lucide-react";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { useShell } from "@/components/shell/shell-context";

/** 44px header bar at the top of the main panel: breadcrumbs left, contextual actions right. */
export function PageHeader({ crumbs, actions, children }: { crumbs: { label: ReactNode; href?: string }[]; actions?: ReactNode; children?: ReactNode }) {
  const { openMobileNav } = useShell();
  return (
    <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 border-b border-hairline bg-panel/95 px-3 backdrop-blur md:px-5">
      <button aria-label="Open navigation" onClick={openMobileNav} className="-ml-1 rounded-[6px] p-1.5 text-meta hover:bg-hover hover:text-label md:hidden">
        <MenuIcon size={16} />
      </button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className={clsx("flex min-w-0 items-center gap-1.5", !last && "max-sm:hidden")}>
              {i > 0 && <ChevronRight size={13} className={clsx("shrink-0 text-meta", i === crumbs.length - 1 && "max-sm:hidden")} aria-hidden />}
              {c.href && !last ? (
                <Link href={c.href} className="truncate rounded-[4px] text-meta transition-colors hover:text-label">
                  {c.label}
                </Link>
              ) : (
                <span className={clsx("truncate", last ? "font-[510] text-figure" : "text-meta")} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}

export function PageIntro({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-4 pt-6 md:px-6">
      <div className="min-w-0">
        <h1 className="text-[20px] font-[590] leading-tight tracking-[-0.015em] text-figure">{title}</h1>
        {description && <p className="mt-1 max-w-[640px] text-[13px] text-meta">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PropertyList({ children, title = "Properties" }: { children: ReactNode; title?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-[13px] text-meta">{title}</h2>
      <dl className="flex flex-col">{children}</dl>
    </section>
  );
}

export function PropertyRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-baseline gap-3 py-[7px] text-[13px]">
      <dt className="text-meta">{label}</dt>
      <dd className="min-w-0 break-words text-label">{children}</dd>
    </div>
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <h2 className="text-[13px] font-[590] text-figure">{children}</h2>
      {aside && <div className="text-xs text-meta">{aside}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-[9px] border border-hairline bg-panel", className)}>{children}</div>;
}
