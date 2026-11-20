import { describe, expect, test } from "bun:test";
import { cutoutOffsets, logoPairCss, PAIR } from "../src/app/logo-pair";
import { indexHtml } from "../src/page";

describe("logo pair", () => {
  test("the chip pair is a 13px harness mark under a 15px model mark, 3.25px overlap, 1.625px outline", () => {
    expect(PAIR).toEqual({ overlap: 3.25, harness: 13, model: 15, outline: 1.625, directions: 16 });
  });

  test("cutout copies ring the model mark's spot in the harness box at the outline's distance", () => {
    const offs = cutoutOffsets();
    expect(offs).toHaveLength(16);
    expect(offs[0]).toEqual(["11.375px", "-1px"]);
    expect(offs[4]).toEqual(["9.75px", "0.625px"]);
    expect(offs[8]).toEqual(["8.125px", "-1px"]);
    expect(offs[12]).toEqual(["9.75px", "-2.625px"]);
    for (const [x, y] of offs) {
      const dx = Number.parseFloat(x) - 9.75;
      const dy = Number.parseFloat(y) + 1;
      expect(Math.hypot(dx, dy)).toBeCloseTo(1.625, 2);
    }
  });

  test("offsets follow the geometry rather than fixed values", () => {
    const g = { overlap: 0, harness: 15, model: 15, outline: 2, directions: 4 };
    expect(cutoutOffsets(g)).toEqual([
      ["17px", "0px"],
      ["15px", "2px"],
      ["13px", "0px"],
      ["15px", "-2px"],
    ]);
  });

  test("the harness mask subtracts the dilated model silhouette, with WebKit's composite too", () => {
    const css = logoPairCss();
    const layers = (prop: string) => (new RegExp(`\\n  ${prop}: ([^;]*);`).exec(css)?.[1] ?? "").split(", ");
    expect(layers("mask-image")).toEqual([
      "linear-gradient(#000 0 0)",
      ...Array(16).fill("var(--model-logo)"),
    ]);
    expect(layers("-webkit-mask-image")).toEqual(layers("mask-image"));
    expect(layers("mask-composite")).toEqual(["subtract", ...Array(16).fill("add")]);
    expect(layers("-webkit-mask-composite")).toEqual(["source-out", ...Array(16).fill("source-over")]);
    expect(layers("mask-position")[1]).toBe("11.375px -1px");
    expect(layers("mask-size")[1]).toBe("15px 15px");
    expect(css).toContain("margin-right: -3.25px;");
  });

  test("the pair keeps a lone icon's centre: it spills half the extra width out of the right margin", () => {
    expect(logoPairCss()).toContain(".chip .lead > .logo-pair { margin-right: 4.875px; }");
  });

  test("the page carries the pair css and a 9.5px faint 'on' line", () => {
    const html = indexHtml();
    expect(html).toContain(logoPairCss());
    expect(html).toContain("font-size: 9.5px; font-weight: 400; color: var(--faint); }");
  });
});
