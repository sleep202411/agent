/**
 * Jest setupFiles shim: harmless defaults for env vars that fail-loud AT
 * MODULE LOAD (integrations/java/java-config.ts). Unit tests never talk to
 * Java, but importing any service whose graph reaches that module (billing →
 * referrals → java user-lookup) would otherwise explode before a single test
 * runs. `??=` keeps real values when a caller sets them explicitly.
 */
process.env.JAVA_CONTENT_URL ??= 'http://java-content.test.invalid';
process.env.JAVA_STUDIO_URL ??= 'http://java-studio.test.invalid';
process.env.JAVA_ADMIN_API_TOKEN ??= 'test-only-publication-service-token';
process.env.JAVA_USER_QUERY_PWD ??= 'test-only';
process.env.REDIS_URL ??= 'redis://redis.test.invalid:6379';
process.env.LEGACY_OSS_BASE_URL ??= 'https://legacy-oss.test.invalid';

process.env.NEXT_PUBLIC_SITE_REGION ??= 'com';
process.env.MASTRA_URL ??= 'http://agent.test.invalid';
process.env.AGENT_OS_WORKER_URL ??= 'http://worker.test.invalid';
