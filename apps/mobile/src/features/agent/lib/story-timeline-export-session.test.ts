import { expect, it, vi } from "vitest";
import {
  createTimelineExportSession,
  type TimelineExportResult,
  type TimelineExportShot,
} from "./story-timeline-export-session";
const artifact = { uri: "file:///cache/export.mp4", contentType: "video/mp4" as const, size: 123 };
function setup() {
  const snapshot = {
    projectId: "project",
    chapterId: "chapter",
    sequenceId: "sequence",
    version: 2,
    shots: [
      { id: "one", kind: "video" as const, url: "https://media.example/one.mp4", durationMs: 1000 },
      { id: "two", kind: "video" as const, url: "https://media.example/two.mp4", durationMs: 2000 },
    ],
    omittedClipIds: ["image"],
  };
  const options = {
    snapshot,
    current: vi.fn(() => true),
    render: vi.fn(
      async (
        _shots: TimelineExportShot[],
        _signal: AbortSignal,
        _progress: (n: number) => void
      ): Promise<TimelineExportResult> => ({ artifact, completedClipIds: ["one", "two"] })
    ),
    upload: vi.fn(async () => "media"),
    attach: vi.fn(async () => {}),
    release: vi.fn(),
    onState: vi.fn(),
  };
  return { options, session: createTimelineExportSession(options) };
}
it("exports the immutable captured order and reports omitted clips", async () => {
  const { options, session } = setup();
  options.snapshot.shots.reverse();
  await session.save();
  expect(options.render.mock.calls[0][0].map((s) => s.id)).toEqual(["one", "two"]);
  expect(options.attach).toHaveBeenCalledWith("project", "media", expect.any(AbortSignal));
  expect(options.onState).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: "saved", omittedClipIds: ["image"] })
  );
  await session.save();
  expect(options.render).toHaveBeenCalledTimes(1);
});
it("retries attachment without rendering or uploading another file", async () => {
  const { options, session } = setup();
  options.attach.mockRejectedValueOnce(Error("offline"));
  await session.save();
  await session.save();
  expect(options.render).toHaveBeenCalledTimes(1);
  expect(options.upload).toHaveBeenCalledTimes(1);
  expect(options.attach).toHaveBeenCalledTimes(2);
});
it("retains an encoded artifact when upload fails", async () => {
  const { options, session } = setup();
  options.upload.mockRejectedValueOnce(Error("offline"));
  await session.save();
  await session.save();
  expect(options.render).toHaveBeenCalledTimes(1);
  expect(options.upload).toHaveBeenCalledTimes(2);
});
it("reports partial output explicitly", async () => {
  const { options, session } = setup();
  options.render.mockResolvedValue({ artifact, completedClipIds: ["two"] });
  await session.save();
  expect(options.onState).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: "saved", omittedClipIds: ["image", "one"] })
  );
});
it("rejects empty or foreign encoder receipts before upload", async () => {
  for (const ids of [[], ["foreign"], ["one", "one"]]) {
    const { options, session } = setup();
    options.render.mockResolvedValue({ artifact, completedClipIds: ids });
    await session.save();
    expect(options.upload).not.toHaveBeenCalled();
    expect(options.release).toHaveBeenCalledWith(artifact);
    expect(options.onState).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "failed" }));
  }
});
it("releases a late encoder result after cancellation without uploading", async () => {
  const { options, session } = setup();
  let finish!: (r: TimelineExportResult) => void;
  options.render.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const running = session.save();
  session.cancel();
  finish({ artifact, completedClipIds: ["one"] });
  await running;
  expect(options.release).toHaveBeenCalledWith(artifact);
  expect(options.upload).not.toHaveBeenCalled();
});
it("prevents concurrent exports and suppresses stale-account completion", async () => {
  const { options, session } = setup();
  let finish!: (s: string) => void;
  options.upload.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const running = session.save();
  await Promise.resolve();
  await session.save();
  expect(options.render).toHaveBeenCalledTimes(1);
  options.current.mockReturnValue(false);
  finish("media");
  await running;
  expect(options.attach).not.toHaveBeenCalled();
  session.dispose();
  expect(options.release).toHaveBeenCalledTimes(1);
});
it("rejects unsafe sources before invoking an encoder", () => {
  const { options } = setup();
  options.snapshot.shots[0].url = "http://media.example/video";
  expect(() => createTimelineExportSession(options)).toThrow("Invalid timeline");
});
