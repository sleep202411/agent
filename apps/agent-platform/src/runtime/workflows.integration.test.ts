import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CANCEL_AGENT_INVOCATION_UPDATE,
  ENQUEUE_AGENT_INVOCATION_UPDATE,
  agentInvocationAdmissionSchema,
  type AgentInvocationAdmission,
  type AgentInvocationCommand,
  type DurableRunIds,
} from "./contracts.js";
import { agentTaskQueues } from "./task-queues.js";

let environment: TestWorkflowEnvironment;

beforeAll(async () => {
  environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: process.env.TEMPORAL_CLI_PATH
        ? {
            type: "existing-path",
            path: process.env.TEMPORAL_CLI_PATH,
          }
        : { type: "cached-download", version: "default" },
      ui: false,
    },
  });
});

afterAll(async () => {
  await environment?.teardown();
});

const conversationId = "0197f4a2-0800-7000-8000-000000000004";
const sessionName = `agent:v1:conversation:${conversationId}`;

function invocationCommand(inputEventId = randomUUID()): AgentInvocationCommand {
  return {
    schemaVersion: "agent-invocation-command/v1",
    invocation: {
      inputEventId,
      sessionName,
    },
    invocationId: randomUUID(),
    attemptId: randomUUID(),
    attemptOrdinal: 0,
    provisionalRunId: randomUUID(),
    maxModelSteps: 8,
    context: {
      actorId: "actor-1",
      actorDisplayName: "Actor One",
      conversationId,
      surface: "story-studio",
      sessionName,
      permissionMode: "smart",
      scope: {
        kind: "story-project",
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
      locale: "en-US",
      roles: ["creator"],
      permissions: ["story.read"],
      traceId: "trace-1",
    },
  };
}

function durableIds(command: AgentInvocationCommand): DurableRunIds {
  return {
    runId: command.provisionalRunId,
    invocationId: command.attemptId,
    triggerEventId: command.invocation.inputEventId,
  };
}

describe("fizzDragonAgentSessionWorkflow", () => {
  it("processes an invocation through explicit durable activities", async () => {
    const command = invocationCommand();
    const inference = vi.fn().mockResolvedValue({ kind: "complete" });
    const terminal = vi.fn();
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: terminal,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command);
      try {
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
        });
        expect(terminal).not.toHaveBeenCalled();
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("schedules the first inference beside the lifecycle projector start, not behind it", async () => {
    const command = invocationCommand();
    const lifecycle = vi.fn();
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: vi.fn().mockResolvedValue({ kind: "complete" }),
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command);
      try {
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: command.invocationId,
              status: "succeeded",
            })
          );
        });

        // The product row must still observe running before succeeded: the
        // overlap may not reorder the projector's transition queue.
        expect(
          lifecycle.mock.calls.map(([projection]) => (projection as { status: string }).status)
        ).toEqual(["running", "succeeded"]);

        // The projector child start is a durable-projection concern; the first
        // model step must not wait one child start plus two workflow tasks
        // behind it. Both commands belong to ONE workflow task completion.
        const history = await handle.fetchHistory();
        const events = history.events ?? [];
        const childInitiated = events.find(
          (event) => event.startChildWorkflowExecutionInitiatedEventAttributes
        );
        const inferenceScheduled = events.find(
          (event) =>
            event.activityTaskScheduledEventAttributes?.activityType?.name ===
            "runInferenceActivity"
        );
        expect(childInitiated).toBeDefined();
        expect(inferenceScheduled).toBeDefined();
        expect(
          String(
            inferenceScheduled?.activityTaskScheduledEventAttributes?.workflowTaskCompletedEventId
          )
        ).toBe(
          String(
            childInitiated?.startChildWorkflowExecutionInitiatedEventAttributes
              ?.workflowTaskCompletedEventId
          )
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("executes settled model tool calls instead of parking the invocation", async () => {
    const command = invocationCommand();
    const tool = vi.fn();
    const lifecycle = vi.fn();
    const inference = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "tool-calls",
        toolCalls: [
          {
            toolCallId: "call-read",
            toolName: "story_get_snapshot",
            input: { schemaVersion: "story-read/v2" },
          },
        ],
      })
      .mockResolvedValueOnce({ kind: "complete" });
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: inference,
      executeToolActivity: tool,
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command);
      try {
        await vi.waitFor(() => {
          expect(tool).toHaveBeenCalledWith({
            ids: durableIds(command),
            sessionName,
            context: command.context,
            toolCallId: "call-read",
            toolName: "story_get_snapshot",
            arguments: { schemaVersion: "story-read/v2" },
          });
          expect(inference).toHaveBeenCalledTimes(2);
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: command.invocationId,
              status: "succeeded",
            })
          );
        });
        expect(lifecycle).not.toHaveBeenCalledWith(
          expect.objectContaining({
            invocationId: command.invocationId,
            status: "waiting_for_approval",
          })
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("reports only an explicit approval outcome as waiting_for_approval", async () => {
    const command = invocationCommand();
    const lifecycle = vi.fn();
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: vi.fn().mockResolvedValue({
        kind: "awaiting-approval",
        toolCallIds: ["call-write"],
      }),
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command);
      try {
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: command.invocationId,
              status: "waiting_for_approval",
              error: null,
            })
          );
        });
        // Nothing closes the projector of an approval the user never answers,
        // so its lifetime has to be bounded at start.
        const projector = await environment.client.workflow
          .getHandle(`agent-lifecycle-${command.invocationId}`)
          .describe();
        expect(projector.raw.executionConfig?.workflowExecutionTimeout).toBeTruthy();
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("keeps a completed outcome when Stop lands after the Run was published", async () => {
    const command = invocationCommand();
    const workflowId = `agent-platform-test-${randomUUID()}`;
    const lifecycle = vi.fn();
    const inference = vi.fn().mockImplementation(async () => {
      // The Activity has already published the complete Run to Ably. Stop
      // arrives in the window before the Workflow can project the outcome.
      await environment.client.workflow
        .getHandle(workflowId)
        .executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
          args: [
            {
              schemaVersion: "agent-cancellation-command/v1",
              sessionName,
              invocationId: command.invocationId,
            },
          ],
          updateId: randomUUID(),
        });
      return { kind: "complete" };
    });
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command, workflowId);
      try {
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: command.invocationId,
              status: "succeeded",
            })
          );
        });
        expect(lifecycle).not.toHaveBeenCalledWith(
          expect.objectContaining({
            invocationId: command.invocationId,
            status: "cancelled",
          })
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("abandons a lifecycle projection the product permanently refuses", async () => {
    const command = invocationCommand();
    const lifecycle = vi.fn().mockImplementation(async (projection: { status: string }) => {
      if (projection.status !== "succeeded") return;
      throw ApplicationFailure.nonRetryable(
        "A rejected Agent invocation cannot enter execution.",
        "AGENT_INVOCATION_NOT_ADMITTED"
      );
    });
    const worker = await createWorker({
      openRunActivity: vi.fn().mockResolvedValue({
        kind: "opened",
        ids: durableIds(command),
        approvedToolCalls: [],
      }),
      runInferenceActivity: vi.fn().mockResolvedValue({ kind: "complete" }),
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, command);
      try {
        await vi.waitFor(
          async () => {
            const projector = await environment.client.workflow
              .getHandle(`agent-lifecycle-${command.invocationId}`)
              .describe();
            expect(projector.status.name).toBe("COMPLETED");
          },
          { timeout: 10_000 }
        );
        expect(
          lifecycle.mock.calls.filter(
            ([projection]) => (projection as { status: string }).status === "succeeded"
          )
        ).toHaveLength(1);
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("resumes one product run through a distinct durable approval attempt", async () => {
    const first = invocationCommand();
    const continuation: AgentInvocationCommand = {
      ...invocationCommand(),
      invocationId: first.invocationId,
      provisionalRunId: first.provisionalRunId,
      attemptOrdinal: 1,
    };
    const lifecycle = vi.fn().mockResolvedValue(undefined);
    const inference = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "awaiting-approval",
        toolCallIds: ["call-write"],
      })
      .mockResolvedValueOnce({ kind: "complete" });
    const open = vi
      .fn()
      .mockImplementation(
        async (input: {
          invocationId: string;
          provisionalRunId: string;
          invocation: { inputEventId: string };
        }) => ({
          kind: "opened",
          ids: {
            runId: input.provisionalRunId,
            invocationId: input.invocationId,
            triggerEventId: input.invocation.inputEventId,
          },
          approvedToolCalls: [],
        })
      );
    const worker = await createWorker({
      openRunActivity: open,
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: first.invocationId,
              runId: first.provisionalRunId,
              status: "waiting_for_approval",
            })
          );
        });

        await expect(
          enqueueSession(handle, {
            ...continuation,
            attemptId: randomUUID(),
            attemptOrdinal: 2,
          })
        ).resolves.toMatchObject({
          invocationId: first.invocationId,
          attemptOrdinal: 2,
          status: "sequence-conflict",
        });
        await expect(enqueueSession(handle, continuation)).resolves.toMatchObject({
          invocationId: first.invocationId,
          attemptId: continuation.attemptId,
          attemptOrdinal: continuation.attemptOrdinal,
          status: "accepted",
        });
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: first.invocationId,
              runId: first.provisionalRunId,
              status: "succeeded",
            })
          );
        });

        expect(inference).toHaveBeenCalledTimes(2);
        expect(open).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ invocationId: first.attemptId })
        );
        expect(open).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ invocationId: continuation.attemptId })
        );
        expect(
          lifecycle.mock.calls.map(([projection]) => {
            const value = projection as {
              attemptId: string;
              attemptOrdinal: number;
              status: string;
            };
            return [value.attemptId, value.attemptOrdinal, value.status];
          })
        ).toEqual([
          [first.attemptId, 0, "running"],
          [first.attemptId, 0, "waiting_for_approval"],
          [continuation.attemptId, 1, "running"],
          [continuation.attemptId, 1, "succeeded"],
        ]);
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("contains one failed invocation and continues the same session", async () => {
    const first = invocationCommand();
    const second = invocationCommand();
    const terminal = vi
      .fn()
      .mockRejectedValueOnce(
        ApplicationFailure.nonRetryable(
          "Ably terminal publish failed",
          "AGENT_ABLY_MUTABLE_MESSAGES_REQUIRED"
        )
      );
    const lifecycle = vi.fn();
    const inference = vi
      .fn()
      .mockRejectedValueOnce(
        ApplicationFailure.nonRetryable("Model contract failed", "AGENT_MODEL_CONTRACT_FAILED")
      )
      .mockResolvedValueOnce({ kind: "complete" });
    const worker = await createWorker({
      openRunActivity: vi
        .fn()
        .mockImplementation(
          async (input: {
            invocationId: string;
            provisionalRunId: string;
            invocation: { inputEventId: string };
          }) => ({
            kind: "opened",
            ids: {
              runId: input.provisionalRunId,
              invocationId: input.invocationId,
              triggerEventId: input.invocation.inputEventId,
            },
            approvedToolCalls: [],
          })
        ),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: terminal,
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(terminal).toHaveBeenCalledWith(
            expect.objectContaining({
              reason: "error",
              error: expect.objectContaining({
                code: "AGENT_RUNTIME_FAILED",
                messageKey: "agent.error.runtime_failed",
                diagnosticId: expect.any(String),
              }),
            })
          );
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: first.invocationId,
              status: "failed",
              error: expect.objectContaining({
                code: "AGENT_RUNTIME_FAILED",
                retryable: false,
                messageKey: "agent.error.runtime_failed",
                diagnosticId: expect.any(String),
              }),
            })
          );
        });
        await enqueueSession(handle, second);
        await vi.waitFor(
          () => {
            expect(inference).toHaveBeenCalledTimes(2);
          },
          { timeout: 5_000 }
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("records a terminal failure even when the Ably Run never opens", async () => {
    const first = invocationCommand();
    const second = invocationCommand();
    const lifecycle = vi.fn();
    const open = vi
      .fn()
      .mockRejectedValueOnce(
        ApplicationFailure.nonRetryable(
          "The triggering Ably input is missing.",
          "AGENT_RUN_OPEN_FAILED"
        )
      )
      .mockImplementationOnce(
        async (input: {
          invocationId: string;
          provisionalRunId: string;
          invocation: { inputEventId: string };
        }) => ({
          kind: "opened",
          ids: {
            runId: input.provisionalRunId,
            invocationId: input.invocationId,
            triggerEventId: input.invocation.inputEventId,
          },
          approvedToolCalls: [],
        })
      );
    const inference = vi.fn().mockResolvedValue({ kind: "complete" });
    const worker = await createWorker({
      openRunActivity: open,
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: first.invocationId,
              runId: first.provisionalRunId,
              status: "failed",
              error: expect.objectContaining({
                code: "AGENT_RUN_OPEN_FAILED",
                retryable: false,
              }),
            })
          );
        });

        await enqueueSession(handle, second);
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
          expect(lifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
              invocationId: second.invocationId,
              status: "succeeded",
            })
          );
        });
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("continues serialized session work while lifecycle projection is unavailable", async () => {
    const first = invocationCommand();
    const second = invocationCommand();
    const lifecycle = vi
      .fn()
      .mockRejectedValue(
        ApplicationFailure.retryable(
          "https://private-gateway.example/internal?token=secret",
          "DOMAIN_GATEWAY_UNAVAILABLE"
        )
      );
    const inference = vi.fn().mockResolvedValue({ kind: "complete" });
    const worker = await createWorker({
      openRunActivity: vi
        .fn()
        .mockImplementation(
          async (input: {
            invocationId: string;
            provisionalRunId: string;
            invocation: { inputEventId: string };
          }) => ({
            kind: "opened",
            ids: {
              runId: input.provisionalRunId,
              invocationId: input.invocationId,
              triggerEventId: input.invocation.inputEventId,
            },
            approvedToolCalls: [],
          })
        ),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
      reportInvocationLifecycleActivity: lifecycle,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
          expect(lifecycle).toHaveBeenCalled();
        });
        await enqueueSession(handle, second);
        await vi.waitFor(
          () => {
            expect(inference).toHaveBeenCalledTimes(2);
          },
          { timeout: 2_000 }
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("deduplicates invocation identity across admission attempts and serializes work", async () => {
    const first = invocationCommand();
    const second = invocationCommand();
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const inference = vi.fn().mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (inference.mock.calls.length === 1) {
        await firstGate;
      }
      active -= 1;
      return { kind: "complete" };
    });
    const open = vi
      .fn()
      .mockImplementation(
        async (input: {
          invocationId: string;
          provisionalRunId: string;
          invocation: { inputEventId: string };
        }) => ({
          kind: "opened",
          ids: {
            runId: input.provisionalRunId,
            invocationId: input.invocationId,
            triggerEventId: input.invocation.inputEventId,
          },
          approvedToolCalls: [],
        })
      );
    const worker = await createWorker({
      openRunActivity: open,
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
        });
        await expect(enqueueSession(handle, first)).resolves.toMatchObject({
          invocationId: first.invocationId,
          status: "already-accepted",
        });
        await expect(enqueueSession(handle, second)).resolves.toMatchObject({
          invocationId: second.invocationId,
          status: "accepted",
        });
        expect(inference).toHaveBeenCalledTimes(1);

        releaseFirst();
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(2);
        });
        expect(open).toHaveBeenCalledTimes(2);
        expect(maximumActive).toBe(1);
      } finally {
        releaseFirst();
        await handle.terminate("integration test complete");
      }
    });
  });

  it("rejects excess pending work without terminating the session Workflow", async () => {
    const first = invocationCommand();
    let markActivityStarted!: () => void;
    const activityStarted = new Promise<void>((resolve) => {
      markActivityStarted = resolve;
    });
    const inference = vi.fn().mockImplementation(async () => {
      const activity = Context.current();
      const heartbeat = setInterval(() => activity.heartbeat("queue-capacity-test"), 10);
      markActivityStarted();
      try {
        await activity.cancelled;
      } finally {
        clearInterval(heartbeat);
      }
    });
    const worker = await createWorker({
      openRunActivity: vi
        .fn()
        .mockImplementation(
          async (input: {
            invocationId: string;
            provisionalRunId: string;
            invocation: { inputEventId: string };
          }) => ({
            kind: "opened",
            ids: {
              runId: input.provisionalRunId,
              invocationId: input.invocationId,
              triggerEventId: input.invocation.inputEventId,
            },
            approvedToolCalls: [],
          })
        ),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await activityStarted;
        const admissions: AgentInvocationAdmission[] = [];
        let rejectedCommand: AgentInvocationCommand | undefined;
        for (let index = 0; index < 513; index += 1) {
          const command = invocationCommand();
          const admission = agentInvocationAdmissionSchema.parse(
            await enqueueSession(handle, command)
          );
          admissions.push(admission);
          if (admission.status === "queue-full") {
            rejectedCommand = command;
          }
        }

        expect(admissions.filter((admission) => admission.status === "accepted")).toHaveLength(512);
        expect(admissions.filter((admission) => admission.status === "queue-full")).toHaveLength(1);
        expect(rejectedCommand).toBeDefined();
        await expect(
          handle.executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
            args: [
              {
                schemaVersion: "agent-cancellation-command/v1",
                sessionName,
                invocationId: first.invocationId,
              },
            ],
          })
        ).resolves.toMatchObject({ status: "cancellation-requested" });
        await vi.waitFor(
          () => {
            expect(inference).toHaveBeenCalledTimes(2);
          },
          { timeout: 5_000 }
        );
        await expect(enqueueSession(handle, rejectedCommand!)).resolves.toMatchObject({
          invocationId: rejectedCommand!.invocationId,
          status: "accepted",
        });
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  }, 60_000);

  it("cancels an active invocation without terminating its session", async () => {
    const first = invocationCommand();
    const second = invocationCommand();
    const terminal = vi.fn();
    const inference = vi
      .fn()
      .mockImplementationOnce(async () => {
        const activity = Context.current();
        const heartbeat = setInterval(() => activity.heartbeat("waiting-for-cancellation"), 10);
        try {
          await activity.cancelled;
        } finally {
          clearInterval(heartbeat);
        }
      })
      .mockResolvedValueOnce({ kind: "complete" });
    const worker = await createWorker({
      openRunActivity: vi
        .fn()
        .mockImplementation(
          async (input: {
            invocationId: string;
            provisionalRunId: string;
            invocation: { inputEventId: string };
          }) => ({
            kind: "opened",
            ids: {
              runId: input.provisionalRunId,
              invocationId: input.invocationId,
              triggerEventId: input.invocation.inputEventId,
            },
            approvedToolCalls: [],
          })
        ),
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: terminal,
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
        });
        const cancellationStartedAt = performance.now();
        await expect(
          handle.executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
            args: [
              {
                schemaVersion: "agent-cancellation-command/v1",
                sessionName,
                invocationId: first.invocationId,
              },
            ],
          })
        ).resolves.toMatchObject({
          invocationId: first.invocationId,
          status: "cancellation-requested",
        });
        await vi.waitFor(
          () => {
            expect(terminal).toHaveBeenCalledWith(
              expect.objectContaining({
                ids: durableIds(first),
                reason: "cancelled",
              })
            );
          },
          { timeout: 5_000 }
        );
        expect(performance.now() - cancellationStartedAt).toBeLessThan(1_500);

        await enqueueSession(handle, second);
        await vi.waitFor(
          () => {
            expect(inference).toHaveBeenCalledTimes(2);
          },
          { timeout: 5_000 }
        );
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });

  it("skips a durably cancelled queued invocation", async () => {
    const first = invocationCommand();
    const queued = invocationCommand();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const inference = vi.fn().mockImplementation(async () => {
      await firstGate;
      return { kind: "complete" };
    });
    const open = vi
      .fn()
      .mockImplementation(
        async (input: {
          invocationId: string;
          provisionalRunId: string;
          invocation: { inputEventId: string };
        }) => ({
          kind: "opened",
          ids: {
            runId: input.provisionalRunId,
            invocationId: input.invocationId,
            triggerEventId: input.invocation.inputEventId,
          },
          approvedToolCalls: [],
        })
      );
    const worker = await createWorker({
      openRunActivity: open,
      runInferenceActivity: inference,
      executeToolActivity: vi.fn(),
      endRunActivity: vi.fn(),
    });

    await worker.runUntil(async () => {
      const handle = await startSession(worker, first);
      try {
        await vi.waitFor(() => {
          expect(inference).toHaveBeenCalledTimes(1);
        });
        await enqueueSession(handle, queued);
        await expect(
          handle.executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
            args: [
              {
                schemaVersion: "agent-cancellation-command/v1",
                sessionName,
                invocationId: queued.invocationId,
              },
            ],
          })
        ).resolves.toMatchObject({
          invocationId: queued.invocationId,
          status: "cancellation-requested",
        });

        releaseFirst();
        await vi.waitFor(async () => {
          await expect(
            handle.executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
              args: [
                {
                  schemaVersion: "agent-cancellation-command/v1",
                  sessionName,
                  invocationId: queued.invocationId,
                },
              ],
            })
          ).resolves.toMatchObject({ status: "already-terminal" });
        });
        expect(open).toHaveBeenCalledTimes(1);
        expect(inference).toHaveBeenCalledTimes(1);
      } finally {
        releaseFirst();
        await handle.terminate("integration test complete");
      }
    });
  });
});

