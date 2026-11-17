const KEY = "valet-ui.project-order";

export function loadOrder(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveOrder(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {}
}

/** Projects in the saved order; ones the saved order doesn't know keep their server order, after the known ones. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (p: T): number => rank.get(p.id) ?? order.length;
  return items
    .map((p, i) => ({ p, i }))
    .sort((a, b) => at(a.p) - at(b.p) || a.i - b.i)
    .map((x) => x.p);
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [it] = next.splice(from, 1);
  if (it === undefined || to < 0 || to >= items.length) return items;
  next.splice(to, 0, it);
  return next;
}
