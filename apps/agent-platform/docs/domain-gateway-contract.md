# Domain Gateway Contract

The domain gateway is the only mutation boundary between an LLM-driven runtime
and FizzDragon business services.

Every route uses a short-lived Ed25519 workload JWT bound to the exact HTTP
method, path, and SHA-256 body hash. A credential cannot be replayed against a
different tool, attachment request, lifecycle row, or payload.

## Tool endpoint

`POST /v1/agent/tools/{toolId}/execute`

Required headers:

- `Authorization: Bearer <service credential>`
- `Idempotency-Key: <runId>:<toolCallId>`
- `X-FizzDragon-Trace-Id: <signed trace ID>`

The request body uses `agent-tool-request/v2` and contains tool arguments,
signed actor claims, and the signed project/crew scope. The service must not
trust a permission merely because it appears in the body; it re-resolves the
actor and authorization against current business state.

Responses must be valid JSON and no larger than 1 MiB. Larger results belong in
durable object storage and should be returned as scoped references, not pushed
through model context.

## Responses

Success:

```json
{
  "status": "succeeded",
  "data": {},
  "revision": 42
}
```

Domain rejection (HTTP 403, 409, or 422):

```json
{
  "status": "rejected",
  "error": {
    "code": "STORY_REVISION_CONFLICT",
    "message": "Expected revision 41, current revision is 42.",
    "retryable": false,
    "details": {}
  }
}
```

The Agent Platform treats a structured rejection as current domain truth and
publishes it to the model. Network failures, timeouts, malformed responses, and
other HTTP statuses are infrastructure failures and are retried by Temporal.

## Invocation lifecycle endpoint

`POST /v1/agent/invocations/{invocationId}/lifecycle`

The body uses `agent-invocation-lifecycle/v1` and carries the product-reserved
invocation ID, durable attempt ID and ordinal, conversation ID, provisional run
ID, a monotonic lifecycle status, and a structured error only for `failed`.
The acknowledgement must echo the complete
`invocationId + attemptId + attemptOrdinal` tuple. An abandoned Temporal child
Workflow preserves transition order and repairs failed bounded lifecycle
Activities without blocking the interactive session queue. The product
database rejects identity mismatches, callbacks older than the current attempt,
lifecycle regression, and conflicting terminal outcomes. Such a rejection must
be a structured `404`, `409`, or `422` carrying `code` and `message`: the
projector abandons that transition rather than redelivering a callback the
product will never accept.

This endpoint is mandatory because Ably cannot publish `run-end` for a Run that
never emitted `run-start`. It gives reconnecting clients a terminal fact for
pre-open failure and queued cancellation without pretending the product
projection is the execution authority.

## Attachment resolution endpoint

`POST /v1/agent/attachments/resolve` resolves stable
`fizzdragon-media://<attachmentId>` references only after re-authorizing the
signed actor and conversation. It returns short-lived file URLs or bounded
extracted text in the exact requested order.

Large source files are represented by immutable indexed sections and durable
analysis jobs. The document Workflow claims one manifest, reads one bounded
section or at most eight persisted artifacts per Activity, writes idempotent
map/reduce/final artifacts, and completes the job only when the final artifact
covers every source chunk. Raw source text and artifact bodies never cross a
Temporal Workflow boundary.

## Idempotency

The domain service persists the idempotency key, normalized request hash,
terminal response, and commit identity in the same durability boundary as the
command. Reusing a key with the same request returns the stored response.
Reusing it with a different request is rejected as an idempotency conflict.

## Story graph transaction

`story_apply_change_set` must execute in one transaction:

1. authorize current actor and scope
2. lock/read the aggregate at `baseRevision`
3. apply all upserts and removals to a candidate final state
4. validate node references, edge endpoints, and entry node against that final
   state
5. persist the complete change and increment the revision
6. store the idempotency response
7. commit

There is no operation-order fallback and no implicit cascade. A change that
removes a referenced node must explicitly update/remove every surviving
reference in the same change set.

Crew mutations follow the same rule: every `crew-command/v1` carries the current
crew aggregate `baseRevision`, and the domain service authorizes, compares, applies,
records the idempotent response, and commits atomically.

The pure validator in
`src/capabilities/story-studio/contract.ts` defines the transport-level
invariants. The authoritative business service must enforce equivalent
invariants inside its database transaction.
