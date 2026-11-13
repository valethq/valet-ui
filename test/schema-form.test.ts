import { describe, expect, test } from "bun:test";
import { fieldKind, formatField, parseField } from "../src/app/views/schema-form";

describe("fieldKind", () => {
  test("maps the simple schema subset to controls", () => {
    expect(fieldKind({ type: "boolean" })).toBe("boolean");
    expect(fieldKind({ type: "integer" })).toBe("number");
    expect(fieldKind({ type: "string" })).toBe("text");
    expect(fieldKind({ type: "string", format: "password" })).toBe("secret");
    expect(fieldKind({ type: "string", writeOnly: true })).toBe("secret");
    expect(fieldKind({ type: "string", enum: ["a", "b"] })).toBe("enum");
    expect(fieldKind({ type: "array", items: { type: "string" } })).toBe("list");
  });

  test("anything else is edited as JSON", () => {
    expect(fieldKind({ type: "object" })).toBe("json");
    expect(fieldKind({ type: "array", items: { type: "object" } })).toBe("json");
    expect(fieldKind({})).toBe("json");
  });
});

describe("formatField / parseField", () => {
  test("numbers round-trip, reject junk and leave empties unset", () => {
    const p = { type: "integer" };
    expect(formatField("number", 8080)).toBe("8080");
    expect(parseField("number", "8080", p, "Port")).toBe(8080);
    expect(parseField("number", "", p, "Port")).toBeUndefined();
    expect(() => parseField("number", "1.5", p, "Port")).toThrow("Port must be a whole number");
    expect(() => parseField("number", "abc", { type: "number" }, "Ratio")).toThrow("Ratio must be a number");
  });

  test("lists are one item per line", () => {
    const p = { type: "array", items: { type: "string" } };
    expect(formatField("list", ["a", "b"])).toBe("a\nb");
    expect(parseField("list", " a \n\nb\n", p, "Hosts")).toEqual(["a", "b"]);
    expect(parseField("list", "1\n2", { type: "array", items: { type: "integer" } }, "Ids")).toEqual([1, 2]);
  });

  test("secrets never show the stored value and stay unset unless typed", () => {
    expect(formatField("secret", "••••")).toBe("");
    expect(parseField("secret", "", {}, "Token")).toBeUndefined();
    expect(parseField("secret", "s3cret", {}, "Token")).toBe("s3cret");
  });

  test("enums keep their original value type", () => {
    expect(parseField("enum", "2", { enum: [1, 2, 3] }, "Level")).toBe(2);
    expect(parseField("enum", "b", { enum: ["a", "b"] }, "Mode")).toBe("b");
  });

  test("json parses or explains, booleans pass through", () => {
    expect(parseField("json", '{"a":1}', {}, "Extra")).toEqual({ a: 1 });
    expect(parseField("json", "  ", {}, "Extra")).toBeUndefined();
    expect(() => parseField("json", "{", {}, "Extra")).toThrow("Extra is not valid JSON");
    expect(formatField("boolean", true)).toBe(true);
    expect(parseField("boolean", false, {}, "On")).toBe(false);
  });
});
