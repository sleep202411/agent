# Operations case handling

Ric approved an admin case queue and detail screen for #553/#555, with claim/takeover, discussion, resolution and authorized evidence viewing. Implemented locally in `apps/admin-ui` at `/crews/disputes` on `feat/crew-workflows-current-develop`.

## Access and workflow

- The server page requires an Admin session, `crew.manage` and a matching site scope (or all-site permission). The existing site-bound proxy forwards the current credentials to the configured regional Admin API. The backend independently authorizes every request and rechecks persisted authority for mutations.
- The queue shows case title, status, operations owner, parties and date, with `beforeId` pagination. Selecting a case opens its detail/history screen; events paginate independently with `beforeVersion`. Refresh starts from the first page. No unsupported server-side status filter is added.
- An authorized operator can claim or take over an unresolved case and add discussion. Only the assigned owner can resolve an `in_review` case. Resolved cases are read-only until a participant appeals through the existing participant workflow. Every action requires a reason and an explicit review/confirmation step.
- The draft retains the case version reviewed when the action began. Refresh does not silently replace that version. A stale draft must be discarded before starting from the new case state. Language switching preserves the draft.
- The page includes English, Simplified Chinese and Traditional Chinese copy with a local language selector; this does not change the admin console's global language behavior.

## Recovery and evidence

Ambiguous writes preserve the exact request key, action, reason and expected version for explicit retry while the detail screen remains mounted. Other writes are blocked during recovery. A retry can recover a recorded action even if the case has since changed status. Definitive errors expose the backend message; failed detail reads and authentication/permission denial hide private history and controls. Leaving the screen or reloading does not preserve an uncertain request; review current history before taking further action.

Duplicate writes are guarded through the existing admin operation helper. Session/site changes cancel outstanding work and suppress late results. Successful writes stay recorded even if the following history refresh fails. No automatic retries issue mutations.

History shows existing submission references and explicitly shared attachment IDs. Evidence viewing calls the private Admin read endpoint only when requested, requires a valid HTTPS URL and future expiry, and removes the link locally at expiry (at most 60 seconds). Links are not stored in query caches and use no-referrer navigation. The backend does not expose unshared participant uploads to operations; no public-media fallback or upload action is added. Submission references do not bypass file access.

## Verification and acceptance

64 tests passed across five admin suites: new case UI and proxy tests, existing session boundary, expense queue and proxy recovery. Checks cover reason/confirmation, owner-only resolution, resolved cases, stale drafts, exact retry, read/write denial, queue/history cursors, duplicate requests, session/site changes, late responses, signed-link validation/expiry and language parity. Full admin typecheck (including route generation), changed-file lint and diff checks passed. The worktree's missing `eslint-config-next` dependency was linked locally to the existing original-checkout installation; no dependency manifest or lockfile was changed. Server checking remains skipped at Ric's request.

Isaac/Yuanzheng should verify the deployed regional Admin session/site mapping, unauthorized access, claim/takeover audit records, owner-only resolution, participant visibility and appeal/reopening, pagination, lost responses and actual private-storage downloads. Tests use controlled upstream responses; live Java/storage behavior and browser acceptance are not established here. Operations must still designate the real case-handling owner and response targets.

Changes are local and uncommitted. No deployment, live case mutation or issue closure. Case decisions record outcomes only: they do not change payments, tasks, agreed fees, evidence or ratings. Refunds, financial settlement, rating correction and operations upload controls remain excluded.