describe("fizzDragonAgentSessionWorkflow history bounds", () => {
  let boundedEnvironment: TestWorkflowEnvironment;

  beforeAll(async () => {
    boundedEnvironment = await TestWorkflowEnvironment.createLocal({
      server: {
        executable: process.env.TEMPORAL_CLI_PATH
          ? {
              type: "existing-path",
              path: process.env.TEMPORAL_CLI_PATH,
            }
          : { type: "cached-download", version: "default" },
        ui: false,
        // Reach Temporal's continue-as-new suggestion within a handful of
        // Updates instead of the ten thousand events a default server needs.
        extraArgs: ["--dynamic-config-value", "limit.historyCount.suggestContinueAsNew=30"],
      },
    });
  });

  afterAll(async () => {
    await boundedEnvironment?.teardown();
  });

  it("continues as new while parked on an empty queue", async () => {
    const taskQueue = agentTaskQueues(`agent-platform-test-${randomUUID()}`).workflow;
    const worker = await Worker.create({
      connection: boundedEnvironment.nativeConnection,
      namespace: boundedEnvironment.namespace,
      taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    });

    await worker.runUntil(async () => {
      const handle = await boundedEnvironment.client.workflow.start(
        "fizzDragonAgentSessionWorkflow",
        {
          taskQueue,
          workflowId: `agent-platform-test-${randomUUID()}`,
          args: [
            {
              schemaVersion: "agent-session-workflow/v2",
              sessionName,
              pendingInvocations: [],
              cancelledPendingInvocationIds: [],
              recentAttempts: [],
              aggregateAttempts: [],
            },
          ],
        }
      );
      try {
        // A cancellation for an unknown invocation is an accepted Update: it
        // writes history without ever queueing work for the main loop.
        for (let index = 0; index < 10; index += 1) {
          await handle.executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
            args: [
              {
                schemaVersion: "agent-cancellation-command/v1",
                sessionName,
                invocationId: randomUUID(),
              },
            ],
            updateId: randomUUID(),
          });
        }

        const firstRun = boundedEnvironment.client.workflow.getHandle(
          handle.workflowId,
          handle.firstExecutionRunId
        );
        await vi.waitFor(async () => {
          expect((await firstRun.describe()).status.name).toBe("CONTINUED_AS_NEW");
        });
      } finally {
        await handle.terminate("integration test complete");
      }
    });
  });
});

