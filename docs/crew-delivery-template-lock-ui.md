# Delivery-template lock presentation — #552

The existing editor allowed in-progress and revision-requested tasks to select and save delivery-template changes, although the backend rejects them. It also offered changes for reopened tasks with submission history.

The panel now hides editing controls when task status is not open or any submission exists, and shows the lock explanation in English, Simplified Chinese and Traditional Chinese. The current agreed template stays visible. When a refreshed task becomes locked, its reference-price display uses the agreed definition rather than an unsaved draft. The save handler also checks these conditions and failed/pending template/catalog reads.

Accepted commitments are not exposed by the current task DTO. Their additional lock remains enforced by the existing backend, alongside permission/version checks and concurrent changes. This client correction does not claim to project that unavailable state or weaken backend enforcement. No backend/schema, catalog definition or pricing rule changed.

16 tests passed across delivery-template and panel suites, covering all non-open statuses, open tasks with submission history, a lock arriving during editing, existing version-conflict behavior, empty/error reads and translations. Server checking remains skipped at Ric's request. Local and uncommitted; no deployment or issue closure.

Isaac/Yuanzheng should verify open/unstarted editing, read-only display after work begins, revision-requested and reopened/submitted-history cases, plus backend rejection after an accepted commitment or concurrent lock. The authoritative delivery catalog and regional acceptance remain outstanding.

Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed after final edits.
