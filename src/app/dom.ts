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

/** Plays the `.leaving` exit animation from page.ts, then removes the node. */
export function leave(node: HTMLElement, ms = 260): void {
  node.classList.add("leaving");
  const done = (): void => node.remove();
  node.addEventListener("animationend", (ev) => {
    if (ev.target === node) done();
  });
  setTimeout(done, ms);
}
