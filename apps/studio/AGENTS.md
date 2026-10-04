<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Design system

Read `../../DESIGN.md` for shared FizzDragon brand rules, then `DESIGN.md`
in this directory — it is the binding spec for this app (dark-only,
monochrome zero-chroma tokens, no control borders, brand red never as a
token, English-only strings). Do not import the web or admin-ui design
language.

## Interactive-movie export scope — Isaac's clarification

Video merging and merged-film export are deliberately outside the current
interactive-movie scope. Do not add browser merge/export buttons to the Story
timeline editor. Keep timeline editing and preview available. Revisit merged
video export only after a confirmed product need and a server-side design;
browser encoder work is not a current Story delivery requirement.

## State management

Every piece of state has exactly one home. Pick by where its truth lives:

1. **Server truth → TanStack Query.** Anything the backend owns (projects,
   drafts, balances, run/batch progress) is fetched, cached, invalidated and
   polled through react-query. Never copy query data into a store.
2. **Client-shared truth → Zustand** (one store per domain, e.g.
   `project-ui-store`). Cross-component UI state only: panel open/closed,
   selection, canvas view mode. No Provider plumbing, no new Contexts for
   this layer.
3. **Component-local truth → `useState`.** A field value or a dialog toggle
   used by one component stays local. Do not lift it into a store.

Red lines: server data never enters a Zustand store (two sources of truth
will drift), and state worth deep-linking (active chapter, current step,
selected project) lives in the URL, not in memory.
