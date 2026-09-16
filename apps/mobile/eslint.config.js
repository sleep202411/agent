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
          ignore: ["^@tabler/icons-react-native/icons/"],
        },
      ],
    },
  },
]);
