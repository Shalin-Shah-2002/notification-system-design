# Notification System Design

**Learning System Design by building a real, load-tested, production-shaped notification pipeline — not by memorizing diagrams.**

This project started as a simple `API → MongoDB` Express service and evolved, one bottleneck at a time, into a distributed pipeline:

```
Client
  ↓
Nginx Load Balancer
  ↓
Server × 2        (stateless Express API instances)
  ↓
Redis Queue       (backpressure + idempotent enqueue)
  ↓
Worker Pool       (scaling, retries, exponential backoff)
  ↓
MongoDB           (persistence)
  ↓
DLQ               (dead-letter queue for failed jobs)
```

The method followed throughout:

> **Build → Load Test → Find Bottleneck → Improve → Break → Recover → Scale**

---

## Why this project exists

System Design isn't about memorizing technologies. It's about asking:

- What happens when traffic increases?
- What happens when a service fails?
- Where is the bottleneck?
- How does the system recover?
- How do we scale it?

Every feature in this repo was added to answer one of those questions after a load test proved it mattered.

---

## What's implemented

| Concept | How it shows up here |
| --- | --- |
| **REST APIs** | Express ingestion endpoints (`/notifications`, `/notifications-v2`) |
| **Direct persistence (v1)** | Write to MongoDB inline in the request — the baseline that everything else improved on |
| **Queue-backed async processing (v2)** | Enqueue to Redis, workers drain it — request latency decoupled from write latency |
| **Nginx Load Balancing** | Traffic distributed across two stateless API instances |
| **Horizontal Scaling** | Stateless servers + worker processes identified via `INSTANCE_ID` / `WORKER_PROC` |
| **Worker Scaling** | N concurrent workers per process (`WORKERS`), multiple worker processes |
| **Backpressure** | Lua-enforced max queue depth (`MAX_QUEUE = 5000`) → `429 Queue full` instead of silent overload |
| **Idempotency** | `Idempotency-Key` header → SHA-256 jobId, checked + set atomically in one Lua script (no duplicate jobs, no check-then-insert race) |
| **Reliable processing** | `BRPOPLPUSH` into a processing list — a job is never lost between "popped" and "done" |
| **Crash recovery** | On startup, workers requeue jobs left in the processing list by a dead process |
| **Retries + Exponential Backoff** | 3 attempts with 1s → 2s → 4s delays |
| **Dead Letter Queue** | Jobs that exhaust retries land in `notifications:dlq`, inspectable via `GET /dlq` |
| **Exactly-once effects** | Duplicate job IDs rejected by a unique MongoDB index (`11000` treated as success) |
| **k6 Load Testing** | Constant-arrival-rate scenarios for both v1 and v2 flows |

---

## The experiment that taught the most: worker scaling

Driving **100 jobs/sec** through the queue and varying the worker pool size:

| Workers | Throughput |
| ---: | ---: |
| 1 | 17.6 jobs/sec |
| 2 | 37 jobs/sec |
| 5 | 95.7 jobs/sec |
| 10 | 98.9 jobs/sec |

Scaling from 1 → 5 workers was nearly linear. From 5 → 10 it flattened hard — **adding more workers stopped helping because a downstream dependency (MongoDB writes) became the bottleneck.** Scaling a pool beyond its downstream's capacity just moves the queue.

That single data point is worth more than a chapter on Amdahl's law.

---

## Architecture in detail

### v1 — Direct write (`POST /notifications`)

```
Client → Express → MongoDB.insert() → 201
```

Simple. Every request pays the full MongoDB write latency. Under k6 load at 150 rps this is where request time and error rates exposed the first bottleneck: the write path sits inside the request, so DB spikes become client-facing failures.

### v2 — Queue-backed (`POST /notifications-v2`)

```
Client → Express → Lua: [idempotency check + queue cap + enqueue] → 202
Worker pool → BRPOPLPUSH → MongoDB insert (retries → DLQ)
```

The enqueue is a single Redis Lua script so idempotency, the queue cap, and the push are atomic:

1. If the idempotency key already exists → return the existing job (`200 ALREADY_QUEUED`, no duplicate).
2. If the queue is at `MAX_QUEUE` → reject with `429` (backpressure).
3. Otherwise `SET` the idempotency key (24h TTL) and `LPUSH` the job → `202 QUEUED`.

