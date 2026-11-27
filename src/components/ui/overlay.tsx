"use client";

import * as RD from "@radix-ui/react-dialog";
import * as RM from "@radix-ui/react-dropdown-menu";
import * as RP from "@radix-ui/react-popover";
import * as RT from "@radix-ui/react-tooltip";
import { clsx } from "clsx";
import { Check, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { Kbd } from "./button";

/* ---------------- Tooltip ---------------- */

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RT.Provider>
  );
}

export function Tip({ content, children, side = "top", kbd }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; kbd?: string }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] flex max-w-[280px] animate-fade-in items-center gap-2 rounded-[6px] border border-hairline-strong bg-raised px-2 py-1 text-xs leading-snug text-label shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          <span>{content}</span>
          {kbd && <Kbd>{kbd}</Kbd>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

/* ---------------- Dialog ---------------- */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
  hideTitle,
  initialFocus,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  hideTitle?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/60" />
        <RD.Content
          onOpenAutoFocus={(e) => {
            if (initialFocus?.current) {
              e.preventDefault();
              initialFocus.current.focus();
            }
          }}
          className="fixed left-1/2 top-[14vh] z-50 max-h-[80vh] w-[calc(100vw-24px)] -translate-x-1/2 animate-pop-in overflow-y-auto rounded-[12px] border border-hairline-strong bg-raised shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
          style={{ maxWidth: width }}
        >
          <div className="px-5 pt-5">
            <RD.Title className={clsx("text-[15px] font-[590] text-figure", hideTitle && "sr-only")}>{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1.5 text-[13px] text-meta">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RD.Description>
            )}
          </div>
          {children && <div className="px-5 pt-4">{children}</div>}
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5 pt-5">{footer}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/* ---------------- Side sheet (360 px) ---------------- */

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 360,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
        <RD.Content
          className="fixed bottom-2 right-2 top-2 z-50 flex w-[calc(100vw-16px)] animate-slide-in flex-col rounded-[10px] border border-hairline-strong bg-raised shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
          style={{ maxWidth: width }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <RD.Title className="text-[14px] font-[590] text-figure">{title}</RD.Title>
              {description ? <RD.Description className="mt-0.5 text-xs text-meta">{description}</RD.Description> : <RD.Description className="sr-only">Side sheet</RD.Description>}
            </div>
            <RD.Close aria-label="Close" className="rounded-[6px] p-1 text-meta hover:bg-hover hover:text-label">
              <X size={15} />
            </RD.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/* ---------------- Dropdown menu ---------------- */

const menuContent =
  "z-[60] min-w-[200px] animate-pop-in overflow-hidden rounded-[8px] border border-hairline-strong bg-raised p-1 text-[13px] text-label shadow-[0_12px_32px_rgba(0,0,0,0.5)]";
const menuItem =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-[5px] px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-active data-[highlighted]:text-figure";

export const Menu = RM.Root;
export const MenuTrigger = RM.Trigger;

export function MenuContent({ children, align = "end", className, sideOffset = 6 }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string; sideOffset?: number }) {
  return (
    <RM.Portal>
      <RM.Content align={align} sideOffset={sideOffset} collisionPadding={8} className={clsx(menuContent, className)}>
        {children}
      </RM.Content>
    </RM.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, kbd, disabled, danger }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; kbd?: string; disabled?: boolean; danger?: boolean }) {
  return (
    <RM.Item className={clsx(menuItem, danger && "text-bad-text")} onSelect={onSelect} disabled={disabled}>
      {icon && <span className="flex w-4 justify-center text-meta">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {kbd && <span className="text-xs text-meta">{kbd}</span>}
    </RM.Item>
  );
}

export function MenuCheckItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <RM.CheckboxItem
      className={menuItem}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      onSelect={(e) => e.preventDefault()}
    >
      <span className={clsx("flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border", checked ? "border-accent bg-accent" : "border-control")}>
        {checked && <Check size={11} strokeWidth={3} className="text-white" />}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </RM.CheckboxItem>
  );
}

export function MenuSub({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <RM.Sub>
      <RM.SubTrigger className={clsx(menuItem, "data-[state=open]:bg-active")}>
        {icon && <span className="flex w-4 justify-center text-meta">{icon}</span>}
        <span className="flex-1">{label}</span>
        <ChevronRight size={13} className="text-meta" />
      </RM.SubTrigger>
      <RM.Portal>
        <RM.SubContent sideOffset={6} collisionPadding={8} className={menuContent}>
          {children}
        </RM.SubContent>
      </RM.Portal>
    </RM.Sub>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RM.Label className="px-2 pb-1 pt-1.5 text-xs text-meta">{children}</RM.Label>;
}

export function MenuSeparator() {
  return <RM.Separator className="-mx-1 my-1 h-px bg-hairline" />;
}

/* ---------------- Popover ---------------- */

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export function PopoverContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <RP.Portal>
      <RP.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={clsx("z-[60] animate-pop-in rounded-[9px] border border-hairline-strong bg-raised p-3 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.5)]", className)}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}
export const PopoverClose = RP.Close;
