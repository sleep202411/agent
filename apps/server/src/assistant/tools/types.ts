import type { WorkspaceService, WorkspaceContext } from '../workspace.service';
import type { TaskService } from '../../pipeline/task/task.service';
import type { TaskQueue } from '../../pipeline/task/task.queue';
import type { TaskWorker } from '../../pipeline/task/task.worker';

export type HeadersLike = Record<string, string | string[] | undefined>;

export type AttachmentInfo = {
  name: string;
  mimeType: string;
  url?: string;
  excerpt?: string;
};

export type AssistantToolContext = {
  headers: HeadersLike;
  ws: WorkspaceService;
  context: WorkspaceContext;
  /** Authenticated user ID */
  userId?: string;
  requireWorldId: () => string;
  requireEpisodeId: () => string;
  /** Full text from user attachments (plain text files only) */
  getAttachmentText: () => string;
  /** All attachment metadata for server-side file download */
  getAttachments: () => AttachmentInfo[];
  /** Task service for async background tasks */
  taskService?: TaskService;
  /** Task queue (BullMQ) for enqueueing background tasks */
  taskQueue?: TaskQueue;
  /** Task worker reference (for fallback in-process execution) */
  taskWorker?: TaskWorker;
};
