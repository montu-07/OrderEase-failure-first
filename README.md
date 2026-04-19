# OrderEase - Failure-Resilient Ordering System

A production-grade restaurant ordering system demonstrating **distributed systems patterns** for high-reliability order processing. Built to showcase event sourcing, idempotency, and failure recovery in a real-world domain.

> **Problem**: How do you guarantee exactly-once semantics and financial consistency in a distributed system where servers crash, networks fail, and clients retry?

> **Solution**: Event-sourced state + idempotent APIs + recovery workers with DB-level locking.

---

## 🎯 Core Design Principles

- **Failure-first design**: System assumes crashes and network failures will occur
- **Event-sourced state**: Order lifecycle tracked as append-only events (audit trail + time travel)
- **Idempotent workflows**: Client retries are safe; duplicate requests return cached results
- **Integer-based currency**: All amounts stored as cents to avoid IEEE-754 precision issues
- **Autonomous recovery**: Background workers detect and resolve stuck payments/refunds
- **Distributed locking**: `FOR UPDATE SKIP LOCKED` prevents concurrent processing by replicas
- **State machine validation**: All order transitions validated; invalid transitions rejected

---

## 📊 Order Lifecycle (State Machine)

Orders transition through a well-defined state machine, derived from the event log:

```
┌─────────────┐
│   PENDING   │ ← Initial state (ORDER_REQUESTED)
└──────┬──────┘
       │
       ↓ Cart validated, items snapshotted (ORDER_VALIDATED)
┌─────────────┐
│  CONFIRMED  │ ← Payment initiated (PAYMENT_INITIATED)
└──────┬──────┘
       │
       ├─→ Payment succeeds (PAYMENT_SUCCEEDED) ──→ CONFIRMED (terminal)
       │
       └─→ Payment fails (PAYMENT_FAILED) ──────→ FAILED (terminal)

Cancellation path:
CONFIRMED + ORDER_CANCELLED → Refund eligibility evaluated
  ↓
PAYMENT_REFUNDED event → Refund issued (terminal)
```

**Key Insight**: Current state is **derived** from events. No state is stored—it's computed by replaying events. This enables:
- **Audit trail**: Full history of what happened and when
- **Time travel**: Replay events to reproduce any historical state
- **Recovery**: Workers query events to detect stuck orders

---

## 🔥 Chaos Scenarios & Recovery Guarantees

### Scenario 1: Server Crashes After PAYMENT_SUCCEEDED

**What Happens:**
- Payment gateway confirms success
- `PAYMENT_SUCCEEDED` event written to DB
- Server crashes before emitting `ORDER_CONFIRMED`

**Recovery:**
State derivation treats `PAYMENT_SUCCEEDED` as terminal:
```typescript
deriveOrderState([
  { type: 'PAYMENT_INITIATED' },
  { type: 'PAYMENT_SUCCEEDED' }
]);
// → OrderState.CONFIRMED
```
No `ORDER_CONFIRMED` event needed. Payment success = order complete.

**Guarantee:**
- ✅ Payment processed exactly once (gateway idempotency by payment ID)
- ✅ Order state always derivable from events
- ✅ No duplicate charges (idempotency key prevents retries from creating new payments)

---

### Scenario 2: Client Retries Checkout Multiple Times

**What Happens:**
Client submits checkout with `idempotencyKey`. Request times out. Client retries with same key.

**Recovery:**
```typescript
const existing = await tx.idempotencyKey.findUnique({ where: { key } });
if (existing) return existing.response.orderId; // ← Cached result
```
Idempotency key stored **in same transaction** as order creation. Either both succeed or both roll back.

**Guarantee:**
- ✅ Checkout is exactly-once at business level
- ✅ No zombie orders (transaction atomicity)
- ✅ Safe for network failures (clients can always retry)

---

### Scenario 3: Worker Crashes Mid-Payment Processing

**What Happens:**
Payment stuck in `INITIATED` state (gateway timeout, network failure). `PaymentRecoveryWorker` runs every 30 seconds:

```sql
SELECT id, "orderId"
FROM payments
WHERE status = 'INITIATED' AND "createdAt" < (NOW() - INTERVAL '1 minute')
FOR UPDATE SKIP LOCKED
LIMIT 10
```

**Critical Pattern**: `FOR UPDATE SKIP LOCKED`
- Multiple replicas run concurrently
- Each worker "claims" payments via row-level locking
- `SKIP LOCKED` prevents blocking on already-claimed rows
- Crash → locks released → payment becomes claimable again

**Recovery:**
Worker retries. Processing is idempotent (gateway recognizes duplicate payment IDs).

