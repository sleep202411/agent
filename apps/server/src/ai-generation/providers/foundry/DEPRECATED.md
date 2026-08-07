# Deprecated — Microsoft Foundry generation provider

This package is **not registered** in `AiGenerationModule` and must not
receive new generation traffic. Product generation uses binding-driven
providers (BytePlus, Bailian, MiniMax, fal, Agnes).

Kept on disk only so:

- historical imports / tests do not break mid-migration
- non-generation leftovers can be audited before hard delete

Do not re-register `FoundryProviderAdapter` without an explicit product
decision. Prefer delete in a dedicated cleanup PR once agent/cover tooling
no longer needs any Foundry path.
