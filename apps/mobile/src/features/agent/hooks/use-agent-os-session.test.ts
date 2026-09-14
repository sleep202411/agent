import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentOsSession } from "./use-agent-os-session";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  startRun: vi.fn(),
  resolveApproval: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/api-client", () => ({ api: {}, ApiRequestError: class extends Error {} }));
vi.mock("@/i18n", () => ({ getLocale: () => "en-US", t: (key: string) => key }));
vi.mock("../api/agent-os-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/agent-os-api")>()),
  agentOsApi: api,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let session: ReturnType<typeof useAgentOsSession>;
const projectId = "0195bcaa-1000-7000-8000-000000000001";
const chapterId = "0195bcaa-1000-7000-8000-000000000002";
async function mount() {
  function Probe() {
    session = useAgentOsSession({ projectId, chapterId, workbenchMode: "story" });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  api.listModels.mockResolvedValue({ mobileDefaultModelProfileId: "qwen3.7-flash" });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
});
it("keeps one user message when the initial response has no events and avoids a model request on every turn", async () => {
  await mount();
  api.startRun
    .mockResolvedValueOnce({ runId: "run-1", status: "completed", events: [] })
    .mockResolvedValueOnce({ runId: "run-2", status: "completed", events: [] });
  await act(async () => session.send("First request"));
  await act(async () => session.send("Second request"));
  expect(
    session.messages.filter((message) => message.role === "user").map((message) => message.text)
  ).toEqual(["First request", "Second request"]);
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.startRun).toHaveBeenCalledWith(
    expect.objectContaining({
      modelProfileId: "qwen3.7-flash",
      workbenchContext: { chapterId, experience: "mobile_h5" },
    })
  );
});
it("uses the server-admitted model for approval when the default changed", async () => {
  await mount();
  api.startRun.mockResolvedValue({
    runId: "run-1",
    status: "waiting_for_approval",
    pendingApproval: { approvalId: "approval-1" },
    events: [
      {
        id: "event-1",
        sequence: 1,
        type: "RunStarted",
        timestamp: new Date().toISOString(),
        data: { modelProfileId: "server-new-model" },
      },
    ],
  });
  api.resolveApproval.mockResolvedValue({ runId: "run-1", status: "completed", events: [] });
  await act(async () => session.send("Continue"));
  expect(session.session.modelProfileId).toBe("server-new-model");
  await act(async () => session.approve("approve"));
  expect(api.resolveApproval).toHaveBeenCalledWith(
    expect.objectContaining({ modelProfileId: "server-new-model", approvalId: "approval-1" })
  );
  expect(session.session.status).toBe("completed");
});
