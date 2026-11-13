// Logo SVGs are imported `with { type: "text" }` and inlined by Bun.build.
declare module "*.svg" {
  const text: string;
  export default text;
}
