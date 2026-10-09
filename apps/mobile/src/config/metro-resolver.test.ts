// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function resolver() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const module = { exports: {} as any };
  vm.runInNewContext(readFileSync(path.join(root, "metro.config.js"), "utf8"), {
    __dirname: root,
    module,
    require: (name: string) => {
      if (name === "expo/metro-config")
        return { getDefaultConfig: () => ({ resolver: { sourceExts: ["ts", "js"] } }) };
      if (name === "expo/config") return { getConfig: () => ({ exp: {} }) };
      if (name === "nativewind/metro") return { withNativeWind: (config: unknown) => config };
      if (name === "node:crypto")
        return { createHash: () => ({ update: () => ({ digest: () => "fixture" }) }) };
      if (name === "fs") return { existsSync: () => true };
      if (name === "path") return path;
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return module.exports.resolver.resolveRequest;
}

it("leaves css-tree relative imports to Metro's browser mappings", () => {
  const resolveRequest = vi.fn(() => ({
    type: "sourceFile",
    filePath: "/css-tree/dist/version.js",
  }));
  const context = { originModulePath: "/node_modules/css-tree/lib/index.js", resolveRequest };
  expect(resolver()(context, "./version.js", "ios")).toEqual({
    type: "sourceFile",
    filePath: "/css-tree/dist/version.js",
  });
  expect(resolveRequest).toHaveBeenCalledWith(context, "./version.js", "ios");
});

it("keeps the explicit-extension exception for country flag icons", () => {
  const resolveRequest = vi.fn();
  const context = {
    originModulePath: "/node_modules/country-flag-icons/string/3x2/index.js",
    resolveRequest,
  };
  expect(resolver()(context, "./PF.js", "android")).toEqual({
    type: "sourceFile",
    filePath: "/node_modules/country-flag-icons/string/3x2/PF.js",
  });
  expect(resolveRequest).not.toHaveBeenCalled();
});
