# Admin UI Design System

`apps/admin-ui` is an internal operations console. It should feel quiet,
dense, and operational rather than promotional. Use root `../../DESIGN.md`
for shared brand rules, then apply the admin-specific rules below.

## Product Character

- Prioritize scanning, comparison, and repeated action over storytelling.
- Keep layouts structured around navigation, filters, data tables, forms,
  timelines, and detail panels.
- Avoid marketing composition: no hero sections, decorative feature cards,
  oversized slogans, or public-site visual language.
- Use restrained color. Reserve strong color for status, destructive actions,
  risk, or attention that requires operator action.

## Navigation

- The shell should make the active module obvious and keep global site context
  visible. International and China deployments are separate systems; do not
  present the site selector as a tenant filter over one shared database.
- Keep primary navigation stable. Admin users should not need to relearn page
  structure between billing, IP commerce, audit, user management, and security
  governance.
- Use compact labels and predictable grouping. Prefer module names over
  explanatory copy.

## Page Layout

- Use one clear page title, a short operational subtitle when needed, and
  immediate controls for the workflow.
- Prefer full-width bands or unframed layouts. Use cards only for repeated
  entities, metric tiles, modals, or genuinely framed tools.
- Do not nest cards inside cards.
- Keep toolbar controls close to the data they affect. Filters, search,
  segmented controls, and date ranges should be easy to scan in one row when
  space allows.

## Components

- Use icon buttons for common tools such as refresh, revoke, lock, unlock,
  download, search, filter, copy, and external link actions.
- Use tabs for sibling views, segmented controls for mode switching, toggles or
  checkboxes for binary settings, menus for option sets, and tables for
  operational lists.
- Buttons should be direct commands. Avoid verbose button labels when a
  familiar icon plus tooltip communicates the action clearly.
- Table rows should expose status, actor, timestamp, scope, and next action
  without opening a detail view whenever practical.

## Status And Risk

- Status copy should be concrete: locked, active, MFA required, pending reset,
  failed login, policy violation, webhook failed.
- Destructive and security-sensitive actions need clear confirmation and should
  name the affected account, session, order, or record.
- Audit and security pages should bias toward traceability. Show actor,
  subject, action, result, IP, user agent, and timestamp when available.

## Writing

- Interface text should be concise and task-oriented.
- Do not add visible instructional text explaining how the UI works unless the
  operator needs it to complete a risky action.
- Product copy in `admin-ui` can be English-first; user-facing public product
  strings still follow the web i18n rules in the root guide.
