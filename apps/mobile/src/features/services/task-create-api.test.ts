import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createTask } from "./task-create-api";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));

const id = "11111111-1111-4111-8111-111111111111";
const detail = {
  taskKind: "script" as const,
  rewardUsdMinor: 0,
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Render",
  submissions: [],
  version: 1,
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  status: "submitted",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
};
const input = {
  taskKind: "script" as const,
  rewardUsdMinor: 0,
  parentId: null,
  blockedByTaskIds: [],
  title: " Shot ",
  description: " Render ",
  priority: "normal" as const,
  startAt: null,
  dueAt: detail.dueAt,
  assignees: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T00:00:00Z"));
});
afterEach(() => vi.restoreAllMocks());
it("creates a task with explicit type and zero reward", async () => {
  vi.mocked(api.post).mockResolvedValue(detail);
  await createTask("crew", input);
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/tasks", {
    service: "aurora",
    data: { ...input, title: "Shot", description: "Render" },
  });
});
it("rejects blank/oversized fields, duplicate assignees and date inversion before writes", async () => {
  for (const change of [
    { title: " " },
    { title: "x".repeat(181) },
    { description: "x".repeat(10001) },
    { startAt: "2027-01-01T00:00:00Z" },
    {
      assignees: [
        { userId: "1", currency: "USD" as const },
        { userId: "1", currency: "USD" as const },
      ],
    },
  ])
    await expect(createTask("crew", { ...input, ...change })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("requires returned Crew, content, dates and assignments to match", async () => {
  for (const change of [
    { crewId: "other" },
    { title: "Wrong" },
    { description: "Wrong" },
    { priority: "urgent" },
    { dueAt: null },
    { assignees: [{ id, userId: "other" }] },
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, ...change });
    await expect(createTask("crew", input)).rejects.toThrow("acknowledgement");
  }
});
it("does not retry failed creation automatically", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Offline"));
  await expect(createTask("crew", input)).rejects.toThrow("Offline");
  expect(api.post).toHaveBeenCalledOnce();
});

it("validates relationship identifiers, limits and acknowledgement", async () => {
  const related = "22222222-2222-4222-8222-222222222222";
  for (const fields of [
    { parentId: "invalid" },
    { blockedByTaskIds: [related, related] },
    { blockedByTaskIds: Array(51).fill(related) },
  ]) {
    await expect(createTask("crew", { ...input, ...fields })).rejects.toThrow();
  }
  expect(api.post).not.toHaveBeenCalled();
  const ref = {
    id: related,
    number: 2,
    title: "Parent",
    status: "open",
    workflowState: { name: "Open" },
    parentId: null,
  };
  const data = { ...input, parentId: related, blockedByTaskIds: [related] };
  vi.mocked(api.post).mockResolvedValue({
    ...detail,
    parent: ref,
    blockedBy: [{ ...ref, resolved: false }],
  });
  await expect(createTask("crew", data)).resolves.toMatchObject({ parent: ref });
  vi.mocked(api.post).mockResolvedValue(detail);
  await expect(createTask("crew", data)).rejects.toThrow("acknowledgement");
});

it("validates an explicit workflow and requires its exact acknowledgement", async () => {
  await expect(createTask("crew", { ...input, workflowStateId: "bad" })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
  const selected = { ...input, workflowStateId: id };
  vi.mocked(api.post).mockResolvedValue({ ...detail, workflowStateId: id });
  await expect(createTask("crew", selected)).resolves.toMatchObject({ workflowStateId: id });
  for (const workflowStateId of [undefined, "22222222-2222-4222-8222-222222222222"]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, workflowStateId });
    await expect(createTask("crew", selected)).rejects.toThrow("acknowledgement");
  }
});

