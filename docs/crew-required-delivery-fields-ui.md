# Required delivery fields — #552/#553

The existing submission dialog previously allowed empty required professional-delivery fields to reach the backend and fail there. It now lists missing field labels in English, Simplified Chinese and Traditional Chinese and disables submission until each required field is complete.

Required text must contain non-whitespace characters. A required attachment field must reference at least one attachment still selected for this submission. Removing the attachment makes the field incomplete again; answers stay in the draft so correcting the attachment selection recovers the entry. Optional fields and tasks without templates retain existing behavior. Both the button and submit handler apply the same gate.

Existing backend validation remains authoritative for template revisions, permissions, attachment eligibility, limits and concurrent changes. No delivery requirements or policy were invented; no backend/schema change.

23 tests passed across submission-dialog and delivery-template suites, including a connected required-text/file journey, whitespace rejection, removal/reselection, optional-field omission and exact submission payload. Changed-file lint, translation/placeholder parity and diff checks passed. Server checks remain skipped at Ric's request.

Local and uncommitted. Isaac/Yuanzheng should verify required fields with a real approved template, removal/reselection of required attachments and successful delivery in the target environment. No deployment, live submission or issue closure is claimed.

Full web typecheck passed after final edits.
