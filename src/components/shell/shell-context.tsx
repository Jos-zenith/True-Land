"use client";

import { createContext, useContext } from "react";
import type { RateSnapshot } from "@/engine/types";

export interface Meta {
  workspace: { id: string; name: string; isDemo: boolean; corridor: string };
  user: { id: string; name: string; role: string; initials: string; isAdmin: boolean; access: "admin" | "member" | "viewer" };
  /** UI affordances only; the server enforces every permission. */
  permissions: Record<string, boolean>;
  pseudonymKey: string;
  verification: { demo: boolean; live: boolean };
  seededAt: string;
  today: string;
  now: number;
  calcVersion: string;
  rate: (RateSnapshot & { hours: number; stale: boolean; warn: boolean }) | null;
  schedule: { version: number; publishedAt: string };
  inboxCount: number;
  providers: readonly { id: string; name: string; kind: string }[];
  freshness: { rateStaleAfterHours: number; rateWarnAfterHours: number; scheduleStaleAfterDays: number; replyWindowDays: number };
  demoNicknames: Record<string, string>;
  checkRefs: { id: string; supplierHash: string; status: string; archived: boolean }[];
}

export interface ComposerOptions {
  mode: "create" | "edit";
  checkId?: string;
  prefill?: Partial<{
    nickname: string;
    invoiceAmount: string;
    invoiceCurrency: "MXN" | "USD";
    sendAmount: string;
    payBy: string;
    payoutMethod: "spei_mxn" | "usd_account";
    providers: string[];
    invoiceRef: string | null;
    chargeCode: "SHA" | "OUR" | "BEN";
  }>;
}

export interface ShellApi {
  meta: Meta | undefined;
  openComposer: (o?: ComposerOptions) => void;
  openCommand: () => void;
  openMobileNav: () => void;
  openRateDialog: (onDone?: () => void) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const ShellContext = createContext<ShellApi>({
  meta: undefined,
  openComposer: () => {},
  openCommand: () => {},
  openMobileNav: () => {},
  openRateDialog: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
});

export const useShell = () => useContext(ShellContext);