type TestWorkerGroup = Readonly<{
  options: Readonly<{ taskQueue: string }>;
  runUntil<T>(operation: () => Promise<T>): Promise<T>;
}>;

async function createWorker(activities: Record<string, unknown>): Promise<TestWorkerGroup> {
  const taskQueue = `agent-platform-test-${randomUUID()}`;
  const queues = agentTaskQueues(taskQueue);
  const allActivities: Record<string, unknown> = {
    reportInvocationLifecycleActivity: vi.fn(),
    ...activities,
  };
  const workers = [
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.workflow,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    }),
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.control,
      activities: {
        openRunActivity: allActivities["openRunActivity"] as never,
      },
      maxHeartbeatThrottleInterval: "100 milliseconds",
    }),
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.inference,
      activities: {
        runInferenceActivity: allActivities["runInferenceActivity"] as never,
      },
      maxHeartbeatThrottleInterval: "100 milliseconds",
    }),
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.tool,
      activities: {
        executeToolActivity: allActivities["executeToolActivity"] as never,
      },
      maxHeartbeatThrottleInterval: "100 milliseconds",
    }),
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.cleanup,
      activities: {
        endRunActivity: allActivities["endRunActivity"] as never,
      },
      maxHeartbeatThrottleInterval: "100 milliseconds",
    }),
    await Worker.create({
      connection: environment.nativeConnection,
      namespace: environment.namespace,
      taskQueue: queues.lifecycle,
      activities: {
        reportInvocationLifecycleActivity: allActivities[
          "reportInvocationLifecycleActivity"
        ] as never,
      },
      maxHeartbeatThrottleInterval: "100 milliseconds",
    }),
  ];

  return {
    options: { taskQueue },
    async runUntil<T>(operation: () => Promise<T>): Promise<T> {
      const runs = workers.map((worker) => worker.run());
      try {
        return await operation();
      } finally {
        for (const worker of workers) worker.shutdown();
        await Promise.allSettled(runs);
      }
    },
  };
}

async function startSession(
  worker: TestWorkerGroup,
  command: AgentInvocationCommand,
  workflowId = `agent-platform-test-${randomUUID()}`
) {
  const operation = new WithStartWorkflowOperation("fizzDragonAgentSessionWorkflow", {
    taskQueue: worker.options.taskQueue,
    workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    args: [
      {
        schemaVersion: "agent-session-workflow/v2",
        sessionName,
        pendingInvocations: [],
        cancelledPendingInvocationIds: [],
        recentAttempts: [],
        aggregateAttempts: [],
      },
    ],
  });
  await environment.client.workflow.executeUpdateWithStart(ENQUEUE_AGENT_INVOCATION_UPDATE, {
    args: [command],
    updateId: randomUUID(),
    startWorkflowOperation: operation,
  });
  return operation.workflowHandle();
}

function enqueueSession(
  handle: Awaited<ReturnType<typeof startSession>>,
  command: AgentInvocationCommand
) {
  return handle.executeUpdate(ENQUEUE_AGENT_INVOCATION_UPDATE, {
    args: [command],
    updateId: randomUUID(),
  });
}
