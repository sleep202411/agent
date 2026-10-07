// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CourseCertificateEditor } from "./course-certificate-editor";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const initial = {
  courseId: "42",
  certificateId: null,
  version: 0,
  certificates: [{ id: 13, name: "AI Producer" }],
};
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(response(initial));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const render = (session = "alice") =>
  act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey={session}>
        <CourseCertificateEditor courseId="42" />
      </AdminSessionBoundary>
    )
  );
async function select(value: string) {
  await act(async () => {
    const node = host.querySelector("select")!;
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click()
  );
}
it("loads an unmapped course and saves the selected certificate with its revision", async () => {
  await render();
  expect(host.textContent).toContain("No certificate assigned");
  await select("13");
  fetchMock.mockResolvedValueOnce(response({ ...initial, certificateId: 13, version: 1 }));
  await click("Save Certificate");
  const [, options] = fetchMock.mock.calls.at(-1)!;
  expect(JSON.parse(options.body)).toEqual({ certificateId: 13, expectedVersion: 0 });
  expect(host.textContent).toContain("Certificate mapping saved.");
});
it("preserves the choice after a failed save and reloads authoritative state on conflict", async () => {
  await render();
  await select("13");
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "This mapping changed. Reload it before saving." }), {
      status: 409,
    })
  );
  await click("Save Certificate");
  expect(host.querySelector("select")!.value).toBe("13");
  expect(host.textContent).toContain("This mapping changed");
  fetchMock.mockResolvedValueOnce(response({ ...initial, certificateId: 13, version: 2 }));
  await click("Reload Mapping");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("cancels a read when the administrator changes", async () => {
  let complete!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  await render();
  const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fetchMock.mockResolvedValueOnce(response(initial));
  await render("bob");
  expect(firstSignal.aborted).toBe(true);
  await act(async () => complete(response({ ...initial, certificateId: 13 })));
  expect(host.querySelector("select")!.value).toBe("");
});
it("shows catalogue errors without offering an empty fake selector", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Regional catalogue unavailable"));
  await render();
  expect(host.textContent).toContain("Regional catalogue unavailable");
  expect(host.querySelector("select")).toBeNull();
});
