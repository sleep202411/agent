# Pipeline Task Architecture

## Overview

Long-running AI tasks (novel analysis, script generation, storyboard generation) run as
**async background tasks** instead of blocking the chat SSE stream. The chat interface
remains the entry point — LLM decides to start a task via a tool call, which returns
immediately with a `taskId`. Progress is tracked separately.

## System Diagram

```
Frontend                          Backend
========                          =======

Chat Panel                        NestJS Server
  │                                  │
  ├─ SSE /assistant/chat ──────────→ LLM + Tools
  │    LLM calls analyze_text        │
  │    ← returns { taskId }          ├─→ TaskService.create()
  │    LLM says "analyzing..."       │     └─→ Redis: task:{id} = queued
  │                                  │     └─→ Worker picks up task
  │                                  │
Task Card (in chat)               TaskWorker (background)
  │                                  │
  ├─ SSE /task/stream/:taskId ─────→ Redis PubSub
  │    ← { phase, progress, ... }    │
  │    Shows real-time progress      ├─ Download file (30s timeout)
  │                                  ├─ Split into chunks
  │                                  ├─ Process chunks (3 concurrent, 90s each)
  │                                  │    └─ Rate limiter (token bucket)
  │                                  │    └─ Each chunk result → Redis
  │                                  ├─ Merge + Dedup
  │                                  └─ task:{id} = done + result
  │                                  │
  ├─ Task done event                 │
  │    Auto-send result to chat ────→ LLM continues with result
  │    LLM proceeds to next step     │
```

## Task Lifecycle

```
created → queued → processing → done
                             → failed
                             → cancelled
```

### Task State (Redis)

```typescript
interface PipelineTask {
  id: string;
  type: 'analyze' | 'generate_scripts' | 'generate_storyboard';
  projectId: string;
  sessionId?: string; // Links to script agent session
  status: 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';

  // Progress
  phase: string; // "downloading" | "chunking" | "analyzing" | "merging" | "deduping"
  progress: number; // 0-100
  chunksTotal: number;
  chunksCompleted: number;
  message: string; // Human-readable status message

  // Timing
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // Input (serialized)
  input: Record<string, unknown>;

  // Output
  result?: unknown;
  error?: string;
}
```

### Redis Keys

```
task:{taskId}              → Hash: task state fields
task:{taskId}:text         → String: full source text (for large files)
task:{taskId}:chunk:{i}    → String: JSON result of chunk i (for resume)
task:{taskId}:result       → String: JSON final result
task:channel:{taskId}      → PubSub channel for progress events
```

All keys expire after 24 hours.

## Components

### 1. TaskService (NestJS Injectable)

Manages task CRUD and progress streaming.

```
create(input)           → taskId (writes to Redis, enqueues)
getStatus(taskId)       → PipelineTask
cancel(taskId)          → sets status=cancelled
streamProgress(taskId)  → SSE stream of progress events
```

### 2. TaskWorker (Background Processor)

Picks tasks from queue, executes them, updates Redis.

- Single worker with concurrency control (1 task at a time per type)
- Each LLM call goes through RateLimiter
- Chunk results cached in Redis for resume
- On failure: retries 2x per chunk, then marks task failed
- On cancel: checks status before each chunk, stops if cancelled

### 3. RateLimiter

Token bucket per model to prevent API throttling.

```
qwen3-max:  max 3 concurrent, 50 RPM (leave 10 RPM buffer)
qwen-flash: max 5 concurrent, 200 RPM
```

### 4. Tool Changes

Before (blocking):

```typescript
analyze_text: tool({
  execute: async (input) => {
    const result = await analyzeStep(text); // blocks 5+ minutes
    return result;
  },
});
```

After (async):

```typescript
analyze_text: tool({
  execute: async (input) => {
    const taskId = await taskService.create({ type: 'analyze', input });
    return { taskId, status: 'processing' };
  },
});

// New tool for LLM to check results
check_task: tool({
  execute: async ({ taskId }) => {
    return taskService.getStatus(taskId);
  },
});
```

### 5. Frontend Task Card

When a tool returns `{ taskId }`, render a TaskCard component:

- Subscribes to SSE `/task/stream/:taskId`
- Shows phase, progress bar, chunk count, estimated time
- Cancel button
- On completion: auto-injects result into chat as a user message

## API Endpoints

```
POST   /task/create          → { taskId }
GET    /task/status/:taskId  → PipelineTask
GET    /task/stream/:taskId  → SSE progress events
POST   /task/cancel/:taskId  → { success }
```

## Chunk Processing Strategy

### Text Splitting

- Target chunk size: 15,000 chars
- Overlap: 500 chars (for context continuity)
- Split at paragraph boundaries

### Concurrency

- Max 3 concurrent LLM calls per task
- Global rate limiter across all tasks
- Each call has 90s timeout

### Resume

- Each chunk result stored in Redis: `task:{taskId}:chunk:{i}`
- On retry/resume: skip already-completed chunks
- Results expire after 24h

## Scaling

| Users  | Setup                           | Workers         |
| ------ | ------------------------------- | --------------- |
| 1-50   | Single NestJS + Redis           | In-process      |
| 50-500 | NestJS + Redis + worker process | 2-4 workers     |
| 500+   | NestJS + Redis + K8s            | Auto-scale pods |

Workers are stateless (all state in Redis). Horizontal scaling = add more workers.
