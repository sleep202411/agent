# Creator Services / Order Loop Product Architecture

Status: draft
Owner: FizzDragon platform
Primary surfaces: `apps/web/app/(site)/crews`, future creator profile / service pages
Primary backend: `apps/server`
External boundary systems: Java user/KYC/points/payment/project/IP/course services

## 1. Goal

Build a production-grade creator service marketplace loop on top of the existing
Crew module.

The product should let a creator sell a standardized creative service, let a
buyer request or purchase it with a clear brief, then move the confirmed work
into FizzDragon's project / crew execution system for delivery, review,
settlement, and reputation.

The loop is:

```text
Creator profile
  -> create service package
  -> buyer consults or orders
  -> buyer fills brief
  -> creator accepts / customizes terms
  -> order starts
  -> workspace / crew assignment executes
  -> creator delivers
  -> buyer reviews / requests revision
  -> order completes
  -> settlement + review + creator stats update
```

This is not a standalone "profile display" feature. The service package is a
transaction entry point.

## 2. Product Principles

- One action always has a next step. No dead-end showcase pages.
- Buyer intent is captured before execution starts.
- Creator effort is bounded by price, deadline, deliverables, and revision
  count.
- Every important state is durable and recoverable after refresh.
- Communication, attachments, brief, delivery, and review are attached to the
  same order context.
- Existing Crew / Position / Assignment stays the execution layer; new Order
  objects are the commercial / agreement layer.
- Java remains a boundary system. FizzDragon server owns this domain.
- Payments / points can start as an integration contract, then become enforced
  when Java wallet APIs are ready.

## 3. Terminology

Use product copy that normal users understand:

| Internal term | User-facing copy    | Meaning                                                             |
| ------------- | ------------------- | ------------------------------------------------------------------- |
| Gig           | Creative Service    | A standardized service a creator sells                              |
| Brief         | Project Brief       | Buyer's structured requirements                                     |
| Order         | Collaboration Order | Confirmed commercial agreement                                      |
| Conversation  | Order Chat          | Chat thread scoped to one service/order/application                 |
| Deliverable   | Delivery            | Files, links, project assets, prompts, or notes submitted by seller |
| Revision      | Revision Request    | Buyer asks seller to adjust delivered work                          |
| Settlement    | Earnings            | Creator income / platform fee / points movement                     |

Avoid showing the word "gig" in product UI. Use "Creative Service" or
"Service Package".

## 4. Existing Foundation

The current Crew module already covers most of the execution loop:

- Crew creation and listing state
- Public Crew Hall and public position discovery
- Position creation, update, delete
- Application submission and owner review
- Member admission after application approval
- Workspace episodes
- Assignment creation
- Assignment submission
- Assignment review
- Revenue recording
- Notification outbox and activity log

What is missing for a marketplace-grade loop:

- Creator-owned service packages
- Structured buyer brief before work starts
- Order state machine and commercial agreement
- Order-scoped chat
- Delivery artifacts independent from episode assignments
- Buyer acceptance / revision loop
- Settlement and review records
- Public creator profile stats derived from completed work

## 5. System Boundary

```text
Web
  |
  | /aurora/creator-services/*
  | /aurora/orders/*
  | /aurora/conversations/*
  v
NestJS server
  |-- service package domain
  |-- brief validation
  |-- order state machine
  |-- conversation/message domain
  |-- deliverable/revision domain
  |-- notification + realtime events
  |-- crew/project binding
  |
  | calls when needed
  v
Java boundary services
  |-- user profile/session
  |-- KYC status
  |-- points/wallet/payment
  |-- existing project/IP/course lookup
```

Server owns:

- service package source of truth
- order source of truth
- order chat source of truth
- brief/delivery/revision/review source of truth
- permission checks and state transitions
- idempotency
- realtime fanout and outbox

Java owns:

- satoken identity validation
- KYC verification
- points/payment ledger if money or community points move
- canonical Java project/IP/course data when binding existing Java objects

