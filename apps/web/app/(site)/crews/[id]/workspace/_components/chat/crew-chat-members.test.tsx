import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewChatMembers } from "./crew-chat-members";
import type { CrewMemberDTO } from "@/app/(site)/crews/_hooks/types";

vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../members/members-grid", () => ({
  MemberDecision: ({ id, kind }: { id: string; kind: string }) => (
    <div role="dialog">
      {kind}:{id}
    </div>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const members = [
  { id: "owner-membership", userId: "owner", isOwner: true },
  { id: "member-membership", userId: "member", isOwner: false },
] as CrewMemberDTO[];
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("offers removal only with permission and protects the owner", async () => {
  await act(async () =>
    root.render(
      <CrewChatMembers crewId="crew" crewName="Crew" members={members} onInvite={() => {}} />
    )
  );
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "remove")
  ).toBe(false);
  await act(async () =>
    root.render(
      <CrewChatMembers
        crewId="crew"
        crewName="Crew"
        members={members}
        canRemove
        onInvite={() => {}}
      />
    )
  );
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "remove")!.click()
  );
  expect(host.querySelector('[aria-label="remove owner"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="remove member"]')!.click()
  );
  expect(host.querySelector('[role="dialog"]')?.textContent).toBe("remove:member-membership");
});
