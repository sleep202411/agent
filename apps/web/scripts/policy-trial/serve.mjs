import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const web = fileURLToPath(new URL("../..", import.meta.url));
const server = await createServer({
  configFile: false,
  envFile: false,
  root,
  resolve: { alias: { "@": web }, dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" },
  css: { postcss: web },
  server: { host: "127.0.0.1", port: 9531, strictPort: true },
});
await server.listen();
server.printUrls();
