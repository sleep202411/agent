const { getDefaultConfig } = require("expo/metro-config");
const { getConfig } = require("expo/config");
const { createHash } = require("node:crypto");
const { withNativeWind } = require("nativewind/metro");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Expo inlines its public manifest into transformed Web modules. Source files
// do not change when switching region/variant/API environment, so a shared
// transform cache can otherwise keep another build's endpoints and identity.
const publicConfig = getConfig(projectRoot, {
  isPublicConfig: true,
  skipSDKVersionRequirement: true,
}).exp;
config.cacheVersion = `${config.cacheVersion ?? ""}:${createHash("sha256")
  .update(JSON.stringify(publicConfig))
  .digest("hex")}`;

// Monorepo: watch + resolve from the workspace root so hoisted deps
// (e.g. expo-asset hoisted to the root node_modules) are served by Metro.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, "mjs", "cjs"]));
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Resolve explicit-extension relative imports directly, bypassing the package
  // `exports` map. Metro's package-exports resolver rejects a barrel's internal
  // `./XX.js` re-exports when the exports map only lists the extensionless key —
  // e.g. country-flag-icons' string/3x2 barrel does `export … from './PF.js'`
  // but its exports map has "./string/3x2/PF" (no .js), so the .js import 404s.
  // Restrict this exception to the affected icon package. Other packages (e.g.
  // css-tree) need Metro's browser mappings to replace Node-only modules.
  if (
    /[/\\]country-flag-icons[/\\]/.test(context.originModulePath) &&
    /^\.\.?\//.test(moduleName) &&
    /\.(cjs|mjs|js)$/.test(moduleName)
  ) {
    const candidate = path.resolve(path.dirname(context.originModulePath), moduleName);

    if (fs.existsSync(candidate)) {
      return { type: "sourceFile", filePath: candidate };
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