it("validates planning references and exact creation acknowledgement", async () => {
  for (const fields of [
    { cycleId: "bad" },
    { episodeId: "bad" },
    { labelIds: [id, id] },
    { labelIds: Array(21).fill(id) },
  ]) {
    await expect(createTask("crew", { ...input, ...fields })).rejects.toThrow();
  }
  expect(api.post).not.toHaveBeenCalled();
  const data = { ...input, cycleId: id, episodeId: id, labelIds: [id] };
  const response = { ...detail, cycleId: id, episodeId: id, labels: [{ id, name: "Art" }] };
  vi.mocked(api.post).mockResolvedValue(response);
  await expect(createTask("crew", data)).resolves.toMatchObject({ cycleId: id, episodeId: id });
  for (const fields of [
    { cycleId: null },
    { episodeId: null },
    { labels: [] },
    { labels: [{ id: "22222222-2222-4222-8222-222222222222", name: "Wrong" }] },
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...response, ...fields });
    await expect(createTask("crew", data)).rejects.toThrow("acknowledgement");
  }
  vi.mocked(api.post).mockResolvedValue({ ...detail, cycleId: null, episodeId: null });
  await expect(
    createTask("crew", { ...input, cycleId: null, episodeId: null, labelIds: [] })
  ).resolves.toBeDefined();
});

it("validates task kind and requires matching creation acknowledgement", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...detail, taskKind: "storyboard" });
  await expect(createTask("crew", { ...input, taskKind: "storyboard" })).resolves.toMatchObject({
    taskKind: "storyboard",
  });
  for (const taskKind of [undefined, null, "art"]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, taskKind });
    await expect(createTask("crew", { ...input, taskKind: "storyboard" })).rejects.toThrow(
      "acknowledgement"
    );
  }
  vi.mocked(api.post).mockResolvedValue({ ...detail, taskKind: null });
  await expect(createTask("crew", { ...input, taskKind: null })).rejects.toThrow(
    "required task fields"
  );
});

