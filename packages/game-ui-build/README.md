# Game UI compiler

`buildGameUI(source, signal?)` compiles the versioned `GameUISource` contract into
an immutable `GameUIArtifact`. The supported surface is `main-menu` (v1), connected to the existing film lifecycle actions.

The entry exports `mount({ root, game, context })`, optionally returns a promise,
and returns cleanup. The Game SDK is injected by the runtime, not imported by
user code. Use `game.getSnapshot()`, `game.subscribe()` and `game.invoke(action)`;
`GAME_UI_CONTRACT` includes the exact context, action availability and an example.

Source files are virtual data. Only exact relative imports between JS, TS, CSS,
JSON and SVG files resolve. The compiler never executes user code, loads user
plugins, reads user-selected disk paths, installs packages or runs build scripts.
It uses pinned esbuild, limits files and bytes, supports cancellation and has a
10-second build deadline. Source identity ignores file ordering; artifact identity
includes the source hash, toolchain and output.

Harness edits candidate files and calls the compiler before applying a result.
The project API accepts source only and recompiles it before version-checked
storage. Studio and Web run the same frozen artifact through their shared player.
A failed compile does not replace the working menu or save project changes.

The runtime's opaque-origin iframe, CSP and authenticated MessagePort are separate
from compilation. Neither compiler nor iframe provides process resource quotas
or general multi-tenant shell/network isolation. The game-agent worker owns the
persistent production workspace; external package imports are unsupported.

Run `npm run build -w @repo/game-ui-build`, `npm run check-types -w
@repo/game-ui-build` and `npm run test -w @repo/game-ui-build` from the repo root.
