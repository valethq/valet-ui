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

/** Patches `from` in place to match `to`. Same-tag elements are kept, so hover,
 * focus, scroll and listeners on them survive. Images are not kept: their src
 * is filled in asynchronously on the fresh node. */
export function morph(from: Element, to: Element): void {
  for (const name of from.getAttributeNames()) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of Array.from(to.attributes))
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  const next = Array.from(to.childNodes);
  const prev = Array.from(from.childNodes);
  next.forEach((n, i) => {
    const old = prev[i];
    const tag = old === undefined ? undefined : tagOf(old);
    if (old === undefined) from.append(n);
    else if (tag !== undefined && tag !== "IMG" && tag === tagOf(n)) morph(old as Element, n as Element);
    else old.replaceWith(n);
  });
  for (const extra of prev.slice(next.length)) extra.remove();
}

const tagOf = (n: Node): string | undefined => (n.nodeType === 1 ? (n as Element).tagName : undefined);

/** Plays the `.leaving` exit animation from page.ts, then removes the node. */
export function leave(node: HTMLElement, ms = 260): void {
  node.classList.add("leaving");
  const done = (): void => node.remove();
  node.addEventListener("animationend", (ev) => {
    if (ev.target === node) done();
  });
  setTimeout(done, ms);
}
