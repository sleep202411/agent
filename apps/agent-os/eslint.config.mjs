import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      // Agent OS reads its app-local .env explicitly and validates required
      // values at runtime; it is not configured through a package turbo.json.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      // Async-iterator test doubles intentionally finish or throw before their
      // first value; requiring a synthetic yield would change the behavior.
      "require-yield": "off",
    },
  },
];
