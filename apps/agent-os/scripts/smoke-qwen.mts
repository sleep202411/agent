/**
 * Live smoke: one chat completion against configured Qwen / OpenAI-compatible endpoint.
 * Usage (from repo root):
 *   npm run smoke:qwen -w agent-os
 *
 * Loads apps/agent-os/.env via `tsx --env-file=.env`.
 */
import { createLiteLlmChatModel, readLiteLlmConfigFromEnv } from "@repo/model-router";
import { HumanMessage } from "@langchain/core/messages";

async function main(): Promise<void> {
  const cfg = readLiteLlmConfigFromEnv();
  const model = createLiteLlmChatModel({ profileId: "qwen-plus", config: cfg });
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      msg: "agent-os.smoke-qwen.start",
      baseUrl: cfg.baseUrl,
      model: "qwen-plus",
    })}\n`,
  );

  const result = await model.invoke([
    new HumanMessage(
      "Reply with exactly one short sentence confirming you are Qwen and ready for FizzDragon Agent OS tests.",
    ),
  ]);

  const text =
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);

  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      msg: "agent-os.smoke-qwen.ok",
      content: text,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      msg: "agent-os.smoke-qwen.failed",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
