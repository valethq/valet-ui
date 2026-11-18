/** Sizes of the harness + model mark pair in the model chip, in px. */
export interface PairGeometry {
  /** How far the model mark overlaps the harness mark. */
  overlap: number;
  harness: number;
  model: number;
  /** Gap cut around the model mark's silhouette where it covers the harness. */
  outline: number;
  /** Copies of the silhouette that make up the dilated cutout. */
  directions: number;
}

export const PAIR: PairGeometry = { overlap: 3.25, harness: 13, model: 15, outline: 1.625, directions: 16 };

const px = (n: number): string => `${Number(n.toFixed(3))}px`;

/** Where each silhouette copy sits in the harness mark's box: the model mark's
 * own spot (right of the harness by its width less the overlap, centred
 * vertically) nudged `outline` px out in each of `directions` directions. */
export function cutoutOffsets(g: PairGeometry = PAIR): [string, string][] {
  const x = g.harness - g.overlap;
  const y = (g.harness - g.model) / 2;
  return Array.from({ length: g.directions }, (_, k) => {
    const a = (2 * Math.PI * k) / g.directions;
    return [px(x + g.outline * Math.cos(a)), px(y + g.outline * Math.sin(a))];
  });
}

/** CSS for `.logo-pair`. The harness mark comes first and the model mark sits
 * on top, overlapping it. The harness box is masked to a solid fill minus the
 * model mark's silhouette (`--model-logo`) dilated by `outline`, and draws its
 * own logo in `::before` so that one mask cuts both colour and mono marks.
 * In the chip the pair keeps a lone icon's box and spills out of it evenly on
 * both sides, so its centre stays where that icon's would be; the right margin
 * (the spill) keeps the label its usual gap from the model mark. */
export function logoPairCss(g: PairGeometry = PAIR): string {
  const copies = cutoutOffsets(g);
  const list = (first: string, rest: string): string => [first, ...copies.map(() => rest)].join(", ");
  const image = list("linear-gradient(#000 0 0)", "var(--model-logo)");
  const position = ["0 0", ...copies.map(([x, y]) => `${x} ${y}`)].join(", ");
  const size = list("100% 100%", `${px(g.model)} ${px(g.model)}`);
  const repeat = list("no-repeat", "no-repeat");
  const spill = px((g.harness - g.overlap) / 2);
  return `.logo-pair { display: inline-flex; flex: none; align-items: center; justify-content: center; }
.logo-pair > .logo { position: relative; width: ${px(g.model)}; height: ${px(g.model)}; }
.logo-pair > .logo:not(.harness) { z-index: 1; }
.logo-pair > .logo.harness {
  width: ${px(g.harness)};
  height: ${px(g.harness)};
  margin-right: ${px(-g.overlap)};
  background: none;
  -webkit-mask-image: ${image};
  mask-image: ${image};
  -webkit-mask-position: ${position};
  mask-position: ${position};
  -webkit-mask-size: ${size};
  mask-size: ${size};
  -webkit-mask-repeat: ${repeat};
  mask-repeat: ${repeat};
  -webkit-mask-composite: ${list("source-out", "source-over")};
  mask-composite: ${list("subtract", "add")};
}
.logo-pair > .logo.harness::before { content: ""; position: absolute; inset: 0; background: var(--logo) center / contain no-repeat; }
.logo-pair > .logo.harness.mono::before {
  background: currentColor;
  -webkit-mask: var(--logo) center / contain no-repeat;
  mask: var(--logo) center / contain no-repeat;
}
.chip .lead > .logo-pair { margin-right: ${spill}; }`;
}
