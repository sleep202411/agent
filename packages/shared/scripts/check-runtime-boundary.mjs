import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const root = new URL("../dist/", import.meta.url).href;
let hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root) && !specifier.startsWith(".") && specifier !== "zod") {
      throw new Error(`Shared root runtime boundary violated: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});
try {
  const shared = await import("../dist/index.js");
  assert.equal(shared.encodeUserId(123), "864871");
  console.log("Shared root imports without compiler dependencies: ok");
} finally {
  hooks.deregister();
}

hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("mdn-data/")) throw new Error(`Unbundled runtime asset: ${specifier}`);
    return nextResolve(specifier, context);
  },
});
try {
  const { compileExperienceUITheme, ExperienceUIThemeSchema } =
    await import("../dist/experience-runtime.js");
  const selector = '[data-experience-ui-region="start"] [data-ui-part="primary"]';
  const theme = { version: 1, name: "Runtime check", css: `${selector}{color:red}`, assets: [] };
  assert.match(compileExperienceUITheme(theme, "check"), /data-experience-theme="check"/);
  assert.equal(
    ExperienceUIThemeSchema.safeParse({ ...theme, css: `${selector}{color:invalid}` }).success,
    false
  );
  console.log("Experience theme compiles without dynamic MDN assets: ok");
} finally {
  hooks.deregister();
}

// Jest uses the CJS entry; ensure both distributions enforce identical grammars.
const [bundled, native] = await Promise.all([
  import("css-tree/dist/csstree.esm"),
  import("css-tree"),
]);
assert.deepEqual(bundled.lexer.dump(), native.lexer.dump());
console.log("Bundled and native CSS validation grammars match: ok");
