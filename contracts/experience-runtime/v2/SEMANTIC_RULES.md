# Experience Runtime semantic rules v1

JSON Schema is the structural transport contract. It cannot encode every
cross-reference, graph, ordering, privacy, hashing, or batch-identity rule.
`semantic-rules.json` is therefore a required companion contract, not optional
documentation.

TypeScript publication uses `ExperienceRuntimeManifestSchema` before building
the agreed Java release request. These semantic rules belong to the compiler
and runtime. Java release API v1 intentionally persists `manifest` as opaque
JSON and is not required to mirror or execute these rules.

The semantic rule version is embedded in Runtime Manifest compatibility.
Unsupported versions fail publisher validation and runtime compatibility
negotiation; a player may not silently downgrade.

Player identity is derived from Java authentication/session state. It is not a
trusted client event field. `clientWriteId` identifies one checkpoint write and
must return the original result on retry. `checkpointId` only identifies the
authored story checkpoint and is not an idempotency key. These player-data
semantics remain draft until their Java endpoints are separately agreed.
