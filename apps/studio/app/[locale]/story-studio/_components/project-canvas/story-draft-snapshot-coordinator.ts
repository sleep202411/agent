/**
 * Serializes actions that must capture one exact saved draft revision.
 *
 * The caller owns draft state and autosave; this coordinator owns ordering:
 * ordinary saves are paused before capture, the exact snapshot is persisted,
 * the server action runs while the pause remains active, and queued edits are
 * released only after the action has captured its immutable inputs.
 */
export class StoryDraftSnapshotCoordinator {
  private tail: Promise<void> = Promise.resolve();

  run<Snapshot, Result>(steps: {
    setBarrier: (active: boolean) => void;
    captureSnapshot: () => Snapshot;
    waitForIdleSave: () => Promise<void>;
    saveSnapshot: (snapshot: Snapshot) => Promise<void>;
    savedRevision: (snapshot: Snapshot) => number;
    submit: (draftRevision: number) => Promise<Result>;
    flushAfterRelease: () => void;
  }): Promise<Result> {
    const action = this.tail
      .catch(() => undefined)
      .then(async () => {
        steps.setBarrier(true);
        try {
          const snapshot = steps.captureSnapshot();
          await steps.waitForIdleSave();
          await steps.saveSnapshot(snapshot);
          return await steps.submit(steps.savedRevision(snapshot));
        } finally {
          steps.setBarrier(false);
          steps.flushAfterRelease();
        }
      });

    this.tail = action.then(
      () => undefined,
      () => undefined
    );
    return action;
  }
}