Workers loop on `BRPOPLPUSH` (queue → processing list), write to MongoDB, then remove from the processing list. A `try/catch`-around-the-whole-loop plus the startup requeue means:

- worker dies mid-job → job requeued on next start
- MongoDB down → retries with exponential backoff → job lands in the DLQ, never silently dropped
- same job delivered twice → unique index makes the second insert a no-op

### Observability endpoints

- `GET /queue` — queue depth + first 20 pending jobs
- `GET /dlq` — DLQ count + first 20 dead jobs

Logs on every request and job include timings, queue depth, instance/worker IDs — enough to answer "where is the time going and which instance saw it."

---

## Running it

**Prerequisites:** Node.js 18+, MongoDB, Redis, k6 (for load tests), Nginx (optional, for the LB topology).

```bash
git clone https://github.com/Shalin-Shah-2002/notification-system-design.git
cd notification-system-design
npm install
cp .env.example .env   # fill in your values
```

### Start the pieces

```bash
# API server (run 2 instances for the LB topology)
PORT=3000 INSTANCE_ID=server-1 node server.js
PORT=3001 INSTANCE_ID=server-2 node server.js

# Worker pool (scale by raising WORKERS or launching more processes)
WORKERS=5 WORKER_PROC=1 node worker.js
WORKERS=5 WORKER_PROC=2 node worker.js
```

### Example Nginx load balancer

```nginx
upstream notification_api {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

server {
    listen 8081;
    location / {
        proxy_pass http://notification_api;
    }
}
```

### Load testing

```bash
# v1: direct-to-MongoDB baseline
k6 run load-test.js

# v2: queued flow, rate/duration configurable
RATE=150 DURATION=60s k6 run load-test-v2.js

# reproduce the worker-scaling experiment
RATE=100 DURATION=60s k6 run load-test-v2.js
# with WORKERS=1, then 2, then 5, then 10 — watch throughput flatten
```

### API

#### `POST /notifications` — v1, direct write

```json
{
  "userId": "123",
  "channel": "email",
  "template": "welcome",
  "data": { "name": "Shalin" }
}
```

`201` with `{ notificationId, status }`.

#### `POST /notifications-v2` — queued, idempotent

Same body plus an `Idempotency-Key` header. Returns `202 { jobId, status: "QUEUED", queueDepth, instance }`, `200 { status: "ALREADY_QUEUED" }` for replays, or `429 { error: "Queue full" }` under backpressure.

#### `GET /queue` · `GET /dlq` — inspect pending and dead jobs

---

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `MONGO_URL` | server, worker | MongoDB connection string |
| `REDIS_URL` | server, worker | Redis connection string |
| `PORT` | server | HTTP port (default 3000) |
| `INSTANCE_ID` | server | Identifies the API instance in responses/logs |
| `WORKERS` | worker | Concurrent worker loops per process (default 5) |
| `WORKER_PROC` | worker | Process label for multi-process worker setups |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | worker | How long the worker waits for MongoDB before starting anyway (it keeps retrying jobs) |

---

## Roadmap

The system keeps evolving in the same build → break → fix loop:

- [ ] **Caching layer** — with documented invalidation, consistency, failure, and observability behavior
- [ ] **Database scaling** — replica sets, read scaling, sharding
- [ ] **Distributed consistency** — what happens when two workers race the same job
- [ ] **Fault tolerance drills** — kill Redis / MongoDB / a server mid-load-test and watch recovery
- [ ] **Capacity planning** — formal model connecting queue depth, worker count, and DB write capacity
- [ ] **Kafka migration** — compare Redis list semantics vs. a real log-based broker
- [ ] **Observability stack** — Prometheus + Grafana dashboards off the metrics already being logged

---

## Biggest lesson

System design isn't about memorizing technologies. It's about asking what happens when traffic increases, when a service fails, where the bottleneck is, how the system recovers, and how it scales — and then **proving the answers with load tests instead of assuming them**.

Still building. Still breaking. Still learning.

---

Built by [Shalin Shah](https://www.linkedin.com/in/shalin-shah0705) as a learn-in-public project.
