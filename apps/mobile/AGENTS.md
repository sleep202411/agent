# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Mobile release branches (2026-09-30)

- All of Ric's (ch0002ic-cell) subsequent Mobile development belongs exclusively on
  `feat/mobile-2.4.0-scrolling-screen`. This supersedes the older instruction to
  start each Mobile feature on a new branch from `main`.
- Do not commit, push, merge or cherry-pick Mobile development into `develop`
  or `main`, including completed features. A later explicit change to this
  branch policy is required before releasing Mobile work through those branches.
- Updates from official `main` should also flow into
  `feat/mobile-2.4.0-scrolling-screen`. This is an inbound update path
  (`main` → 2.4.0), not authorization to merge Mobile development back to `main`
  or `develop`.
- `feat/mobile-2.3.1-pay` is owned by the assigned Mobile release developer.
  Updates from that official branch may be merged into
  `feat/mobile-2.4.0-scrolling-screen`. The integration direction is 2.3.1 → 2.4.0;
  do not modify or push 2.3.1 or merge 2.4.0 work back into it.
- Fetch and inspect the latest source and destination before integrating updates.
  Preserve the assigned developer's changes, resolve conflicts on 2.4.0, and
  validate the affected features before pushing. Never force-push, reset or
  discard a colleague's work.
- Keep Mobile routes, entry points, supporting modules and tests on 2.4.0.
  Deferred discovery, personal-video publishing, service orders,
  inbox/conversations and service management remain outside the 2.3.1 payment release.
- Branch permission is not permission to expand the assigned scope. Work only
  on tasks assigned to Ric; new Mobile work or Web-to-Mobile adaptation must
  first be coordinated with Isaac. Respect the assigned developers' task order.

## Current scope clarification (2026-10-01)

- Current official `main` / `develop` define the supported feature scope. Remove
  Mobile adaptations of features rolled back there; historical parity work is
  not authorization to restore them on 2.4.0.
- The user explicitly authorized restoring and completing personal-work
  publishing/editor, service inquiry/orders, supporting service management and
  inbox/conversations on 2.4.0 only. This supersedes the earlier removal from
  2.4.0. Restore usable entry points while preserving the existing Mobile layout.
- `b14a28f2c` isolated deferred Mobile workflows from release branches; it did
  not remove the corresponding Web features. Do not interpret Mobile release
  isolation as evidence that a feature was rolled back on Web.
- This authorization does not permit releasing these workflows to main/develop
  or changing the official 2.3.1 branch. Courses/Discovery remain excluded.
- Preserve official public creator/service browsing, personal-work playback,
  the official payment release and shared media components used by Crew tasks
  and assets. Courses/Discovery remain removed under official 2.3.1 navigation.

## Authorized parity integration (2026-10-06)

The user explicitly authorized completing parity on
`feat/mobile-2.4.0-scrolling-screen`, then merging that completed branch into
`main` and `develop`, aligned to the same verified commit. This instruction
supersedes the earlier outbound-merge prohibition for this parity integration.
Preserve concurrent work, validate before publishing, and do not force-push.
The 2.3.1 branch and deployment ownership remain unchanged.
