"use client";

import { useEffect, useRef } from "react";

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]');
}

/**
 * Global keyboard shortcuts (wireframe: Behaviour → Shortcuts).
 * ⌘K / Ctrl K opens the command menu everywhere. Single keys and "G then X" sequences are
 * off while typing or while a dialog or menu is open.
 */
export function useShortcuts(handlers: { command: () => void; compose: () => void; go: (key: string) => boolean; toggleSidebar: () => void }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current.command();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTyping(e.target) || overlayOpen()) return;
      const k = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        if (ref.current.go(k)) e.preventDefault();
        return;
      }
      if (k === "g") {
        pendingG = Date.now();
        return;
      }
      if (k === "c") {
        e.preventDefault();
        ref.current.compose();
      } else if (k === "[") {
        e.preventDefault();
        ref.current.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export const GO_KEYS: Record<string, { href: string; label: string }> = {
  h: { href: "/overview", label: "Overview" },
  o: { href: "/my-checks", label: "My checks" },
  a: { href: "/checks", label: "All checks" },
  i: { href: "/inbox", label: "Inbox" },
  r: { href: "/routes", label: "Route intelligence" },
  m: { href: "/methodology", label: "Methodology" },
  e: { href: "/audit", label: "Evidence & audit" },
  f: { href: "/fees", label: "Fee configuration" },
  d: { href: "/sources", label: "Data sources" },
};