Do not put service/order/chat core state in Java. It is too close to the Crew
module and needs fast iteration with the web UI.

## 6. Domain Model

### 6.1 Creator Profile Extension

The public profile should aggregate data from Java user profile plus
server-owned marketplace data.

Server-owned additions:

- display tagline
- skill tags
- service package list
- portfolio entries
- completed order count
- average rating
- repeat buyer rate
- earnings summary for owner only

Profile pages should be readable without exposing private earnings or order
details.

### 6.2 Creative Service

Represents a standardized package a creator sells.

Suggested fields:

- `id`
- `creatorId`
- `title`
- `slug`
- `summary`
- `category`
- `coverAssetUrl`
- `gallery`
- `packages`
- `briefSchema`
- `deliverableSchema`
- `revisionLimit`
- `basePriceAmount`
- `basePriceCurrency`
- `estimatedDeliveryDays`
- `status`: `draft | listed | paused | archived`
- `stats`
- `createdAt`, `updatedAt`, `listedAt`

`packages` supports tiered offers:

```json
[
  {
    "key": "basic",
    "title": "Basic storyboard pack",
    "priceAmount": 300,
    "currency": "POINTS",
    "deliveryDays": 2,
    "deliverables": ["12 images", "prompts"],
    "revisionLimit": 1
  },
  {
    "key": "pro",
    "title": "Full episode storyboard",
    "priceAmount": 900,
    "currency": "POINTS",
    "deliveryDays": 5,
    "deliverables": ["36 images", "prompts", "shot notes"],
    "revisionLimit": 2
  }
]
```

`briefSchema` is creator-configurable but server-validated. It should reuse the
same schema-driven UI philosophy as Foundry model params:

- field type
- label
- required
- options
- file requirements
- helper text
- conditional visibility

### 6.3 Service Order

Represents a confirmed or pending buyer/seller collaboration.

Suggested fields:

- `id`
- `serviceId`
- `buyerId`
- `sellerId`
- `status`
- `selectedPackageKey`
- `brief`
- `termsSnapshot`
- `priceAmount`
- `priceCurrency`
- `deadlineAt`
- `revisionLimit`
- `revisionUsed`
- `boundCrewId`
- `boundProjectId`
- `boundEpisodeId`
- `boundAssignmentId`
- `paymentIntentId`
- `escrowStatus`
- `acceptedAt`
- `startedAt`
- `deliveredAt`
- `completedAt`
- `cancelledAt`
- `createdAt`, `updatedAt`

Order status:

```text
draft
  -> submitted
  -> accepted
  -> in_progress
  -> delivered
  -> revision_requested
  -> delivered
  -> completed

submitted -> declined
submitted -> cancelled
accepted  -> cancelled
in_progress -> cancelled_by_support
delivered -> auto_completed
```

Meaning:

- `draft`: buyer is filling brief
- `submitted`: seller can accept, decline, or propose changes
- `accepted`: terms are locked; payment/points can be reserved
- `in_progress`: execution has started
- `delivered`: seller submitted deliverables
- `revision_requested`: buyer asked for changes within allowed revision count
- `completed`: buyer accepted or deadline auto-accepted
- `cancelled`: buyer/seller stopped before execution under allowed rules

### 6.4 Conversation and Message

Conversation is scoped to one of:

- service pre-order consultation
- submitted order
- crew application
- crew workspace thread

For this feature, order chat is required.

Suggested fields:

- `Conversation`
  - `id`
  - `kind`: `service_consult | order | crew_application | crew_workspace`
  - `subjectId`
  - `buyerId`
  - `sellerId`
  - `lastMessageAt`
  - `createdAt`

- `Message`
  - `id`
  - `conversationId`
  - `senderId`
  - `body`
  - `attachments`
  - `metadata`
  - `readAt`
  - `createdAt`
  - `deletedAt`

Message attachments should support:

