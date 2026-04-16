export type TaskStatus =
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'cancelled';

export type TaskType = 'analyze' | 'generate_scripts' | 'generate_storyboard';

export type TaskPriority = 'low' | 'normal' | 'high';

export interface PipelineTask {
  id: string;
  type: TaskType;
  projectId: string;
  sessionId?: string;
  userId?: string;
  status: TaskStatus;

  // Progress
  phase: string;
  progress: number;
  chunksTotal: number;
  chunksCompleted: number;
  message: string;

  // Timing
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // Queue position (for user feedback)
  queuePosition?: number;

  // Input
  input: Record<string, unknown>;

  // Output
  result?: unknown;
  error?: string;

  // Billing (reserved)
  creditsEstimated?: number;
  creditsCharged?: number;
}

export interface TaskProgressEvent {
  taskId: string;
  status: TaskStatus;
  phase: string;
  progress: number;
  chunksTotal: number;
  chunksCompleted: number;
  message: string;
  queuePosition?: number;
  result?: unknown;
  error?: string;
}

export interface CreateTaskInput {
  type: TaskType;
  projectId: string;
  userId?: string;
  sessionId?: string;
  input: Record<string, unknown>;
  priority?: TaskPriority;
}

// ─── Hooks (implement these to add billing/permissions) ──

/**
 * Called before a task is created.
 * Throw to reject (e.g. insufficient credits, not a member).
 * Return estimated credits for the task.
 */
export interface TaskPreCreateHook {
  (input: CreateTaskInput): Promise<{
    allowed: boolean;
    reason?: string;
    creditsEstimated?: number;
  }>;
}

/**
 * Called after a task completes successfully.
 * Use this to deduct credits.
 */
export interface TaskPostCompleteHook {
  (task: PipelineTask): Promise<{
    creditsCharged: number;
  }>;
}

/**
 * Configuration for task guards and billing.
 * Pass to TaskService to enable.
 */
export interface TaskGuardConfig {
  /** Check permissions + estimate cost before creating task */
  preCreate?: TaskPreCreateHook;
  /** Deduct credits after successful completion */
  postComplete?: TaskPostCompleteHook;
  /** Max concurrent tasks per user (0 = unlimited) */
  maxConcurrentPerUser?: number;
  /** Max queue depth before rejecting new tasks (0 = unlimited) */
  maxQueueDepth?: number;
}
