import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIpGenerationPreview } from "./use-ip-generation-preview";
const h = vi.hoisted(() => ({ generation: 1, post: vi.fn() }));
vi.mock("@/auth", () => ({ useAuth: () => h }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
let root: Root;
let input: Parameters<typeof useIpGenerationPreview>[0];
let latest: ReturnType<typeof useIpGenerationPreview>;
function Harness() {
  const result = useIpGenerationPreview(input);
  useLayoutEffect(() => {
    latest = result;
  });
  return null;
}
const render = () => act(() => root.render(<Harness />));
const cost = (computePoints: number) => ({ cost: { computePoints, isFree: false } });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  h.post.mockReset();
  input = { ipId: "ip", templateId: "one", requiresReference: false, referenceId: null };
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["template", "reference", "ip", "session"])(
  "hides the previous quote immediately when %s changes",
  async (change) => {
    h.post.mockResolvedValueOnce(cost(10));
    await act(async () => {
      render();
    });
    expect(latest.costPreview?.computePoints).toBe(10);
    let finish!: (value: ReturnType<typeof cost>) => void;
    h.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    if (change === "template") input.templateId = "two";
    if (change === "reference") input.referenceId = "image";
    if (change === "ip") input.ipId = "other";
    if (change === "session") h.generation += 1;
    render();
    expect(latest).toEqual({ costPreview: null, previewLoading: true, previewError: false });
    await act(async () => finish(cost(90)));
    expect(latest.costPreview?.computePoints).toBe(90);
  }
);

it("aborts old requests and ignores their late completion", async () => {
  let finish!: (value: ReturnType<typeof cost>) => void;
  h.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render();
  const signal = h.post.mock.calls[0][1].signal as AbortSignal;
  input.templateId = "two";
  h.post.mockResolvedValueOnce(cost(20));
  await act(async () => {
    render();
  });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(cost(1)));
  expect(latest.costPreview?.computePoints).toBe(20);
});

it("drops the quote and makes no request when a required reference is removed", async () => {
  input.requiresReference = true;
  input.referenceId = "image";
  h.post.mockResolvedValue(cost(10));
  await act(async () => {
    render();
  });
  input.referenceId = null;
  render();
  expect(latest).toEqual({ costPreview: null, previewLoading: false, previewError: false });
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("does not reuse an old quote when returning to an earlier template", async () => {
  h.post.mockResolvedValueOnce(cost(10));
  await act(async () => {
    render();
  });
  h.post.mockImplementation(() => new Promise(() => {}));
  input.templateId = "two";
  render();
  input.templateId = "one";
  render();
  expect(latest.costPreview).toBeNull();
  expect(latest.previewLoading).toBe(true);
});

it("settles failed previews without retaining an earlier cost", async () => {
  h.post.mockRejectedValue(new Error("unavailable"));
  await act(async () => {
    render();
  });
  expect(latest).toEqual({ costPreview: null, previewLoading: false, previewError: true });
});
