"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  BookText,
  ChevronDown,
  CircleHelp,
  Database,
  Inbox,
  LayoutGrid,
  List,
  PanelLeft,
  RotateCcw,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  User,
  Waypoints,
  Keyboard,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useShell } from "./shell-context";
import { Tip, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Kbd } from "@/components/ui/button";

type NavItem = { href: string; label: string; icon: ReactNode; count?: number; kbd?: string; match?: (p: string) => boolean };

export function Sidebar({ collapsed, onNavigate, mobile }: { collapsed: boolean; onNavigate?: () => void; mobile?: boolean }) {
  const { meta, openComposer, openCommand, toggleSidebar } = useShell();
  const pathname = usePathname();
  const router = useRouter();

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: "Workspace",
      items: [
        { href: "/overview", label: "Overview", icon: <LayoutGrid size={15} />, kbd: "G H" },
        { href: "/inbox", label: "Inbox", icon: <Inbox size={15} />, count: meta?.inboxCount, kbd: "G I" },
        { href: "/my-checks", label: "My checks", icon: <User size={15} />, kbd: "G O" },
        { href: "/checks", label: "All checks", icon: <List size={15} />, kbd: "G A", match: (p) => p === "/checks" },
      ],
    },
    {
      title: "Intelligence",
      items: [
        { href: "/routes", label: "Route intelligence", icon: <Waypoints size={15} />, kbd: "G R" },
        { href: "/methodology", label: "Methodology", icon: <BookText size={15} />, kbd: "G M" },
        { href: "/audit", label: "Evidence & audit", icon: <ScrollText size={15} />, kbd: "G E" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { href: "/fees", label: "Fee configuration", icon: <SlidersHorizontal size={15} />, kbd: "G F" },
        { href: "/sources", label: "Data sources", icon: <Database size={15} />, kbd: "G D" },
      ],
    },
  ];

  const isActive = (it: NavItem) => (it.match ? it.match(pathname) : pathname === it.href || pathname.startsWith(`${it.href}/`));

  const row = (it: NavItem) => {
    const active = isActive(it);
    const link = (
      <Link
        key={it.href}
        href={it.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? it.label : undefined}
        className={clsx(
          "group flex h-7 items-center gap-2.5 rounded-[7px] text-[13px] font-[510] transition-colors duration-150",
          collapsed ? "w-9 justify-center" : "px-2",
          active ? "bg-active text-figure" : "text-label/90 hover:bg-hover hover:text-figure",
        )}
      >
        <span className={clsx("relative flex w-4 shrink-0 justify-center", active ? "text-figure" : "text-meta group-hover:text-label")}>
          {it.icon}
          {collapsed && !!it.count && <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-short" aria-hidden />}
        </span>
        {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
        {!collapsed && !!it.count && <span className="tnum text-xs text-meta">{it.count}</span>}
      </Link>
    );
    return collapsed ? (
      <Tip key={it.href} content={`${it.label}${it.count ? ` · ${it.count}` : ""}`} side="right" kbd={it.kbd}>
        {link}
      </Tip>
    ) : (
      link
    );
  };

  return (
    <aside
      aria-label="Main navigation"
      className={clsx("flex h-full flex-col gap-1 py-2.5", collapsed ? "w-14 items-center px-2" : mobile ? "w-full px-3" : "w-[244px] px-3")}
    >
      {/* Workspace + actions */}
      <div className={clsx("flex items-center gap-1 pb-2", collapsed && "flex-col")}>
        <Menu>
          <MenuTrigger asChild>
            <button
              className={clsx("flex min-w-0 items-center gap-2 rounded-[7px] py-1 text-[13px] font-[590] text-figure hover:bg-hover", collapsed ? "justify-center px-1" : "flex-1 px-1.5")}
              aria-label="Workspace menu"
            >
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-accent text-[11px] font-[650] text-white">N</span>
              {!collapsed && (
                <>
                  <span className="truncate">{meta?.workspace.name ?? "Workspace"}</span>
                  <ChevronDown size={13} className="shrink-0 text-meta" />
                </>
              )}
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-[260px]">
            <MenuLabel>Workspace</MenuLabel>
            <div className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
              <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-accent text-[10px] font-[650] text-white">N</span>
              <span className="flex-1 text-figure">{meta?.workspace.name}</span>
              {meta?.workspace.isDemo && <span className="rounded-[4px] border border-hairline-strong px-1.5 text-[11px] text-meta">Demo</span>}
            </div>
            <p className="px-2 pb-1.5 text-xs text-meta">Demo workspace. All figures are illustrative; no real payments.</p>
            <MenuSeparator />
            <MenuItem icon={<Settings size={14} />} onSelect={() => router.push("/settings")}>
              Workspace settings
            </MenuItem>
            <MenuItem icon={<RotateCcw size={14} />} onSelect={() => router.push("/settings#reset")}>
              Reset demo data…
            </MenuItem>
          </MenuContent>
        </Menu>
        <Tip content="Search and commands" kbd="Ctrl K" side={collapsed ? "right" : "bottom"}>
          <button onClick={openCommand} aria-label="Search and commands" className="flex h-7 w-7 items-center justify-center rounded-[7px] text-meta hover:bg-hover hover:text-label">
            <Search size={15} />
          </button>
        </Tip>
        <Tip content="New payment check" kbd="C" side={collapsed ? "right" : "bottom"}>
          <button
            onClick={() => {
              onNavigate?.();
              openComposer();
            }}
            aria-label="New payment check"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-hairline-strong bg-raised text-label hover:bg-hover hover:text-figure"
          >
            <SquarePen size={14} />
          </button>
        </Tip>
      </div>

      <nav className={clsx("flex flex-1 flex-col gap-4 overflow-y-auto no-scrollbar", collapsed && "items-center")}>
        {sections.map((s) => (
          <div key={s.title} className={clsx("flex flex-col gap-0.5", collapsed && "items-center")}>
            {!collapsed ? (
              <div className="px-2 pb-1 text-xs font-[510] text-meta">{s.title}</div>
            ) : (
              <div className="mx-auto mb-1 h-px w-5 bg-hairline" aria-hidden />
            )}
            {s.items.map(row)}
          </div>
        ))}
        {!collapsed && (
          <p className="px-2 pt-1 text-xs leading-relaxed text-meta">
            Illustrative figures only.
            <br />
            We never move money.
          </p>
        )}
      </nav>

      <div className={clsx("flex flex-col gap-0.5 border-t border-hairline pt-2", collapsed && "items-center")}>
        {row({ href: "/help", label: "Help & shortcuts", icon: <CircleHelp size={15} /> })}
        {row({ href: "/settings", label: "Settings", icon: <Settings size={15} /> })}
        <div className={clsx("mt-1 flex items-center gap-1", collapsed && "flex-col")}>
          <Menu>
            <MenuTrigger asChild>
              <button className={clsx("flex min-w-0 items-center gap-2 rounded-[7px] py-1 hover:bg-hover", collapsed ? "justify-center px-1" : "flex-1 px-1.5")} aria-label="Profile menu">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#2f3a64] text-[10px] font-[650] text-[#c8d0ff]">{meta?.user.initials ?? "··"}</span>
                {!collapsed && (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-[510] text-label">{meta?.user.name}</span>
                    <span className="block truncate text-[11px] text-meta">
                      {meta?.user.role}
                      {meta?.user.isAdmin ? " · Admin" : ""}
                    </span>
                  </span>
                )}
              </button>
            </MenuTrigger>
            <MenuContent align="start" className="w-[230px]">
              <MenuLabel>
                {meta?.user.name} · {meta?.user.access}
              </MenuLabel>
              <MenuItem icon={<Settings size={14} />} onSelect={() => router.push("/settings")}>
                Settings
              </MenuItem>
              <MenuItem icon={<Keyboard size={14} />} onSelect={() => router.push("/help#shortcuts")}>
                Keyboard shortcuts
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<LogOut size={14} />}
                onSelect={async () => {
                  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                  window.location.assign("/login");
                }}
              >
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
          {!mobile && (
            <Tip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} kbd="[" side={collapsed ? "right" : "top"}>
              <button onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden h-7 w-7 items-center justify-center rounded-[7px] text-meta hover:bg-hover hover:text-label lg:flex">
                <PanelLeft size={15} />
              </button>
            </Tip>
          )}
        </div>
      </div>
    </aside>
  );
}

export function SidebarKbdHint() {
  return (
    <span className="text-xs text-meta">
      <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
    </span>
  );
}
