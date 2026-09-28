// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    files: ["scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { __dirname: "readonly" } },
  },
  {
    ignores: ["dist/*"],
    rules: {
      "import/no-unresolved": [
        "error",
        {
          // The ESLint resolver does not support Tabler wildcard package exports.
          // TypeScript and the runtime resolve these public per-icon entry points.
          ignore: ["^@tabler/icons-react-native/Icon[A-Za-z0-9]+$"],
        },
      ],
    },
  },
]);
