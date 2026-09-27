# Reviewer revision deadlines

Ric approved an optional revision deadline in the existing submission-review form for #551/#553. Copy is available in English, Simplified Chinese and Traditional Chinese.

The input displays the browser's timezone and the current deadline. Request revision converts the local date/time to an ISO timestamp for the existing `revisionDueAt` API field. Blank omits the field and preserves the current deadline. Approval always omits it, including when the input is invalid.

An entered deadline must be a valid local time, in the future and strictly later than the current deadline. Validation runs again when submitting, using the latest task deadline. Normalized nonexistent local times are rejected. Existing revision reasons, revision limits, permissions and expected-submission checks remain authoritative; no backend or schema changes were made.

Failed requests retain the draft. Account, Crew, task or submission changes reset it, and late responses cannot affect a replacement review session. Existing duplicate-click protection remains in place.

Verification: 42 tests passed across the review-form and Crew-cache suites. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed. Server checking was skipped at Ric's request. Local and uncommitted; no browser acceptance or deployment is claimed.

Isaac/Yuanzheng should verify in the deployed environment: request revision with a later deadline, request revision with a blank deadline, approval with an entered deadline, rejection of past/non-extending dates, and correct timezone display/conversion. Confirm the resulting task deadline and existing reminder behavior. Local tests do not establish regional acceptance.
