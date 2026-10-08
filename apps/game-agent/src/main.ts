import { readGameAgentModelConfig, readGameAgentServiceConfig } from "./config.js";
import { createGameAgentHttpServer } from "./http/server.js";
import {
  shutdownAppearanceWebSessions,
  initializeAppearanceWebWorkspaces,
} from "./appearance/web.js";

// Fail at boot rather than admitting sessions with an incomplete provider configuration.
readGameAgentModelConfig();
const config = readGameAgentServiceConfig();
await initializeAppearanceWebWorkspaces();
const server = createGameAgentHttpServer(config.internalToken);
server.listen(config.port, config.bindAddress, () => {
  console.log(`Game Agent ready on ${config.bindAddress}:${config.port}`);
});
server.on("error", () => {
  console.error("Game Agent could not bind its configured listener.");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Accepted HTTP bodies may still be arriving after the listener closes.
    // Fence their admissions synchronously before either shutdown wait starts.
    const closingSessions = shutdownAppearanceWebSessions();
    const deadline = setTimeout(() => server.closeAllConnections(), 5_000);
    const exitDeadline = setTimeout(() => process.exit(1), 10_000);
    void Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      closingSessions,
    ])
      .then(() => {
        clearTimeout(deadline);
        clearTimeout(exitDeadline);
        process.exit(0);
      })
      .catch(() => {
        console.error("Game Agent shutdown failed.");
        process.exit(1);
      });
  });
}
