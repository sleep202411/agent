import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StoryCanvasEncoder } from "./story-canvas-encoder";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasGenerationJob } from "../../../../canvas-editor/generation-schema";
const h = vi.hoisted(() => ({ send: vi.fn(), receive: null as null | ((value: string) => void) }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("react-native", () => ({ View: "div" }));
vi.mock("./story-canvas-runtime-frame", async () => {
  const React = await import("react");
  return {
    CanvasRuntimeFrame: React.forwardRef(function Frame(
      props: { onMessage(value: string): void },
      ref
    ) {
      React.useImperativeHandle(ref, () => ({ send: h.send }));
      h.receive = props.onMessage;
      return null;
    }),
  };
});
it("forwards canvas jobs to the runtime and accepts only the matching result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const documentId = "22222222-2222-4222-8222-222222222222";
  const loaded: CanvasLoaded = {
    type: "loaded",
    sessionId,
    documentId,
    sequence: 3,
    requestId: 1,
    state: "AAA=",
    snapshot: { meta: {}, nodes: {}, edges: {}, groups: {}, assets: {} },
  };
  const job = { id: documentId } as CanvasGenerationJob;
  const result = vi.fn(),
    error = vi.fn();
  try {
    await act(async () => {
      root.render(
        <StoryCanvasEncoder
          loaded={loaded}
          edit={{ action: "generation", job }}
          generation={1}
          title="Canvas"
          runtimeError="Runtime error"
          onResult={result}
          onError={error}
        />
      );
    });
    await act(async () => {
      h.receive!(JSON.stringify({ type: "ready", sessionId }));
    });
    expect(h.send).toHaveBeenCalledWith({
      type: "generation",
      sessionId,
      documentId,
      sequence: 3,
      requestId: 1,
      snapshot: "AAA=",
      job,
    });
    const reply = { ...loaded, type: "edited", yjsUpdateBase64: "AQI=" };
    await act(async () => {
      h.receive!(JSON.stringify({ ...reply, documentId: sessionId }));
    });
    expect(result).not.toHaveBeenCalled();
    await act(async () => {
      h.receive!(JSON.stringify(reply));
      h.receive!(JSON.stringify(reply));
    });
    expect(result).toHaveBeenCalledExactlyOnceWith("AQI=");
    expect(error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
