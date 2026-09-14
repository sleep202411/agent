# IP room numbers

Each IP has a database-assigned `roomNumber`, a unique decimal string within
its deployment. PostgreSQL allocates numbers starting at `100001` using a
non-cycling sequence. The migration fills existing IPs, including drafts and
archived rows. New IPs receive their number automatically; creation and editing
APIs do not accept a caller-supplied number. Numbers can have gaps and are never
recycled after deletion. Keep them as strings in APIs and clients.

Public links use `/{locale}/ip/{roomNumber}`. The existing `/ips/{uuid}` page
still works. Numeric `/ips/{javaId}` links retain their legacy Java-to-UUID
redirect; they are a different namespace and must not resolve room numbers.
The public detail API `/ip-commerce/ips/{reference}` accepts a room number or
UUID and returns the canonical UUID in `ip.id`. The authenticated creator-detail
read accepts both as well, preserving owner/editor previews for drafts.
Mutations continue to use UUIDs.

Public and admin IP searches include exact room-number matches. Room access
uses the same publication, visibility, viewer-block, and entitlement checks as
UUID access. Unlisted IPs can be opened directly but do not appear in the plaza.
The two regional deployments have independent databases and number sequences;
the origin is part of the public address.

Release order: apply `20260909150000_ip_room_numbers`, deploy the server, then
deploy web and admin-ui. The frontend requires the returned room number and
does not invent one from an old ID. No manual numbering or region configuration
is needed.
