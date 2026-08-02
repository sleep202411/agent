import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "public/assets/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use the shadcn Select primitives or NativeSelect so dropdowns remain theme-controlled across platforms.",
        },
      ],
      // React Compiler is not enabled in next.config.ts. Keep these diagnostics
      // visible, but do not make them the current production gate until the app
      // is intentionally migrated to compiler-compatible patterns.
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
]);

export default eslintConfig;