**Guarantee:**
- ✅ Payments eventually resolved (workers retry until terminal state)
- ✅ No two workers process same payment simultaneously
- ✅ Worker crashes don't lose work (locks auto-released)

---

### Scenario 4: Order Cancelled After Payment Success

**What Happens:**
1. Payment succeeds (`PAYMENT_SUCCEEDED`)
2. User cancels (`ORDER_CANCELLED` event)
3. System must issue refund

**Recovery:**
`RefundRecoveryWorker` queries for refund-eligible orders:
```sql
SELECT p."orderId"
FROM payments p
WHERE p.status = 'SUCCEEDED'
  AND EXISTS (SELECT 1 FROM order_events WHERE "orderId" = p."orderId" AND type = 'ORDER_CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM payments WHERE "orderId" = p."orderId" AND status = 'REFUNDED')
FOR UPDATE OF p SKIP LOCKED
```

Worker calls `RefundOrchestrator.initiateRefund()`, which emits `PAYMENT_REFUNDED` event.

**Guarantee:**
- ✅ Refunds are idempotent (gateway deduplicates by refund ID)
- ✅ No double refunds (event log + payment status prevent reprocessing)
- ✅ Eventually consistent (worker retries on timeout)
- ✅ Audit trail (`PAYMENT_REFUNDED` event = proof of refund)

---

## 🛒 Cart System (Fast + Eventually Consistent)

Cart and orders don’t behave the same way.

Orders must be **strictly consistent** because they involve money.
Carts, on the other hand, need to be **fast and flexible**, while still ending up correct.

---

### ⚡ Core Idea

* **Redis** → handles real-time reads/writes
* **Kafka** → captures every cart action as an event
* **Worker** → syncs Redis → Database in batches

```
User Action → API → Redis (instant)
                  ↓
               Kafka event
                  ↓
             Cart Worker
                  ↓
          Batch DB sync
```

---

### 🔄 Cart Flow

#### Add / Update Item

* API writes directly to Redis
* Kafka event is emitted
* Response is returned immediately

👉 No waiting for DB → instant user experience

---

#### Read Cart

* Always read from Redis
* Fallback to DB only if needed (rare case)

---

### 🤔 Why Not Direct DB Writes?

Because:

* Users update carts very frequently
* DB cannot handle high-frequency small writes efficiently
* It becomes a bottleneck under load

👉 Redis handles speed
👉 DB handles persistence

---

### ⚙️ Worker Design

The worker is not processing every event blindly.

---

#### 1. Debounce (Prevent Noise)

If user updates rapidly:

```
update → update → update
```

👉 Only first event in a short window is processed
👉 Avoids unnecessary DB writes

---

#### 2. Always Use Latest State

Worker never trusts event payload.

```
→ fetch latest cart from Redis
→ sync correct state
```

👉 Even if events are out of order → data stays correct

---

#### 3. Batch Processing

Instead of:

```
100 updates → 100 DB writes ❌
```

We do:

```
100 updates → 1 batch write ✅
```

👉 Massive reduction in DB load

---

### 📊 Example

User increases quantity quickly:

```
1 → 2 → 3
```

* Redis always has latest value = 3
* Worker skips intermediate updates
* DB stores only final state

---

### 🛡️ Failure Handling

#### Worker Crash

* Redis still holds latest cart
* Worker resumes and syncs later

#### Duplicate Events (Kafka)

* Idempotency prevents double processing

#### Rapid Updates

* Debounce protects DB

#### DB Failure / Delay

* Worker retries in next batch cycle

---

## 🚀 Running Locally

### Prerequisites
- Node.js 18+
- pnpm 8+ (`npm install -g pnpm`)
- PostgreSQL 14+

### Quick Start
```bash
# Clone and install
git clone https://github.com/TECH-SIGN/OrderEase.git
cd OrderEase
pnpm install

# Setup database
cd apps/backend
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT secrets

# Initialize DB
pnpm prisma generate
pnpm prisma migrate deploy
pnpm prisma db seed

# Start services
pnpm dev
```

**Default accounts:**
- Admin: `admin@orderease.com` / `admin123`
- User: `user@orderease.com` / `user123`

**Endpoints:**
- Backend API: `http://localhost:3001/api`
- API Docs: `http://localhost:3001/api/docs`

---

## 📚 Additional Documentation

- [ARCHITECTURE.md](./doc/ARCHITECTURE.md) - Detailed system architecture
- [QUICK_START.md](./doc/QUICK_START.md) - Comprehensive setup guide
- [DEPLOYMENT.md](./doc/DEPLOYMENT.md) - Production deployment instructions
- [PORTFOLIO.md](./doc/PORTFOLIO.md) - Project showcase details

---
