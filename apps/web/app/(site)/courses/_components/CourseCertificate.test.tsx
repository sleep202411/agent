import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseCertificate } from "./CourseCertificate";

const assigned = vi.hoisted(() => ({
  current: {
    data: null as {
      id: number;
      name: string;
      imagePath: string | null;
      iconUrl: string;
    } | null,
    isPending: false,
    error: null as Error | null,
    isFetching: false,
    refetch: () => undefined,
  },
}));
vi.mock("@/src/hooks/use-courses-public", () => ({
  useAssignedCourseCertificate: () => assigned.current,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
}));

let root: Root;
let host: HTMLDivElement;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CourseCertificate courseId={68} />
      </QueryClientProvider>
    );
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  assigned.current = {
    data: null,
    isPending: false,
    error: null,
    isFetching: false,
    refetch: () => undefined,
  };
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("shows the assigned certificate artwork and name", async () => {
  assigned.current.data = {
    id: 3,
    name: "Art direction",
    imagePath: "static/art.png",
    iconUrl: "https://static.fizzspace.cn/static/art.png",
  };
  await render();
  expect(host.textContent).toContain("skillCertificate");
  expect(host.textContent).toContain("Art direction");
  expect(host.textContent).toContain("certificateApproval");
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "https://static.fizzspace.cn/static/art.png"
  );
  expect(host.querySelector("img")?.getAttribute("alt")).toBe("Art direction");
});
