"use client";

import { createContext, useContext } from "react";
import type { CheckDetailView } from "@/server/views";

export type Detail = CheckDetailView;
export type OptionView = NonNullable<Detail["estimate"]>["options"][number];

export interface CheckCtx {
  id: string;
  detail: Detail;
  nickname: string;
  focusId: string | null;
  setFocusId: (id: string) => void;
  focus: OptionView | null;
  reload: () => Promise<void>;
  openChoice: () => void;
  updateRate: () => void;
}

export const CheckContext = createContext<CheckCtx | null>(null);
export function useCheck(): CheckCtx {
  const c = useContext(CheckContext);
  if (!c) throw new Error("useCheck outside a check page");
  return c;
}
