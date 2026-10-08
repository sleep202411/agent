import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  {
    rules: {
      // App-local required configuration is checked at service startup.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
