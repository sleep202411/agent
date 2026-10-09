import { readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";
import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";
import { beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  options: null as DeepSeekHarnessOptions | null,
  run: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@deepseek-ai/dsh-sdk-client", () => ({
  DeepSeekHarness: class {
    constructor(options: DeepSeekHarnessOptions) {
      runtime.options = options;
    }
    run = runtime.run;
    close = runtime.close;
  },
}));
import { runAppearanceDesign } from "./harness.js";

const environment = {
  GAME_AGENT_MODEL: "qwen3.7-flash",
  GAME_AGENT_OPENAI_BASE_URL: "http://127.0.0.1:9999/v1",
  GAME_AGENT_OPENAI_API_KEY: "test-secret",
  DATABASE_URL: "must-never-reach-the-runtime",
};
const presentation = {
  theme: {
    version: 1 as const,
    name: "Centered choices",
    css: '[data-experience-ui-region="choices"]{align-items:center}[data-experience-ui-region="choices"] [data-ui-part="list"]{flex-direction:column}',
    assets: [],
  },
};
const request = (): AppearanceDesignRequest => ({
  requestId: randomUUID(),
  prompt: "Center the choices",
  locale: "en-US",
  appearance: { version: 1 },
  context: { title: "A story", choiceLabels: ["Continue"] },
  history: [],
});
beforeEach(() => {
  runtime.options = null;
  runtime.run.mockReset();
  runtime.close.mockReset().mockResolvedValue(undefined);
});

async function patch() {
  return JSON.parse(await readFile(runtime.options!.patches![0]!, "utf8")) as Array<{
    id?: string;
    disabled?: boolean;
    insert?: Array<{ id: string; config: Record<string, unknown> }>;
  }>;
}

it("isolates credentials, removes shell tools and honors the Flash non-thinking profile", async () => {
  const input = request();
  runtime.run.mockImplementation(async () => {
    const entries = await patch();
    const tools = entries
      .flatMap((entry) => entry.insert ?? [])
      .find((entry) => entry.id === "fizzdragon-appearance-tools")!;
    await writeFile(
      tools.config.resultPath as string,
      JSON.stringify({
        requestId: input.requestId,
        appearance: { ...input.appearance, presentation },
        message: "Done",
      })
    );
    const provider = entries
      .flatMap((entry) => entry.insert ?? [])
      .find((entry) => entry.id === "llm-pi-ai")!;
    expect(provider.config).toMatchObject({
      providers: { "fizzdragon-model": { reasoning: "off", compat: { thinkingFormat: "qwen" } } },
    });
    expect(entries.find((entry) => entry.id === "persistent-bash")?.disabled).toBe(true);
    return { finalResponse: "Done" };
  });
  await expect(
    runAppearanceDesign(input, { environment, signal: new AbortController().signal })
  ).resolves.toMatchObject({ requestId: input.requestId });
  expect(runtime.options!.env).not.toHaveProperty("DATABASE_URL");
  expect(runtime.options!.env).not.toHaveProperty("HOME");
  expect(runtime.close).toHaveBeenCalledOnce();
  await expect(access(dirname(runtime.options!.patches![0]!))).rejects.toThrow();
});

it("refuses a result correlated to another request and cleans up its runtime", async () => {
  const input = request();
  runtime.run.mockImplementation(async () => {
    const tools = (await patch())
      .flatMap((entry) => entry.insert ?? [])
      .find((entry) => entry.id === "fizzdragon-appearance-tools")!;
    await writeFile(
      tools.config.resultPath as string,
      JSON.stringify({
        requestId: randomUUID(),
        appearance: { ...input.appearance, presentation },
        message: "Done",
      })
    );
    return { finalResponse: "Done" };
  });
  await expect(
    runAppearanceDesign(input, { environment, signal: new AbortController().signal })
  ).rejects.toThrow("does not match");
  expect(runtime.close).toHaveBeenCalledOnce();
});

it("closes a running subprocess on cancellation instead of waiting for an SDK request timeout", async () => {
  const controller = new AbortController();
  runtime.run.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        runtime.close.mockImplementation(async () => {
          reject(new Error("Runtime closed"));
        });
      })
  );
  const operation = runAppearanceDesign(request(), { environment, signal: controller.signal });
  const rejected = expect(operation).rejects.toThrow();
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalled());
  controller.abort();
  await rejected;
  expect(runtime.close).toHaveBeenCalled();
  await expect(access(dirname(runtime.options!.patches![0]!))).rejects.toThrow();
});

it("redacts a provider credential from errors sent toward the browser", async () => {
  runtime.run.mockRejectedValue(new Error("Provider rejected test-secret"));
  await expect(
    runAppearanceDesign(request(), { environment, signal: new AbortController().signal })
  ).rejects.toThrow("Provider rejected [redacted]");
});
