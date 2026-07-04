/**
 * Jest setupFiles shim: harmless defaults for env vars that fail-loud AT
 * MODULE LOAD (integrations/java/java-config.ts). Unit tests never talk to
 * Java, but importing any service whose graph reaches that module (billing →
 * referrals → java user-lookup) would otherwise explode before a single test
 * runs. `??=` keeps real values when a caller sets them explicitly.
 */
process.env.JAVA_CONTENT_URL ??= 'http://java-content.test.invalid';
process.env.JAVA_STUDIO_URL ??= 'http://java-studio.test.invalid';
process.env.JAVA_USER_QUERY_PWD ??= 'test-only';
