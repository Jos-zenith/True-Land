import type { ListGroup } from "./views";

/** Client-safe copy of the list group labels (no server imports). */
export const GROUP_LABEL: Record<ListGroup, string> = {
  draft: "Draft",
  calc_failed: "Calculation failed",
  choose_route: "Choose route",
  awaiting_receipt: "Awaiting receipt",
  reply_overdue: "Reply overdue",
  no_reply: "No reply",
  refused: "Refused",
  reconciled: "Reconciled",
};
