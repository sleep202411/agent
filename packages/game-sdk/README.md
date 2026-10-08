# Game SDK — host action contract

The SDK is framework independent. It exposes game actions and a stable, immutable
view of their availability. The game host owns state, media, access checks, and
checkpoints. Film state remains owned by the existing engine.

The current adapter runs inside the shared trusted experience player. A custom
`ExperiencePlayerUI.mainMenu` receives `props.session` and can arrange its own
buttons, title, and content. Studio and Web use the same adapter and default menu.

```ts
const snapshot = session.getSnapshot();
const unsubscribe = session.subscribe(() => render(session.getSnapshot()));
const result = await session.invoke("open-map");
unsubscribe();
```

React consumers can use `useSyncExternalStore(session.subscribe,
session.getSnapshot, session.getSnapshot)`. Check `snapshot.actions[action]` to
disable unavailable controls. The host checks availability again on invocation.

| Action        | Current trusted experience adapter                                |
| ------------- | ----------------------------------------------------------------- |
| `start`       | Starts the session through the existing readiness and access flow |
| `continue`    | Leaves the menu and resumes the same session and media position   |
| `restart`     | Explicitly creates a new session after completion                 |
| `open-map`    | Opens the real journey map without starting a new run             |
| `close-map`   | Closes the map and restores its origin and playback hold          |
| `return-menu` | Suspends the mounted run and shows the independent home screen    |

`invoke` calls the host before its first await, preserving browser activation for
media and audio. Commands are serialized; unavailable, overlapping, and revoked
commands return `unavailable`, `busy`, or `disposed`. Actual host failures reject
with their original error. No pending command is queued for a later scene.
Restart and unmount revoke old sessions. Snapshot subscriptions receive changes
only when the public view changes, rather than every playback tick.

Generated main menus receive the same bounded interface through an authenticated
MessagePort, via the `@repo/game-sdk/port` host adapter. The opaque-origin iframe
cannot access the platform DOM or credentials. The host checks the exact window,
origin and one-time handshake credential before transferring the port, validates
monotonic request IDs and known actions, rate-limits messages and revokes the port
on unmount or runtime failure. Browser gesture/media behavior must be tested in
the real browser: asynchronous cross-window calls are distinct from direct trusted
component invocation.

The generated menu entry exports `mount({root,game,context})`, builds its own DOM,
and returns cleanup. Use `context.copy` for labels. `open-map` opens the real host
map; the current snapshot has no node/route data for a replacement map. Source
compilation is documented in [game-ui-build](../game-ui-build/README.md).

The menu contract does not provide arbitrary film-engine control. Broader playback,
choice, map-data and authorized state APIs must extend the existing film runtime;
there is no parallel numeric system or browser-save implementation in this SDK.
See [`game-vibecoding-production-design.md`](../../docs/story-studio/game-vibecoding-production-design.md)
for the project boundary and remaining work.

Run `npm run check-types -w @repo/game-sdk`, `npm run lint -w @repo/game-sdk`, and
`npm run test -w @repo/game-sdk` from the repository root. The shared player's
integration tests verify that these actions preserve actual runtime ownership.