- image
- video
- document
- project asset reference
- order brief reference
- delivery reference

### 6.5 Deliverable and Review

Deliverables must be versioned, not overwritten.

Suggested fields:

- `OrderDelivery`
  - `id`
  - `orderId`
  - `version`
  - `message`
  - `assets`
  - `status`: `submitted | accepted | revision_requested | superseded`
  - `submittedAt`

- `OrderRevisionRequest`
  - `id`
  - `orderId`
  - `deliveryId`
  - `buyerId`
  - `reason`
  - `requestedChanges`
  - `createdAt`

- `OrderReview`
  - `id`
  - `orderId`
  - `buyerId`
  - `sellerId`
  - `rating`
  - `comment`
  - `createdAt`

### 6.6 Settlement

Initial implementation can record settlement intent without moving real money.

Suggested fields:

- `OrderSettlement`
  - `id`
  - `orderId`
  - `sellerId`
  - `buyerId`
  - `grossAmount`
  - `platformFeeAmount`
  - `netAmount`
  - `currency`
  - `status`: `pending | reserved | released | refunded | failed`
  - `externalLedgerId`
  - `createdAt`
  - `releasedAt`

If Java owns points/payment, `externalLedgerId` references Java ledger movement.

## 7. Permission Matrix

| Action              | Buyer       | Seller                  | Crew owner               | Crew member              | Admin      |
| ------------------- | ----------- | ----------------------- | ------------------------ | ------------------------ | ---------- |
| Create service      | no          | yes                     | yes if creator           | yes if creator           | yes        |
| List/unlist service | no          | own only                | own only                 | own only                 | yes        |
| Submit order brief  | yes         | no                      | yes as buyer             | yes as buyer             | yes        |
| Accept order        | no          | own service only        | no                       | no                       | yes        |
| Send order message  | participant | participant             | participant if bound     | participant if bound     | yes        |
| Start order         | no          | seller after acceptance | no                       | no                       | yes        |
| Submit delivery     | no          | seller                  | assigned member if bound | assigned member if bound | yes        |
| Request revision    | buyer only  | no                      | buyer if order owner     | no                       | yes        |
| Complete order      | buyer only  | no                      | buyer if order owner     | no                       | yes        |
| Settle              | system      | no                      | no                       | no                       | yes/system |

Every write endpoint must check:

- authenticated user
- actor role in the resource
- current state allows transition
- idempotency key where double-submit is possible
- KYC/points/payment gate when configured

## 8. API Design

Use `/aurora` because this domain is server-owned.

### Creator Services

```text
GET    /aurora/creator-services
GET    /aurora/creator-services/:id
POST   /aurora/creator-services
PATCH  /aurora/creator-services/:id
POST   /aurora/creator-services/:id/list
POST   /aurora/creator-services/:id/pause
POST   /aurora/creator-services/:id/archive
GET    /aurora/users/:userId/creator-services
```

### Orders

```text
POST   /aurora/creator-services/:serviceId/orders/draft
PATCH  /aurora/orders/:orderId/brief
POST   /aurora/orders/:orderId/submit
POST   /aurora/orders/:orderId/accept
POST   /aurora/orders/:orderId/decline
POST   /aurora/orders/:orderId/start
POST   /aurora/orders/:orderId/cancel
GET    /aurora/orders
GET    /aurora/orders/:orderId
```

### Delivery

```text
POST   /aurora/orders/:orderId/deliveries
POST   /aurora/orders/:orderId/deliveries/:deliveryId/accept
POST   /aurora/orders/:orderId/deliveries/:deliveryId/request-revision
POST   /aurora/orders/:orderId/complete
```

### Conversation

```text
GET    /aurora/conversations/:conversationId/messages
POST   /aurora/conversations/:conversationId/messages
POST   /aurora/conversations/:conversationId/read
```

### Binding to Crew / Project

