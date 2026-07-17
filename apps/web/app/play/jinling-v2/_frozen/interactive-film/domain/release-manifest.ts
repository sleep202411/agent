/**
 * Web compatibility boundary for the shared interactive-film runtime contract.
 *
 * Runtime manifests are authored by Story builds and consumed by both Studio
 * preview and the Web player. Keep the contract itself in @repo/shared so the
 * three surfaces cannot drift into separate manifest dialects.
 */
export * from "../../shared/interactive-film-runtime";
