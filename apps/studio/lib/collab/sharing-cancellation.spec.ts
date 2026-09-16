import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMember,
  updateMemberRole,
  removeMember,
  createInvite,
  revokeInvite,
  type ShareScope,
} from "./sharing-api";
const transport = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: transport }));
describe("sharing write cancellation forwarding", () => {
  beforeEach(() => {
    for (const method of Object.values(transport)) method.mockReset().mockResolvedValue({});
  });
  it.each(["workspace", "project", "story-project"] as const)(
    "forwards the same signal for all %s writes",
    async (kind) => {
      const scope: ShareScope = { kind, id: "target", name: "Target" };
      const signal = new AbortController().signal;
      await addMember(scope, "member@example.test", "viewer", signal);
      expect(transport.post.mock.calls.at(-1)?.[1].signal).toBe(signal);
      await updateMemberRole(scope, "member", "viewer", signal);
      expect(transport.patch.mock.calls.at(-1)?.[1].signal).toBe(signal);
      await removeMember(scope, "member", signal);
      expect(transport.delete.mock.calls.at(-1)?.[1].signal).toBe(signal);
      await createInvite(scope, "viewer", undefined, signal);
      expect(transport.post.mock.calls.at(-1)?.[1]).toMatchObject({
        signal,
        data: { role: "viewer", expiresInDays: 7 },
      });
      await revokeInvite(scope, "invite", signal);
      expect(transport.delete.mock.calls.at(-1)?.[1].signal).toBe(signal);
    }
  );
});
