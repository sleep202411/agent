# FizzDragon Mobile Design

Mobile is a new Expo / React Native surface. The old Vue / uni-app project is
the business-flow reference for first-pass mobile information architecture:
Story Square, project lists, creator center, and mine/profile should map back
to the old app's product modules. Do not copy its visual system, CSS, or
desktop page composition.

## Theme

- Use NativeWind for styling and Tailwind tokens for color, spacing, type, and
  radius.
- Mobile follows the current web product direction: dark-only. Do not expose a
  theme switch or branch UI off device light mode.
- `#E52227` is the brand accent, matching web's current primary token. Use it
  for primary actions, selected states, focus accents, destructive confirmation,
  and important status signals. Do not use it as a page background.
- Default surfaces are neutral and content-first: use a near-black root canvas,
  dark neutral panels, subtle white hairlines, off-white primary text, and muted
  gray secondary text.
- Cards and repeated items use radius `8px` or less unless a component has a
  specific interaction reason to be larger.
- Favor dense, task-oriented mobile screens over marketing-style hero layouts.

## App Structure

- The mobile app is guest-first for discovery. Anonymous users can browse public
  IP, creator, creator-service, crew, and news surfaces without hitting an
  authentication wall.
- The tab shell has five primary destinations: **Home**, **Creators**,
  **Crews**, **News**, and **Mine**. The labels are localized as 首页 / 创作者 /
  剧组 / 动态 / 我的 for Simplified Chinese.
- The first tab is **Home**. It is an IP-first discovery surface: featured IP,
  recommendations, and a limited public IP preview. Do not re-expand Home into a
  mixed creator marketplace unless the product direction changes again.
- Creator supply belongs under **Creators**. Crew recruitment belongs under
  **Crews**. News stays a content feed. Mine remains the personal/account
  workspace.
- Authenticated users enter a bottom-tab app shell. Tab pages should be compact
  app screens with native-style headers, lists, quick actions, and feed rows.
- Authentication is deferred to protected intent: personal collections,
  reporting, blocking, account settings, publishing, creation, checkout, and
  other user-scoped mutations open the global auth bottom sheet over the current
  context.
- Login, registration, and password reset live inside one native route-level
  sheet. Do not stack separate modal surfaces for each auth step, and do not
  replace it with a hand-rolled full-screen login wall.
- After successful auth, dismiss the sheet and preserve the originating context.
  When a protected action opened auth, resume that action or return the user to
  the exact surface where they started.
- Do not use desktop web patterns such as top nav bars, wide dashboards,
  oversized heroes, three-column stat grids, or sign-in CTA panels inside the
  tab shell.

## Web Runtime Frame

- Expo web is a mobile product preview, not a responsive desktop site. The app
  shell is centered and constrained to `MaxContentWidth` so every route renders
  with the same mobile viewport contract on desktop browsers.
- Keep app routes, tab bars, lists, detail pages, and auth routes inside that
  mobile-width frame. Do not let individual pages opt into `100vw` layouts.
- System layers that intentionally block or dim the entire browser viewport
  stay outside the frame: legal consent, global alerts, crash overlays, and
  future maintenance / force-upgrade interstitials.
- Native platforms are not constrained by the web frame; the frame component is
  web-only and should not change iOS / Android layout behavior.

## Discovery Surfaces

- The user explicitly reopened the vertical preview feed on 2026-10-07.
  Home's "Watch recommended previews" entry opens `/discovery`; preserve the
  existing five-tab navigation and Home card layout. This separate route pages
  through the public IP catalogue, playing only the selected public preview.
  Scrolling pauses playback; backgrounding or leaving the route releases it.
  Missing previews remain explicit, and full-work access stays on IP detail.
  The daily Discovery assistant remains deferred. Native Courses was
  subsequently reopened separately by the user.

- IP image cards use stable 16:9 media wherever the card is consumed as a
  horizontal preview rail. Fixed aspect ratios are required so loading states,
  tags, and title wrapping do not resize the surrounding rail.
- Discover only previews the first 20 IP cards. The full public IP catalog
  belongs on the dedicated all-IP list page with server-side pagination and the
  same genre / region / type filters.
- Creator cards lead with identity and certification level. Do not show creator
  bios in compact browse cards. Do not invent fake portfolios or local
  placeholder creators; use the same Java talent-market endpoint as web and hide
  empty rails when data is unavailable.
- Creator service cards lead with service category, package count, summary,
  starting price, and delivery time. Public listing/detail data comes from
  `/aurora/creator-services`; pricing is already returned in display units by
  the server and should only be locale-formatted on mobile.
- Crew cards on Discover are recruitment prompts, not a second full crew page.
  Keep them compact and route to the crew detail surface for membership and
  application flows.

## Copy

English remains the source language. Chinese text belongs in locale resources,
not inline TSX.

## Auth Forms

- Keep account forms compact and task-first. Login is a product screen, not a
  marketing hero.
- Auth forms are presented as a native bottom sheet over the app shell. Use the
  route-level sheet configuration and shared auth gate before introducing any
  custom modal implementation.
- Required fields, disabled submit, submitting state, backend error messages,
  and deterministic back navigation must be visible.
- Auth-triggering UI should be direct and low-friction: open the global sheet
  from protected actions instead of routing users through standalone login
  screens or generic alert detours.
- Backend errors should be shown directly unless the upstream message is empty
  or unsafe.

## Sources

- Root brand rules: `../../DESIGN.md`
- Token source: `src/config/theme-tokens.json`
- NativeWind implementation: `tailwind.config.js`

## Academy Courses

- Native Courses uses separate catalogue and lesson-detail routes, reached from
  Home, Mine and mapped certification applications. Keep all five tabs intact.
- Use the same regional Java catalogue, signed lesson URLs and Academy badge
  mappings as Web. Guest browsing remains public; enforce service access errors.
- Resume lesson progress on this device, scoped by account and region. Stop
  playback on background/navigation; never interpret watch progress as a badge.
