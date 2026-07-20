# Frozen demo —《金陵入梦 · 无字来客》v2

化石代码，**不维护**。唯一目的：让 `/play/jinling-v2` 这个老链接继续可访问。

- 内容取自 `a187e155`（该 demo 在 develop 上被 `1f83be19` 删除前的最后状态），
  连同当时的 `interactive-film` 播放组件和 `@repo/shared/interactive-film-runtime`
  schema 一起 vendor 在本目录内，与现行 story-film / experience-runtime 管线
  **零关联**——那边怎么改都不影响这里，这里也永远不该跟着升级。
- 三语文案内联在 `i18n/messages.ts`，不占用 `messages/*.json`。
- 对外部代码的全部依赖：`@/lib/utils` 的 `cn`、`@/src/i18n` 的 `useLocale`/`Locale`、
  `apps/web/public/jinling-rumeng/` 下的静态图。
- 媒体命脉：视频/音频是 `fizzdragonblob.blob.core.windows.net/foundry-outputs/
interactive-films/jinling-rumeng/`（s01/v1 + s01/v2）下的公开直链。若媒体迁移
  （如 Cloudflare R2）后该容器退役，需同步搬这两个前缀，否则本 demo 即告死亡。
- 删除方式：`rm -rf` 本路由目录 + `apps/web/public/jinling-rumeng/`，完事。