```text
POST   /aurora/orders/:orderId/bind-crew
POST   /aurora/orders/:orderId/create-assignment
POST   /aurora/orders/:orderId/sync-delivery-to-project-assets
```

## 9. Event / Realtime Contract

The UI should work with both realtime and polling.

Events:

- `order.submitted`
- `order.accepted`
- `order.started`
- `order.delivered`
- `order.revision_requested`
- `order.completed`
- `order.cancelled`
- `order.settlement_released`
- `message.created`
- `delivery.created`

Delivery:

- publish via server outbox
- fan out through WebSocket/WebPubSub
- keep REST reconciliation endpoint as fallback

UI invariant:

- user never loses a message or order state after refresh
- optimistic message bubbles reconcile against server IDs
- duplicate sends are collapsed by idempotency key

## 10. UIUX Blueprint

### 10.1 Creator Profile

Purpose: prove trust and drive conversion.

Sections:

- hero identity: avatar, name, tagline, location/language, verification
- stats: completed orders, rating, response time, repeat buyers
- service packages
- portfolio
- reviews
- earnings panel, owner-only

Primary actions:

- buyer: "Request service", "Message creator", "Invite to crew"
- owner: "Create service", "Edit profile", "View earnings"

Do not turn this into a resume wall. The first viewport should expose at least
one purchasable service.

### 10.2 Service Detail Page

Purpose: help buyer decide and start a structured order.

Layout:

- left: description, gallery, deliverables, workflow, FAQ, reviews
- right sticky panel: package selector, price, delivery days, revision count,
  start button, consult button

Primary CTA:

- `Start request`

Secondary CTA:

- `Message creator`
- `Invite to crew`

Package card must clearly show:

- what is included
- delivery time
- revision count
- price
- unavailable / paused state if seller cannot accept work

### 10.3 Brief Form

Purpose: prevent vague orders.

The form is generated from `service.briefSchema`.

Default fields:

- project/IP name
- goal
- target audience
- style references
- script / episode / scene scope
- output count or duration
- aspect ratio / format
- attachments
- deadline
- extra notes

UX requirements:

- autosave draft
- inline validation
- section progress
- attachment upload progress
- "use existing project" selector
- "create lightweight workspace" fallback

### 10.4 Order Room

Purpose: one place for chat, requirements, delivery, and state.

Layout:

- left rail: order state timeline
- center: conversation
- right panel: brief, terms, deliverables, payment/points, crew/project binding

Timeline:

```text
Brief submitted -> Accepted -> In progress -> Delivered -> Completed
```

Every state transition should appear in the chat as a system message.

### 10.5 Delivery Review

Buyer sees:

- delivery version
- assets
- notes
- buttons: accept, request revision
- remaining revisions
- deadline and auto-complete rules

Seller sees:

- submitted version history
- revision request details
- next delivery CTA

### 10.6 Earnings

Creator owner-only panel:

- pending earnings
- completed earnings
- order history
- service performance
- conversion funnel
- payout/points records

No public visitor should see private earnings.

## 11. State Machine Rules

### Order

- `draft` can only be edited by buyer.
- `submitted` locks buyer brief except attachment append / seller questions.
- `accepted` snapshots terms and reserves payment/points if enabled.
- `in_progress` can create bound crew assignment.
- `delivered` waits for buyer decision.
- `revision_requested` increments revision count.
- `completed` freezes delivery/review state.
- `cancelled` keeps audit trail and messages.

### Delivery

- only seller can submit delivery unless admin override
- a delivery supersedes previous `submitted` delivery after revision
- accepted delivery cannot be deleted
- revision request must reference a specific delivery version

### Settlement

- no release before order is completed
- no refund after release without admin reversal
- all money/points operations are idempotent
- external Java ledger errors keep local state as `pending` or `failed`, not
  silently completed

## 12. Reliability / 4 Nines Practices

Target user-facing availability for order read/write paths: 99.99%.

Required engineering practices:

