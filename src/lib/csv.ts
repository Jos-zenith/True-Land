/**
 * CSV cell encoding (RFC 4180) with spreadsheet formula-injection protection: a cell starting with
 * = + - @ tab or CR is prefixed with an apostrophe, unless it is a plain number such as "-115".
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** Insert the supplier nickname row after the supplier_id row, in the browser (the server never sees it). */
export function withNicknameRow(csv: string, nickname: string): string {
  const lines = csv.split("\r\n");
  const at = lines.findIndex((l) => l.startsWith("check,supplier_id,"));
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, csvRow(["check", "supplier_nickname", nickname]));
  return lines.join("\r\n");
}
