import { config } from "@repo/eslint-config/base";
import { config as reactConfig } from "@repo/eslint-config/react-internal";
export default [
  { ignores: ["dist/**"] },
  ...config,
  ...reactConfig.map((entry) => ({ ...entry, files: ["ui/**/*.{ts,tsx}"] })),
  { rules: { "turbo/no-undeclared-env-vars": "off" } },
];
