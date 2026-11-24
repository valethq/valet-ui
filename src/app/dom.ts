export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

/** Whether `parent`'s children are exactly `nodes`, in order. */
export function sameChildren(parent: HTMLElement, nodes: HTMLElement[]): boolean {
  const kids = parent.children;
  return kids.length === nodes.length && nodes.every((n, i) => kids[i] === n);
}

/** Makes `nodes` the children of `parent` without detaching ones already in
 * place, so their CSS animations, scroll and selection are left alone. */
export function reconcile(parent: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set<Element>(nodes);
  for (const c of [...parent.children]) if (!keep.has(c)) c.remove();
  nodes.forEach((n, i) => {
    const at = parent.children[i] ?? null;
    if (at !== n) parent.insertBefore(n, at);
  });
}

/** Patches `from` in place to match `to`. Same-tag elements and text nodes are
 * kept, so hover, focus, scroll, selection and listeners on them survive. An
 * image is kept while it shows the same `data-blob` (its src is filled in
 * asynchronously, so a fresh node would flash empty and decode again).
 * `onInsert` sees each element that was added or swapped in, after it is connected. */
export function morph(from: Element, to: Element, onInsert?: (n: Element) => void): void {
  for (const name of from.getAttributeNames()) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of Array.from(to.attributes))
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  const next = Array.from(to.childNodes);
  const prev = Array.from(from.childNodes);
  next.forEach((n, i) => {
    const old = prev[i];
    if (old === undefined) from.append(n);
    else if (old.nodeType === 3 && n.nodeType === 3) {
      patchText(old as Text, n as Text);
      return;
    } else if (sameElement(old, n)) {
      if ((old as Element).tagName !== "IMG") morph(old as Element, n as Element, onInsert);
      return;
    } else old.replaceWith(n);
    if (n.nodeType === 1) onInsert?.(n as Element);
  });
  for (const extra of prev.slice(next.length)) extra.remove();
}

/** Streamed text only grows, so the new tail is appended: a selection inside the text survives. */
function patchText(old: Text, next: Text): void {
  const was = old.data;
  const now = next.data;
  if (was === now) return;
  if (now.startsWith(was)) old.appendData(now.slice(was.length));
  else old.data = now;
}

function sameElement(a: Node, b: Node): boolean {
  if (a.nodeType !== 1 || b.nodeType !== 1) return false;
  const x = a as Element;
  const y = b as Element;
  if (x.tagName !== y.tagName) return false;
  if (x.tagName !== "IMG") return true;
  const blob = y.getAttribute("data-blob");
  return blob !== null && x.getAttribute("data-blob") === blob;
}

/** Plays the `.leaving` exit animation from page.ts, then runs `then` (by default removing the node) once. */
export function leave(node: HTMLElement, ms = 460, then: () => void = () => node.remove()): void {
  node.classList.add("leaving");
  let ran = false;
  const onEnd = (ev: AnimationEvent): void => {
    if (ev.target === node) done();
  };
  const done = (): void => {
    if (ran) return;
    ran = true;
    node.removeEventListener("animationend", onEnd);
    then();
  };
  node.addEventListener("animationend", onEnd);
  setTimeout(done, ms);
}

/** The hide in flight per node; a newer show or hide supersedes it. */
const hiding = new WeakMap<HTMLElement, object>();

/** Shows or hides `node` through `style.display`. Showing replays its CSS entrance; hiding plays the generic
 * `.fx-out` exit first (instantly when detached). Showing again mid-exit cancels the hide. */
export function setShown(node: HTMLElement, on: boolean): void {
  if (on) {
    if (hiding.delete(node)) node.classList.remove("leaving", "fx-out");
    node.style.display = "";
    return;
  }
  if (node.style.display === "none" || hiding.has(node)) return;
  if (node.isConnected !== true) {
    node.style.display = "none";
    return;
  }
  const token = {};
  hiding.set(node, token);
  node.classList.add("fx-out");
  leave(node, 360, () => {
    if (hiding.get(node) !== token) return;
    hiding.delete(node);
    node.classList.remove("leaving", "fx-out");
    node.style.display = "none";
  });
}
