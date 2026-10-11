# App Story Agent

Dedicated native App story production, authorized independently of Agent OS.
Read `README.md` before changing the runtime or Server integration, and
`DESIGN.md` before changing its App-only H5.

- Official DeepSeek Harness ACP owns the planner's model/tool loop. Do not add
  a second custom model loop, import Agent OS, or extend `apps/agent`.
- Harness can read the project and submit one typed decision. Production,
  permissions, asset storage, payment and playback remain in Server.
- App offers no planner model selector, permission modes or technical tool
  cards. Video model selection is allowed only inside an unconfirmed quote.
- Pin planning, authoring and media models at admission. Configuration errors
  must fail loudly; never substitute another regional provider or model.
- Persist accepted requests and progress before executing work. Retries recover
  receipts; new spending requires a current production lease and authorization.
- Keep completed assets on interruption. Never claim success until persisted
  content and the working preview pass validation. Publication is explicit.
- `src` owns the Node runtime and local bridge; `ui` owns the React H5. Keep
  their imports and builds separate. Do not depend on Studio or introduce a
  Next.js app. Shared player and protocol packages remain the reuse boundaries.
- One focused suite per runtime boundary is sufficient. Exercise real ACP,
  persistence and transport races; avoid assertions that mirror implementation.
- Do not deploy, migrate a remote database or enable the feature without an
  explicit release assignment and regional configuration.