it("preserves explicit zero and nullable planning limits and rejects mismatched acknowledgements", async () => {
  for (const value of [0, null, 5]) {
    const limits = { estimatePoints: value, revisionLimit: value };
    vi.mocked(api.post).mockResolvedValue({ ...detail, ...limits });
    await createTask("crew", { ...input, ...limits });
    expect(api.post).toHaveBeenLastCalledWith("/crews/crew/tasks", {
      service: "aurora",
      data: expect.objectContaining(limits),
    });
  }
  for (const result of [
    { estimatePoints: null, revisionLimit: 0 },
    { estimatePoints: 0, revisionLimit: null },
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, ...result });
    await expect(
      createTask("crew", { ...input, estimatePoints: 0, revisionLimit: 0 })
    ).rejects.toThrow("acknowledgement");
  }
});
it("rejects out-of-range and fractional creation limits before writing", async () => {
  for (const change of [
    { estimatePoints: -1 },
    { estimatePoints: 1000001 },
    { estimatePoints: 1.5 },
    { revisionLimit: -1 },
    { revisionLimit: 101 },
    { revisionLimit: 1.5 },
  ])
    await expect(createTask("crew", { ...input, ...change })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});

it("verifies sparse custom-field creation values including false and zero", async () => {
  for (const value of [false, 0, "Brief", ["a", "b"]]) {
    const rows = [{ fieldId: id, value }];
    vi.mocked(api.post).mockResolvedValue({ ...detail, customFieldValues: rows });
    await createTask("crew", { ...input, customFieldValues: rows });
    expect(api.post).toHaveBeenLastCalledWith("/crews/crew/tasks", {
      service: "aurora",
      data: expect.objectContaining({ customFieldValues: rows }),
    });
  }
  vi.mocked(api.post).mockResolvedValue({ ...detail, customFieldValues: [] });
  await createTask("crew", { ...input, customFieldValues: [{ fieldId: id, value: null }] });
  for (const rows of [
    undefined,
    [],
    [{ fieldId: id, value: true }],
    [
      { fieldId: id, value: false },
      { fieldId: id, value: false },
    ],
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, customFieldValues: rows });
    await expect(
      createTask("crew", { ...input, customFieldValues: [{ fieldId: id, value: false }] })
    ).rejects.toThrow("acknowledgement");
  }
});
it("rejects duplicate or oversized custom values before creation", async () => {
  for (const customFieldValues of [
    [{ fieldId: id, value: "x".repeat(4001) }],
    [
      { fieldId: id, value: 0 },
      { fieldId: id, value: 1 },
    ],
    Array.from({ length: 51 }, () => ({ fieldId: id, value: false })),
  ])
    await expect(createTask("crew", { ...input, customFieldValues })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});

it("preserves exact task compensation and rejects missing acknowledgement", async () => {
  const terms = { rewardUsdMinor: 12345, profitShareBps: 125 };
  vi.mocked(api.post).mockResolvedValue({ ...detail, ...terms });
  await expect(createTask("crew", { ...input, ...terms })).resolves.toMatchObject(terms);
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject(terms);
  vi.mocked(api.post).mockResolvedValue(detail);
  await expect(createTask("crew", { ...input, ...terms })).rejects.toThrow("acknowledgement");
});
it("does not send invalid compensation", async () => {
  for (const terms of [{ rewardUsdMinor: -1 }, { rewardUsdMinor: 1.1 }, { profitShareBps: 10001 }])
    await expect(createTask("crew", { ...input, ...terms })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects an expired deadline before issuing a non-idempotent creation", async () => {
  await expect(createTask("crew", { ...input, dueAt: "2026-09-29T23:59:59Z" })).rejects.toThrow(
    "future deadline"
  );
  expect(api.post).not.toHaveBeenCalled();
});

it.each([
  { description: " " },
  { taskKind: null },
  { dueAt: null },
  { rewardUsdMinor: null },
  { rewardUsdMinor: undefined },
])("rejects missing production fields before sending: %j", async (change) => {
  await expect(createTask("crew", { ...input, ...change })).rejects.toThrow("required task fields");
  expect(api.post).not.toHaveBeenCalled();
});

it("saves a trimmed position and rejects a missing or incorrect receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...detail, positionRole: "Storyboard artist" });
  await expect(
    createTask("crew", { ...input, positionRole: " Storyboard artist " })
  ).resolves.toMatchObject({ positionRole: "Storyboard artist" });
  expect(vi.mocked(api.post).mock.calls[0]![1]).toMatchObject({
    data: { positionRole: "Storyboard artist" },
  });
  for (const positionRole of [undefined, null, "Writer"]) {
    vi.mocked(api.post).mockResolvedValue({ ...detail, positionRole });
    await expect(
      createTask("crew", { ...input, positionRole: "Storyboard artist" })
    ).rejects.toThrow("acknowledgement");
  }
});
it("rejects invalid positions before creating a task", async () => {
  for (const positionRole of [" ", "x".repeat(81)])
    await expect(createTask("crew", { ...input, positionRole })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});

it("creates selected skills and rejects a receipt that drops them", async () => {
  const requiredSkills = ["Editing", "Lighting"];
  vi.mocked(api.post).mockResolvedValue({
    ...detail,
    requiredSkills: [...requiredSkills].reverse(),
  });
  await createTask("crew", { ...input, requiredSkills });
  expect(api.post).toHaveBeenLastCalledWith(
    "/crews/crew/tasks",
    expect.objectContaining({ data: expect.objectContaining({ requiredSkills }) })
  );
  vi.mocked(api.post).mockResolvedValue(detail);
  await expect(createTask("crew", { ...input, requiredSkills })).rejects.toThrow("acknowledgement");
});

it("creates a linked contract and rejects a missing acknowledgement", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...detail, contractAssetNodeId: id });
  await createTask("crew", { ...input, contractAssetNodeId: id });
  expect(api.post).toHaveBeenLastCalledWith(
    "/crews/crew/tasks",
    expect.objectContaining({ data: expect.objectContaining({ contractAssetNodeId: id }) })
  );
  vi.mocked(api.post).mockResolvedValue(detail);
  await expect(createTask("crew", { ...input, contractAssetNodeId: id })).rejects.toThrow(
    "acknowledgement"
  );
});

it("sends selected payment terms and rejects a receipt with different terms", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...detail, paymentTerms: "half_upfront" });
  await createTask("crew", { ...input, paymentTerms: "half_upfront" });
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject({
    paymentTerms: "half_upfront",
  });
  vi.mocked(api.post).mockResolvedValue({ ...detail, paymentTerms: "monthly" });
  await expect(createTask("crew", { ...input, paymentTerms: "half_upfront" })).rejects.toThrow();
});

it("verifies the saved CN reward currency as well as its amount", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...detail, rewardCurrency: "CNY" });
  expect((await createTask("crew", { ...input, rewardCurrency: "CNY" })).rewardCurrency).toBe(
    "CNY"
  );
  vi.mocked(api.post).mockResolvedValue({ ...detail, rewardCurrency: "USD" });
  await expect(createTask("crew", { ...input, rewardCurrency: "CNY" })).rejects.toThrow();
});
