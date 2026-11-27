"use client";

import * as RD from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Sidebar } from "./sidebar";
import { CommandMenu } from "./command-menu";
import { ShellContext, type ComposerOptions, type Meta } from "./shell-context";
import { Composer } from "@/components/checks/composer";
import { RateDialog } from "@/components/checks/rate-dialog";
import { TipProvider } from "@/components/ui/overlay";
import { ToastProvider } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { mergeDemoNicknames } from "@/hooks/use-nicknames";
import { GO_KEYS, useShortcuts } from "@/hooks/use-shortcuts";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TipProvider>
      <ToastProvider>
        <ShellInner>{children}</ShellInner>
      </ToastProvider>
    </TipProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: meta } = useApi<Meta>("/api/meta");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [command, setCommand] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; options: ComposerOptions }>({ open: false, options: { mode: "create" } });
  const [rate, setRate] = useState<{ open: boolean; onDone?: () => void }>({ open: false });
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem("landed:sidebar") === "collapsed");
  }, []);
  useEffect(() => {
    if (meta?.demoNicknames) mergeDemoNicknames(meta.demoNicknames);
  }, [meta?.demoNicknames]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem("landed:sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }, []);

  const openComposer = useCallback((options: ComposerOptions = { mode: "create" }) => {
    opener.current = document.activeElement as HTMLElement | null;
    setComposer({ open: true, options });
  }, []);
  const openCommand = useCallback(() => setCommand(true), []);
  const openMobileNav = useCallback(() => setMobileNav(true), []);
  const openRateDialog = useCallback((onDone?: () => void) => setRate({ open: true, onDone }), []);

  useShortcuts({
    command: () => setCommand((o) => !o),
    compose: () => openComposer(),
    toggleSidebar,
    go: (k) => {
      const t = GO_KEYS[k];
      if (!t) return false;
      router.push(t.href);
      return true;
    },
  });

  return (
    <ShellContext.Provider value={{ meta, openComposer, openCommand, openMobileNav, openRateDialog, sidebarCollapsed: collapsed, toggleSidebar }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-[6px] focus:bg-accent focus:px-3 focus:py-1.5 focus:text-white">
        Skip to content
      </a>
      <div className="flex h-dvh overflow-hidden bg-window">
        {/* Desktop: full sidebar (or rail when collapsed). Tablet 768–1023: 56 px icon rail. Mobile: drawer. */}
        <div className={clsx("hidden shrink-0 md:flex lg:hidden")}>
          <Sidebar collapsed />
        </div>
        <div className="hidden shrink-0 lg:flex">
          <Sidebar collapsed={collapsed} />
        </div>
        <main id="main" className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel md:rounded-[10px] md:border md:border-hairline">{children}</div>
        </main>
      </div>

      <RD.Root open={mobileNav} onOpenChange={setMobileNav}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/60 md:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] animate-slide-in border-r border-hairline bg-window md:hidden" aria-label="Navigation">
            <RD.Title className="sr-only">Navigation</RD.Title>
            <RD.Description className="sr-only">Main navigation</RD.Description>
            <Sidebar collapsed={false} mobile onNavigate={() => setMobileNav(false)} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <CommandMenu open={command} onOpenChange={setCommand} />
      <Composer
        open={composer.open}
        options={composer.options}
        onOpenChange={(o) => {
          setComposer((c) => ({ ...c, open: o }));
          if (!o) setTimeout(() => opener.current?.focus?.(), 0);
        }}
      />
      <RateDialog
        open={rate.open}
        onOpenChange={(o) => setRate((r) => ({ ...r, open: o }))}
        onDone={() => {
          rate.onDone?.();
          setRate({ open: false });
        }}
      />
    </ShellContext.Provider>
  );
}
