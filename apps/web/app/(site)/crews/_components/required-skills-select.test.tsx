import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RequiredSkillsSelect } from "./required-skills-select";

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "owner" } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../_hooks/api", () => ({ crewApi: { get: h.get } }));

let host: HTMLDivElement, root: Root, client: QueryClient;
function Form({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RequiredSkillsSelect value={value} onChange={setValue} />
      <output>{JSON.stringify(value)}</output>
    </>
  );
}
const render = async (initial?: string[]) => {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Form initial={initial} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.get.mockReset().mockResolvedValue({ skills: ["Editing", "Animation", "Sound"] });
  host = document.createElement("div");
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("selects multiple skills and removes one without clearing the others", async () => {
  await render();
  const choices = host.querySelectorAll<HTMLButtonElement>("[role=checkbox]");
  act(() => choices[0]!.click());
  act(() => choices[1]!.click());
  expect(host.querySelector("output")!.textContent).toBe('["Editing","Animation"]');
  act(() => choices[0]!.click());
  expect(host.querySelector("output")!.textContent).toBe('["Animation"]');
});
it("preserves saved selections when the catalog cannot be loaded", async () => {
  h.get.mockRejectedValue(new Error("Catalog unavailable"));
  await render(["Editing", "Sound"]);
  expect(host.querySelector("[role=alert]")!.textContent).toContain("Catalog unavailable");
  expect(host.querySelector("output")!.textContent).toBe('["Editing","Sound"]');
  act(() => host.querySelector<HTMLButtonElement>("[role=checkbox]")!.click());
  expect(host.querySelector("output")!.textContent).toBe('["Sound"]');
});

it("submits canonical FD role names while explaining their capabilities", async () => {
  h.get.mockResolvedValue({ skills: ["FD-I", "FD-II", "Editor"] });
  await render();
  expect(host.textContent).toContain("fd1Name");
  expect(host.textContent).toContain("fd2Name");
  const choices = host.querySelectorAll<HTMLButtonElement>("[role=checkbox]");
  act(() => choices[0]!.click());
  expect(host.querySelector("output")!.textContent).toBe('["FD-I"]');
});
