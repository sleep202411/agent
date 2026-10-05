import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewIpCreateForm } from "./new-ip-create-form";
const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  push: vi.fn(),
  taxonomyError: false,
  retry: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/en-US/ips",
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useCreateIpCommerceIp: () => ({ isPending: false, mutate: vi.fn() }),
  useIpCommerceTaxonomyTerms: () => ({
    data: { items: [] },
    isLoading: false,
    isError: mocks.taxonomyError,
    isFetching: false,
    refetch: mocks.retry,
  }),
}));
vi.mock("@/app/(site)/ip-studio/_hooks/use-new-ip-spark", () => ({
  useNewIpSparkAnalyze: () => ({ mutateAsync: mocks.analyze }),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogBody: Wrap,
    DialogContent: Wrap,
    DialogFooter: Wrap,
    DialogHero: () => null,
  };
});
let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.analyze.mockReset();
  mocks.taxonomyError = false;
  mocks.retry.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<NewIpCreateForm />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function field(kind: "name" | "description") {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[placeholder="${kind === "name" ? "fieldNamePlaceholder" : "fieldDescriptionPlaceholder"}"]`
  )!;
}
async function edit(kind: "name" | "description", value: string) {
  await act(async () => {
    const target = field(kind);
    const proto = kind === "name" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function upload() {
  let resolve!: (value: { name: string; description: string }) => void;
  mocks.analyze.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => {
    const target = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(target, "files", {
      configurable: true,
      value: [new File(["brief"], "brief.txt")],
    });
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return async (draft = { name: "AI title", description: "AI summary" }) => {
    await act(async () => resolve(draft));
  };
}
it("preserves name and description typed while analysis is pending", async () => {
  const finish = await upload();
  await edit("name", "My title");
  await edit("description", "My summary");
  await finish();
  expect(field("name").value).toBe("My title");
  expect(field("description").value).toBe("My summary");
  expect(container.textContent).not.toContain("aiSuggested");
});
it("fills fields explicitly cleared while analysis is pending", async () => {
  await edit("name", "Old title");
  await edit("description", "Old summary");
  const finish = await upload();
  await edit("name", "");
  await edit("description", "");
  await finish();
  expect(field("name").value).toBe("AI title");
  expect(field("description").value).toBe("AI summary");
});
it("fills only the field still empty when analysis completes", async () => {
  const finish = await upload();
  await edit("name", "My title");
  await finish();
  expect(field("name").value).toBe("My title");
  expect(field("description").value).toBe("AI summary");
});
it("ignores a superseded file response", async () => {
  const first = await upload();
  const second = await upload();
  await first();
  expect(field("name").value).toBe("");
  await second();
  expect(field("name").value).toBe("AI title");
});

it("offers taxonomy retry without clearing the creator draft", async () => {
  await edit("name", "My channel");
  await edit("description", "My summary");
  mocks.taxonomyError = true;
  await act(async () => root.render(<NewIpCreateForm />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("taxonomyLoadFailed");
  expect(container.textContent).not.toContain("taxonomyEmpty");
  const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "retry")!;
  await act(async () => retry.click());
  expect(mocks.retry).toHaveBeenCalledOnce();
  mocks.taxonomyError = false;
  await act(async () => root.render(<NewIpCreateForm />));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(field("name").value).toBe("My channel");
  expect(field("description").value).toBe("My summary");
});

it("limits AI-filled fields to the same lengths as manual entry", async () => {
  const finish = await upload();
  await finish({ name: "N".repeat(100), description: "D".repeat(500) });
  expect(field("name").value).toBe("N".repeat(80));
  expect(field("description").value).toBe("D".repeat(280));
});
it("keeps creator text while limiting the remaining AI-filled field", async () => {
  const finish = await upload();
  await edit("description", "My own summary");
  await finish({ name: "N".repeat(100), description: "D".repeat(500) });
  expect(field("name").value).toBe("N".repeat(80));
  expect(field("description").value).toBe("My own summary");
});

it("shows the analysis failure while retaining the new IP draft", async () => {
  mocks.analyze.mockRejectedValueOnce(new Error("HTTP 503 — AI provider is not configured."));
  await edit("name", "Keep this title");
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["brief"], "brief.txt")],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("HTTP 503 — AI provider is not configured.");
  expect(field("name").value).toBe("Keep this title");
});
