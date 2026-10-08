// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CourseCertificateEditor } from "./course-certificate-editor";

vi.mock("@/components/admin/billing/shared", () => ({
  FormLabel: ({ label, help, children }: { label: string; help?: string; children: ReactNode }) => (
    <label>
      {label}
      {help ? <span>{help}</span> : null}
      {children}
    </label>
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const onChange = vi.fn();
const levels = [
  { id: 1, name: "FD-I" },
  { id: 13, name: "AI Producer" },
  { id: 20, name: "Honorary" },
];
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(response(levels));
  onChange.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const render = (value = "", session = "alice") =>
  act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey={session}>
        <CourseCertificateEditor value={value} onChange={onChange} />
      </AdminSessionBoundary>
    )
  );
it("lists every Java level as text without images", async () => {
  await render();
  expect(host.textContent).toContain("完成课程后可以获得相应认证");
  expect([...host.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
    "未指定证书",
    "FD-I",
    "AI Producer",
    "Honorary",
  ]);
  expect(host.querySelector("img")).toBeNull();
});
it("reports the selected certificate to the course form", async () => {
  await render();
  await act(async () => {
    const node = host.querySelector("select")!;
    node.value = "13";
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("13");
});
it("shows catalogue errors without offering an empty fake selector", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Regional catalogue unavailable"));
  await render();
  expect(host.textContent).toContain("Regional catalogue unavailable");
  expect(host.querySelector("select")).toBeNull();
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
  fetchMock.mockResolvedValueOnce(response(levels));
  await render("", "bob");
  expect(firstSignal.aborted).toBe(true);
  await act(async () => complete(response([{ id: 13, name: "AI Producer" }])));
  expect(host.querySelector("select")?.value).toBe("");
});
