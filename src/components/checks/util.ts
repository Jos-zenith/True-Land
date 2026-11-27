const NAMES: Record<string, string> = {
  bank_a: "Bank A",
  bank_b: "Bank B",
  fintech_a: "Fintech A",
  fintech_b: "Fintech B",
  fintech_x: "Fintech X",
};

export function providerNames(ids: string[]): string {
  return ids.map((i) => NAMES[i] ?? i).join(", ");
}
