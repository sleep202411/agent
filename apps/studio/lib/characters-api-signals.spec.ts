import { expect, it, vi } from "vitest";
const wire = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("./api", () => ({ api: wire, ApiRequestError: class extends Error {} }));
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  createCastingInvite,
  listCastingInvites,
  revokeCastingInvite,
  previewCastingInvite,
  acceptCastingInvite,
  listProjectGrants,
  createProjectGrant,
  revokeProjectGrant,
  listLikenessOutputs,
  takedownLikenessOutputs,
  createEnrollmentSession,
  completeEnrollment,
  getEnrollmentStatus,
  REAL_PERSON_GRANT_CONSENT_VERSION,
} from "./characters-api";
it("forwards cancellation for casting, grant, output and enrollment operations", async () => {
  wire.get.mockResolvedValue({ items: [] });
  wire.post.mockResolvedValue({});
  wire.patch.mockResolvedValue({});
  wire.delete.mockResolvedValue(undefined);
  const signal = new AbortController().signal,
    consent = { version: REAL_PERSON_GRANT_CONSENT_VERSION, adultAttested: true as const };
  const cases = [
    () => createCharacter({ workspaceId: "w", kind: "virtual", name: "Actor" }, signal),
    () => updateCharacter("c", { name: "Updated" }, signal),
    () => deleteCharacter("c", signal),
    () => createCastingInvite("p", { inviteeUserId: "u" }, signal),
    () => listCastingInvites("p", signal),
    () => revokeCastingInvite("p", "i", signal),
    () => previewCastingInvite("t", signal),
    () => acceptCastingInvite("t", "c", consent, signal),
    () => listProjectGrants("c", signal),
    () => createProjectGrant("c", "p", consent, signal),
    () => revokeProjectGrant("c", "p", signal),
    () => listLikenessOutputs("c", "p", signal),
    () => takedownLikenessOutputs("c", { jobId: "j" }, signal),
    () => createEnrollmentSession("c", signal),
    () => completeEnrollment("c", signal),
    () => getEnrollmentStatus("c", signal),
  ];
  for (const call of cases) {
    vi.clearAllMocks();
    await call();
    const args = [
      ...wire.get.mock.calls,
      ...wire.patch.mock.calls,
      ...wire.post.mock.calls,
      ...wire.delete.mock.calls,
    ];
    expect(args).toHaveLength(1);
    expect(args[0][1].signal).toBe(signal);
  }
});
