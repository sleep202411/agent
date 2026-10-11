export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const baseUrl = required("APP_STORY_AGENT_BASE_URL");
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("APP_STORY_AGENT_BASE_URL must be HTTPS or a loopback HTTP fixture.");
  const port = Number(env.APP_STORY_AGENT_PORT ?? 4397);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid APP_STORY_AGENT_PORT.");
  const token = required("APP_STORY_AGENT_INTERNAL_TOKEN");
  if (token.length < 32)
    throw new Error("APP_STORY_AGENT_INTERNAL_TOKEN must have at least 32 characters.");
  const model = required("APP_STORY_AGENT_MODEL");
  // Capacity advertised by the pinned Model Studio route; other routes must declare their own.
  const contextWindow = Number(
    env.APP_STORY_AGENT_CONTEXT_WINDOW ??
      (model === "qwen-plus" ? 1_000_000 : required("APP_STORY_AGENT_CONTEXT_WINDOW"))
  );
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 8192)
    throw new Error("Invalid APP_STORY_AGENT_CONTEXT_WINDOW.");
  return {
    baseUrl,
    model,
    contextWindow,
    apiKey: required("APP_STORY_AGENT_API_KEY"),
    token,
    port,
    host: env.APP_STORY_AGENT_BIND_ADDRESS ?? "127.0.0.1",
  };
}
export type Config = ReturnType<typeof readConfig>;
