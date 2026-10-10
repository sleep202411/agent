import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  analyzePdf,
  applyPdfTasks,
  fetchPdfPreview,
  validatePdfFile,
  savePdfRecovery,
  loadPdfRecovery,
} from "./pdf-task-api";
const h = vi.hoisted(() => ({ generation: 1, region: "cn", store: new Map<string, string>() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({
  appEnv: {
    get appRegion() {
      return h.region;
    },
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: async (key: string) => h.store.get(key) ?? null,
  setStoredString: async (key: string, value: string) => {
    h.store.set(key, value);
  },
  deleteStoredString: async (key: string) => {
    h.store.delete(key);
  },
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), postFormData: vi.fn() },
}));
const id = "11111111-1111-4111-8111-111111111111",
  task = "22222222-2222-4222-8222-222222222222";
const preview = {
  id,
  createdAt: "2026-10-10T00:00:00Z",
  status: "ready",
  tasks: [
    {
      title: "Script",
      description: "Deliver the script",
      category: "scripts",
      evidence: "Script excerpt",
    },
  ],
  taskIds: [],
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.region = "cn";
  h.store.clear();
  vi.mocked(api.get).mockResolvedValue(preview);
  vi.mocked(api.post).mockResolvedValue({ taskIds: [task], replayed: true });
});
it("scopes recovery by user, crew and region and preserves the frozen selection", async () => {
  await savePdfRecovery("crew", "user", { id, indices: [0] });
  expect(await loadPdfRecovery("crew", "user")).toEqual({ id, indices: [0] });
  expect(await loadPdfRecovery("other", "user")).toBeNull();
  expect(await loadPdfRecovery("crew", "other")).toBeNull();
  h.region = "global";
  expect(await loadPdfRecovery("crew", "user")).toBeNull();
});
it.each([{ size: 0 }, { size: 20 * 1024 * 1024 + 1 }, { name: "x.exe" }, { name: "../script.pdf" }])(
  "rejects invalid document %j",
  (change) => {
    expect(() =>
      validatePdfFile({
        name: "script.pdf",
        size: 10,
        lastModified: 0,
        uri: "file:///script.pdf",
        ...change,
      })
    ).toThrow();
  }
);
it("sends the picked bytes via the authenticated regional multipart API", async () => {
  const file = new File(["%PDF-document"], "script.pdf", { type: "application/pdf" });
  vi.mocked(api.postFormData).mockResolvedValue(preview);
  await analyzePdf(
    "crew",
    id,
    { uri: "blob:document", name: file.name, size: file.size, lastModified: 0, file },
    1,
    signal()
  );
  expect(api.postFormData).toHaveBeenCalledWith(
    `/crews/crew/pdf-task-imports/${id}/analyze`,
    expect.any(FormData),
    expect.objectContaining({ service: "aurora" })
  );
});
it("reuses the same analysis and selection after a response is lost", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Network lost"));
  await expect(applyPdfTasks("crew", id, [0], 1, signal())).rejects.toThrow("Network lost");
  await expect(applyPdfTasks("crew", id, [0], 1, signal())).resolves.toEqual({ taskIds: [task] });
  expect(vi.mocked(api.post).mock.calls.map((call) => [call[0], call[1]?.data])).toEqual(
    Array(2).fill([`/crews/crew/pdf-task-imports/${id}/apply`, { indices: [0] }])
  );
});
it("rejects duplicate selections, mismatched receipts and stale sessions", async () => {
  await expect(applyPdfTasks("crew", id, [0, 0], 1, signal())).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.get).mockResolvedValue({ ...preview, id: task });
  await expect(fetchPdfPreview("crew", id, 1, signal())).rejects.toThrow("match");
  h.generation = 2;
  await expect(applyPdfTasks("crew", id, [0], 1, signal())).rejects.toThrow("session");
});
