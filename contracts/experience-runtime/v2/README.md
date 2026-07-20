# Experience Runtime v2 contracts

These generated JSON Schema documents contain two deliberately separated
contract sets.

The agreed Java **publication and discovery API v1** is normative in:

- `java-release-api-v1.openapi.yaml`;
- `release-request.schema.json`;
- `release-response.schema.json`;
- `game-list-response.schema.json`;
- `game-detail-response.schema.json`.

The API paths are relative to a deployment-owned `{prefix}`. Java treats the
request's `manifest` property as opaque JSON, stores it verbatim in object
storage/CDN, and returns `manifestUrl`. `(gameId, contentVersion)` is the
immutable release identity; Java does not assign a separate publication ID or
numeric release version.

Generate them from the canonical Zod schemas:

```bash
npm run contracts:experience -w @repo/shared
```

`runtime-manifest.schema.json` is the compiler/player contract. Studio and
NestJS validate it before publication; Java release v1 does not parse it.

Player-data files suffixed `.draft.schema.json` describe the current session,
checkpoint, and telemetry design only. They are not part of the agreed Java
publication/query API and must not be implemented as if their endpoints were
confirmed.

The generator intentionally overwrites every schema deterministically. Commit
the generated files together with their TypeScript source changes.

JSON Schema validates transport structure. Cross-reference, reachability,
state typing, renderer capability, spatial anchor, audio graph, and other
semantic rules remain enforced by the TypeScript semantic validator and must
be mirrored by Java conformance tests using the shared golden fixtures.

`semantic-rules.json` and `SEMANTIC_RULES.md` are normative. Generated JSON
Schema alone is insufficient for publication acceptance.

The publisher materializes and semantically validates Runtime Manifest v2,
then sends that exact JSON value in `POST {prefix}/releases`. Local canonical
hashing remains useful for reproducible builds and test fixtures, but no hash
or integrity wrapper is present in the agreed Java release v1 transport.