- Postgres is the source of truth for orders, messages, deliveries.
- Every state transition happens in a database transaction.
- External Java calls use timeouts, retries where safe, and circuit breakers.
- Payment/points calls use idempotency keys.
- Message send uses client idempotency key to avoid duplicate bubbles.
- Outbox pattern for notifications and realtime events.
- Polling reconciliation for every realtime surface.
- Soft delete for user-created marketplace records.
- Immutable snapshots for accepted order terms.
- Audit fields for every critical transition.
- Row-level optimistic locking for editable resources.
- Rate limits for message send, order submit, and attachment upload.
- Dead-letter queues for failed notification/payment sync.
- Admin/operator tooling for stuck orders.

Operational metrics:

- order submit success rate
- accept latency
- message delivery latency
- delivery review latency
- Java KYC/payment error rate
- settlement failure count
- stuck orders by status and age
- unread messages per conversation
- creator response time

## 13. Java Integration Points

### KYC

When configured by region:

- before creator lists a service
- before seller accepts an order
- before buyer places paid/points order

Failure mode:

- return clear actionable error
- do not create paid order in ambiguous state

### Points / Payment

Phases:

1. Local order only, no real funds.
2. Java points precheck.
3. Java points reserve on `accepted`.
4. Java points release/refund on `completed/cancelled`.
5. Full payment/escrow if money product is introduced.

Local server stores only:

- external ledger id
- amount snapshot
- status mirror
- last sync error

Java remains ledger authority.

### Existing Projects / IP / Courses

Orders can bind to:

- Java project id
- IP id
- course/community activity id
- server-owned crew id
- server-owned episode/assignment id

The order should store binding references but not duplicate Java object state
except display snapshots needed for audit.

## 14. Implementation Phases

### Phase 1: Service + Order MVP

- creator can create/list/pause service packages
- buyer can start request and fill brief
- seller can accept/decline
- order room exists with state timeline
- order-scoped chat
- delivery submit / accept / request revision
- no real payment movement yet
- optional crew/project binding

This phase proves the core loop.

### Phase 2: Crew Execution Binding

- accepted order can create crew assignment
- assignment delivery can sync back to order delivery
- order completion can update creator stats
- activity log and notification integration
- public creator profile shows completed work and reviews

### Phase 3: Points / Settlement

- Java points precheck / reserve / release
- seller earnings panel
- platform fee
- order cancellation/refund rules
- admin handling for failed settlement

### Phase 4: Marketplace Growth

- search and discovery
- service ranking
- saved creators/services
- repeat purchase
- invite creator to crew
- creator availability calendar
- promoted services

## 15. Product Acceptance Criteria

The loop is production-ready only when:

- a buyer can complete the full request -> order -> delivery -> review path
- a seller can list a service and receive work without manual admin help
- order chat is preserved and reload-safe
- brief, terms, delivery, and review are all visible in one order room
- every order status has exactly one valid next action per actor
- buyer and seller can both understand what is expected next
- every paid/points transition is idempotent and auditable
- completed work updates creator stats
- failed external integrations never produce silent success
- support/admin can inspect and recover stuck orders

## 16. Open Product Decisions

- Should service orders be public-facing before creator profiles are upgraded?
- Should buyer be allowed to order without binding to a project?
- Should every accepted order create a Crew assignment, or only when the buyer
  chooses to bind it?
- Should revision count be strict from day one?
- Should community points be the default currency before Java wallet is ready?
- Should CN require KYC for listing services, accepting orders, or both?
- Should order chat support voice/video attachments in MVP?

## 17. Recommended Direction

Do not build this as a separate marketplace disconnected from Crew.

Build it as:

```text
Creator Profile
  -> Creative Service
  -> Order
  -> Order Chat
  -> Delivery
  -> Review / Settlement
  -> optional Crew Assignment binding
```

The Crew module remains the project execution backbone. The new service/order
layer turns creator profiles into transaction entry points and gives the
platform the missing commercial agreement layer.
