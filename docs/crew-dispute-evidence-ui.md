# Private dispute evidence UI

Ric approved this #553 extension on 25 September 2026. Implemented locally on `feat/crew-workflows-current-develop`; not committed or deployed.

## Upload and sharing

My cases now supports PDF, PNG and JPEG evidence (nonempty files up to 10 MiB, valid names up to 255 characters). The existing server limit is 100 upload identities per participant per case, including abandoned uploads. Preparation uses the private case endpoint; the browser PUT sends the returned provider headers without application credentials or a referrer. Confirmation verifies and finalizes the stored bytes through the existing backend.

Uploading/confirmation never shares evidence automatically. The participant explicitly selects up to 20 confirmed, still-private files and sends them with a message or an appeal of a resolved case. The interface explains that the other party and authorized operations will gain access. Already-shared files remain readable and are not offered as newly private selections. The list contract guarantees that unshared rows belong to the caller; the server independently enforces uploader ownership and media availability when sharing. No generic media routes or public links are used.

The list supports scoped cursor pagination and marks unconfirmed, private and shared files. Unconfirmed own uploads offer confirmation recovery. Authorized download requests obtain fresh short-lived signed links; links are cleared at expiry or when another read is requested, and invalid/expired or non-HTTPS links are rejected. They are not placed in query caches. Open-file links use a new tab with no opener or referrer. Case history retains the immutable attachment references; the evidence section lists files by name.

## Recovery and isolation

Upload stages retain the same attachment ID and selected File while mounted. A failed prepare retries the same metadata/ID. A failed PUT may retry the same bytes, or the user can explicitly confirm bytes that may already have arrived. A failed confirmation retries confirmation without uploading again. Expired uploads require recovery confirmation or explicit abandonment and reselection. Abandoning does not delete bytes or restore the server upload allowance.

Unmount/account/case changes abort the active upload and suppress late UI effects. Pending list entries can be confirmed after returning if bytes reached storage. Full upload recovery across navigation/reload is not guaranteed because the browser File is not persisted. Failed evidence-list reads hide files and prevent sharing existing selections; users can refresh or explicitly clear the selection. Case-event retries retain their exact attachment IDs and request key even if the files become shared after a lost success response. Stale case-version enforcement remains unchanged.

All copy is translated into English, Simplified Chinese and Traditional Chinese. No backend/schema, retention policy, operations-resolution UI, score or financial changes.

## Verification and regional acceptance

68 tests passed across four affected frontend suites. Coverage includes file type/name/size boundaries, required storage headers, private confirmation, exact prepare/confirmation retry, uncertain PUT recovery, expired upload URLs, authorized/denied downloads, unsafe/expired read links, explicit sharing with discussion/reopening, sharing limits, failed reads, scoped pagination and account-change aborts. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed after final edits. Full server checking remains skipped at Ric's request.

Tests use controlled storage responses. Isaac/Yuanzheng must verify actual global/CN private storage configuration and CORS, PDF/image upload and download, denied unrelated access, no sharing before an explicit event, immutable finalized files, expired-link behavior and departed participants. Confirm staging-object retention and record the deployed revision, region and result. No live cloud upload, production data change or deployed acceptance is claimed.

[Backend attachment contract](crew-dispute-attachments.md) · [Private cases](crew-private-cases-ui.md).
