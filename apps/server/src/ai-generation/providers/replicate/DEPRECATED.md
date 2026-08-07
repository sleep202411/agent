# Deprecated — Replicate generation provider

This package is **not registered** in `AiGenerationModule` for product
generation. Agent cover / residual tooling may still reference Replicate
env vars outside this path.

Do not re-register `ReplicateProviderAdapter` for AI Job generation without
an explicit product decision. Prefer delete once non-gen consumers are
inventoried.
