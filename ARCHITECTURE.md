# RabbitTech Logistics — Complete Production Architecture

> **"Uber for Trucks"** — A billion-scale digital freight matching platform.

---

## Table of Contents

1. [Domain Model](#1-domain-model)
2. [Architecture Design](#2-architecture-design)
3. [Tech Stack](#3-tech-stack)
4. [Database Schema](#4-database-schema)
5. [Matching Engine](#5-matching-engine)
6. [Payments & Financial System](#6-payments--financial-system)
7. [Tracking System](#7-tracking-system)
8. [Security](#8-security)
9. [DevOps & Deployment](#9-devops--deployment)
10. [Scalability & Reliability](#10-scalability--reliability)
11. [Testing Strategy](#11-testing-strategy)
12. [Code Structure](#12-code-structure)
13. [Production Audit — Findings & Hardening](#13-production-audit--findings--hardening)

---

## 1. Domain Model

### Core Entities

| Entity | Description | Key Relationships |
|--------|-------------|-------------------|
| **Organization** | Shipper or Carrier company | Has members, trucks, loads, ledger accounts |
| **User** | Platform participant | Belongs to 1+ organizations with role-scoped access |
| **Driver Profile** | CDL-licensed driver | Linked to user + organization; assigned to trucks |
| **Truck** | Freight vehicle | PostGIS-tracked location; typed (DRY_VAN, REEFER, etc.); assigned driver |
| **Load** | Shipment request | Origin/dest points; cargo type; weight; rate; status state machine |
| **Bid** | Carrier's price offer | Links load ↔ carrier ↔ driver ↔ truck |
| **Assignment** | Accepted load-carrier pairing | Triggers status cascade; links to payment/ledger |
| **Payment** | Stripe-backed escrow | Gross → platform fee → net carrier; advance + settlement |
| **Carrier Payout** | Scheduled transfer to carrier | Batch processed; Stripe Transfer API |
| **Ledger (Journal/Entry)** | Double-entry accounting | Immutable append-only; debit/credit balanced per journal |
| **Telemetry Log** | GPS + vehicle data | Partitioned by week; sub-second ingestion via Redis pipeline |
| **Pricing Model** | Dynamic rate configuration | Distance-based, surge, fuel/cargo surcharges |
| **Notification** | Multi-channel alerts | EMAIL, SMS, PUSH, IN_APP; template-driven |

### Load Status State Machine

```
DRAFT → POSTED → BIDDING → CONFIRMED → IN_TRANSIT → DELIVERED
                                    ↘ CANCELLED
                    DISPUTED ←──────────────────────┘
```

Transition enforcement: PostgreSQL trigger `trg_load_status_transition` with explicit allowed-pairs matrix. Illegal transitions raise `ERRCODE 23514`.

### Aggregate Boundaries

- **Load Aggregate**: Load + Bids + Assignment + StatusAuditLog + Payment
- **Organization Aggregate**: Organization + Members + Trucks + DriverProfiles + LedgerAccounts
- **Tracking Aggregate**: Truck + TelemetryLogs + ETACheckpoints + Geofences

---

## 2. Architecture Design

```
                   ┌──────────────────────────────────────────────────────────┐
                   │                    INTERNET / CDN                         │
                   └────────────────────────┬─────────────────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  Nginx / K8s     │  TLS 1.2+
                                   │  Ingress         │  Rate limiting
                                   │                  │  WebSocket upgrade
                                   └──┬──────────┬───┘
                                      │          │
                    ┌─────────────────┘          └────────────────┐
                    │                                             │
           ┌────────▼────────┐                         ┌──────────▼──────────┐
           │  API Service     │ ×3–20                   │  Tracking Service    │ ×2–15
           │  (Express 5)     │                         │  (Socket.IO)         │
           │                  │                         │                      │
           │  REST /api/v1/** │                         │  GPS ping ingest     │
           │  Auth/RBAC       │                         │  Redis hot-store     │
           │  Pricing engine  │                         │  Batch flush → PG    │
           │  Payment/Stripe  │                         │  Offline detection   │
           └──────┬───────────┘                         └──────────┬──────────┘
                  │                                                │
    ┌─────────────┼────────────────────────────────────────────────┼─────────────┐
    │             │                                                │             │
┌───▼────┐  ┌────▼────┐  ┌────────┐  ┌───────────┐  ┌───────────▼──┐  ┌──────┐
│Postgres│  │  Redis   │  │ Kafka  │  │Elasticsearch│  │  Workers     │  │ S3   │
│+PostGIS│  │ Cluster  │  │ (KRaft)│  │             │  │              │  │      │
│        │  │          │  │        │  │  Load board  │  │  • Matching  │  │ POD  │
│ RLS    │  │ GPS geo  │  │ Events │  │  search      │  │  • Notify   │  │images│
│ Ledger │  │ Pub/sub  │  │ Stream │  │             │  │  • Analytics │  │      │
│ Audit  │  │ Queues   │  │        │  │             │  │  • Payment   │  │      │
└────────┘  └─────────┘  └────────┘  └────────────┘  └──────────────┘  └──────┘
```

### Service Responsibilities

| Service | Port | Scaling | Description |
|---------|------|---------|-------------|
| **API** | 3000 | HPA 3→20 (CPU 70%) | REST endpoints, auth, RBAC, business logic |
| **Tracking** | 3001 | HPA 2→15 (WebSocket connections) | GPS ingestion, real-time position broadcast |
| **Matching Worker** | — | 2 replicas | PostGIS spatial queries + scoring algorithm |
| **Notification Worker** | — | 2 replicas | Email (SES), SMS (Twilio), Push (FCM), In-App |
| **Analytics Worker** | — | 1 replica | Kafka → ES indexing, materialized view refresh |
| **Payment Worker** | — | 1 replica | Scheduled carrier payout processing |

### Event-Driven Architecture

All domain state changes publish events to Kafka topics:

| Topic | Events | Consumers |
|-------|--------|-----------|
| `load.events` | created, posted, updated, cancelled, delivered | Analytics, Notification |
| `bid.events` | placed, accepted, rejected, expired | Notification, Analytics |
| `assignment.events` | created, completed, cancelled | Payment, Analytics |
| `payment.events` | escrow_created, escrow_held, settled, failed | Analytics, Notification |
| `tracking.events` | geofence_enter, geofence_exit, eta_updated | Notification |
| `notification.events` | sent, delivered, failed | Analytics |
| `pricing.events` | quote_generated, model_updated | Analytics |

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Runtime** | Node.js 20 LTS | Event-loop ideal for I/O-heavy GPS ingestion; strong ecosystem |
| **Language** | TypeScript 5.6 (strict) | Type safety across services; shared domain types |
| **API** | Express 5 | Battle-tested, middleware ecosystem, async error handling |
| **Validation** | Zod 3 | Runtime schema validation + TypeScript type inference |
| **Real-time** | Socket.IO 4.8 | WebSocket + fallback; Redis adapter for multi-instance |
| **Database** | PostgreSQL 16 + PostGIS 3.4 | ACID transactions, RLS, spatial queries, partitioning |
| **Cache/Queue** | Redis 7.4 + BullMQ 5 | GPS hot-store (GEO), pub/sub, priority job queues |
| **Events** | Kafka (KRaft) | Durable event log, exactly-once semantics, decoupled consumers |
| **Search** | Elasticsearch 8 | Load board full-text + geo_distance + faceted filtering |
| **Payments** | Stripe (PaymentIntents + Transfers) | Escrow via manual capture, Connected Accounts for payouts |
| **Storage** | AWS S3 | POD photo uploads via presigned URLs |
| **Observability** | Prometheus + Grafana + Pino (structured JSON) | Custom metrics, dashboards, alert rules |
| **CI/CD** | GitHub Actions | Lint → Test → Build → Scan → Stage → Canary Production |
| **Container** | Docker multi-stage builds | Node 20 Alpine, <100MB images |
| **Orchestration** | Kubernetes (EKS) | HPA, PDB, NetworkPolicy, zone-aware scheduling |
| **TLS** | cert-manager + Let's Encrypt | Auto-renewal, HSTS preload |

---

## 4. Database Schema

### Overview

Full schema in `schema.sql` (~2000 lines). Key design decisions:

- **Row-Level Security (RLS)** on every table — `app.current_user_id` session variable set per request
- **Temporal partitioning** — `telemetry_logs` weekly partitions for sub-second insert + fast range queries
- **EXCLUDE USING GIST** — prevents overlapping truck assignments
- **Double-entry ledger** — balanced journals enforced by check constraint
- **State machine trigger** — explicit allowed-transition matrix for load status
- **Immutable audit log** — DELETE/UPDATE blocked on `status_audit_log`
- **PostGIS GEOGRAPHY** — all coordinates use SRID 4326 for meter-accurate distance queries

### Table Map

| Category | Tables |
|----------|--------|
| **Core** | organizations, users, organization_members, driver_profiles |
| **Fleet** | trucks (PostGIS location) |
| **Freight** | loads (PostGIS origin/dest), bids, assignments |
| **Finance** | payments, carrier_payouts, fraud_signals, ledger_accounts, ledger_journals, ledger_entries |
| **Pricing** | pricing_models, lane_rates, market_rate_snapshots |
| **Tracking** | telemetry_logs (partitioned), geofences, eta_checkpoints |
| **Notifications** | notification_templates, notifications |
| **Audit** | status_audit_log |
| **Analytics** | mv_carrier_scorecard (materialized), mv_lane_analytics (materialized) |

---

## 5. Matching Engine

### Algorithm — `src/api/services/matching.service.ts`

1. **Spatial Query**: `fn_find_trucks_near_pickup(origin, radius_miles)` — PostGIS GIST index scan
2. **Deadhead Filter**: Reject trucks where empty-mile ratio > `DEADHEAD_MAX_RATIO` (default 50%)
3. **Scoring** (0→100):
   - Distance score: `1 - (deadhead_miles / max_deadhead)` × 40 points
   - Equipment match bonus: exact truck_type match = 25 points
   - Driver rating bonus: `driver_rating × 5` (max 25 points)
   - Freshness bonus: truck idle time factor × 10 points
4. **Ranking**: Sort candidates by composite score DESC
5. **Dispatch**: Top candidates pushed to carrier via notification queue or inserted as `PENDING` bids

### Concurrency Control

- Bull job ID = `match:${loadId}` — deduplicated (no concurrent matching for same load)
- SERIALIZABLE transactions for bid acceptance — handles contention via retry on `40001`

---

## 6. Payments & Financial System

### Escrow Flow — `src/api/services/payment.service.ts`

```
Shipper confirms → Stripe PaymentIntent (manual capture) → ESCROW_HELD
                                                              │
              ┌── advance pct? ──→ Stripe Transfer (advance) ──→ PARTIALLY_RELEASED
              │
Delivery confirmed → Stripe capture() → RELEASED
              │
              └── Schedule Carrier Payout (remaining balance, T+2 days)
                      │
                      └── Payment Worker batch → Stripe Transfer → COMPLETED
```

### Double-Entry Ledger

Every financial event creates a balanced journal entry:

```
Settlement example:
  DEBIT   shipper_org AP account     $2,500.00  (gross)
  CREDIT  carrier_org AR account     $2,287.50  (net = gross - 8.5% fee)
  CREDIT  platform REVENUE account   $  212.50  (platform fee)
```

Enforced by PostgreSQL check constraint: `SUM(debits) = SUM(credits)` per journal.

### Fraud Detection

- `fraud_signals` table captures: unusual bid patterns, dispute history, velocity checks
- Stripe dispute webhook → auto-flag HIGH severity signal

---

## 7. Tracking System

### GPS Pipeline — `src/tracking/`

```
Driver App → Socket.IO gps:ping → Rate limit (1/3s) → Redis Pipeline:
  ├─ GEOADD truck:positions (spatial index)
  ├─ HSET truck:meta:{truckId} (latest state)
  ├─ ZADD truck:last_seen (offline detection)
  └─ PUBLISH truck:update:{truckId} (fan-out)

Batch Flush (30s / 500 pings):
  Redis buffer → COPY → telemetry_logs (partitioned by week)

Offline Detection (60s sweep):
  Scan truck:last_seen → tiered alerts:
    > 1 min = DEGRADED   (dashboard warning)
    > 3 min = OFFLINE     (notification to dispatcher)
    > 10 min = CRITICAL   (escalation)
```

### Real-Time Frontend

`src/web/hooks/useTrackingMap.ts` — React hook with Socket.IO subscription, cubic ease-out animation (16ms RAF), error boundary, and auto-reconnect.

`src/web/components/TrackingMapView.tsx` — Mapbox GL JS with animated truck markers, load route line, and geofence visualization.

---

## 8. Security

### Authentication

- **JWT RS256** with 15-minute access tokens + 30-day refresh tokens (stored hashed in Redis)
- Refresh token rotation — one-time use, old token revoked on use
- Brute-force protection: 10 attempts/15min per email hash (Redis counter)
- Password: bcrypt (12 rounds), complexity requirements enforced by Zod schema

### Authorization

- **Per-request RLS**: `SET LOCAL app.current_user_id` injected before every DB query
- **RBAC middleware**: `requireRole('ADMIN', 'DISPATCHER')` — reads cached role from Redis
- **Network Policies** (K8s): Default-deny ingress; explicit allow-lists per service

### API Security

- **Helmet** — HSTS, X-Frame-Options DENY, CSP, no-sniff
- **Rate limiting** — Redis sliding-window per route tier (auth: 10/min, API: 200/min, webhooks: 500/min)
- **Zod validation** — All request bodies validated with strict schemas, max sizes enforced
- **CORS** — Explicit origin whitelist
- **Stripe webhooks** — Signature verification via `constructEvent()`

### Infrastructure Security

- Docker secrets (not environment variables) for all credentials
- K8s Secrets managed via External Secrets Operator / Sealed Secrets
- TLS 1.2+ everywhere (cert-manager + Let's Encrypt)
- PostgreSQL connections require SSL in production
- Redis bound to private network only
- Service accounts with `automountServiceAccountToken: false`
- Trivy container security scanning in CI

---

## 9. DevOps & Deployment

### Docker

- **Multi-stage builds** — `docker/Dockerfile.{api,tracking,worker}`
- Alpine-based Node 20 images (~80MB)
- Non-root user execution

### Docker Compose (Development/Staging)

11 services: nginx, api×3, tracking×2, matching, notification, analytics, payment, postgres, redis, kafka, elasticsearch

### Kubernetes (Production)

```
k8s/
├── namespace.yaml              # logistics namespace
├── configmap.yaml              # shared env config
├── secrets.yaml                # vault-injected secrets
├── service-accounts.yaml       # per-service IRSA
├── ingress.yaml                # TLS + path routing
├── network-policies.yaml       # zero-trust microsegmentation
├── pdb.yaml                    # Pod Disruption Budgets
├── api/deployment.yaml         # Deployment + Service + HPA
├── tracking/deployment.yaml    # Deployment + Service + HPA
└── workers/deployment.yaml     # 4 worker deployments
```

Key K8s features:
- **HPA**: API scales 3→20 pods on CPU (70%) + custom metric (1000 req/s)
- **PDB**: min 2 API pods available during node drain
- **Topology spread**: cross-zone scheduling for HA
- **Startup probes**: 60s grace period for cold starts
- **Pre-stop hooks**: 5s sleep for graceful connection drain

### CI/CD — `.github/workflows/`

| Pipeline | Trigger | Steps |
|----------|---------|-------|
| **CI** | PR + push to main | Lint → Typecheck → Unit tests → Integration tests (PG+Redis) → npm audit → Trivy scan → Docker build + push |
| **CD Staging** | CI passes on main | AWS credentials → kubectl set image → rollout wait → smoke test (auto-rollback on failure) |
| **CD Production** | Manual dispatch | Canary (10% → validate → 100%) or Blue-green; post-deploy verification |

---

## 10. Scalability & Reliability

### Horizontal Scaling

| Component | Strategy | Target |
|-----------|----------|--------|
| API | Stateless pods + HPA | 10,000 req/s |
| Tracking | Socket.IO + Redis adapter | 50,000 concurrent WebSocket connections |
| Workers | BullMQ concurrency tuning | 1,000 jobs/min per worker |
| PostgreSQL | Read replicas + connection pooling | 200 max connections |
| Redis | Cluster mode for >256GB data | Sub-ms reads |
| Kafka | 6 partitions per topic | 100,000 events/s |

### Resilience Patterns

- **Circuit Breaker**: `src/shared/circuit-breaker.ts` — CLOSED→OPEN→HALF_OPEN with configurable thresholds (5 failures → 30s open → 2 successes to close)
- **Retry with backoff**: Exponential backoff + jitter; max 3 retries; no retry on 4xx
- **Graceful shutdown**: SIGTERM → stop accepting → drain connections → close pools → exit
- **Rate limiting**: Redis sliding-window, fail-open on Redis failure
- **Idempotency**: Kafka idempotent producer; payment idempotency keys; Bull job ID dedup

### Observability

- **Metrics**: 20+ Prometheus counters/histograms/gauges (HTTP, business, GPS, payments, queues, circuit breaker, DB pool)
- **Dashboards**: Grafana JSON with request rate, error rate, P50/P95/P99 latency, WebSocket connections, GPS throughput, payment volume, queue depth, circuit breaker state
- **Alerts**: Service down, high error rate (>5%), high P99 (>2s), matching stalled, payment failures (>10%), GPS ingestion drop, circuit breaker open, queue depth >1k, DB pool exhausted, Redis >90% memory, Kafka lag >10k, disk <15%
- **Logging**: Pino structured JSON with request correlation IDs
- **Data lifecycle**: Elasticsearch ILM — hot (1d rollover) → warm (3d, merge) → cold (30d) → delete (90d)

---

## 11. Testing Strategy

### Test Pyramid

| Level | Framework | Coverage Target | What's Tested |
|-------|-----------|----------------|---------------|
| **Unit** | Jest + ts-jest (ESM) | 80% lines | Pricing engine, circuit breaker, auth service, rate limiter |
| **Integration** | Jest + real PG/Redis | Key flows | Load lifecycle (create→bid→accept→deliver), status state machine, RLS enforcement |
| **Load** | k6 | P95 <500ms @ 200 VUs | API throughput, price quote latency, search performance |
| **Security** | npm audit + Trivy | 0 CRITICAL/HIGH | Dependency vulnerabilities, container image scan |

### Running Tests

```bash
npm test                    # Unit tests
npm run test:integration    # Integration (requires PG + Redis)
npm run test:coverage       # Full coverage report
k6 run tests/load/api-load-test.js --vus 100 --duration 5m
```

---

## 12. Code Structure

```
d:\RabbitTech\Logistics\
│
├── schema.sql                          # PostgreSQL/PostGIS DDL (~2000 lines)
├── ARCHITECTURE.md                     # This document
├── package.json                        # Dependencies + scripts
├── tsconfig.json                       # TypeScript config
├── jest.config.ts                      # Jest multi-project config
├── docker-compose.yml                  # 11-service orchestration
├── .env.example                        # Environment template
├── .gitignore
│
├── src/
│   ├── shared/                         # Cross-service infrastructure
│   │   ├── types.ts                    # Domain types mirroring PG ENUMs
│   │   ├── config.ts                   # Centralized env config
│   │   ├── db.ts                       # PG pool + RLS session injection
│   │   ├── redis.ts                    # ioredis factory
│   │   ├── logger.ts                   # Pino structured logger
│   │   ├── kafka.ts                    # Kafka producer/consumer + domain events
│   │   ├── elasticsearch.ts            # ES client + load board search
│   │   ├── circuit-breaker.ts          # Circuit breaker + retry with backoff
│   │   └── metrics.ts                  # Prometheus counters/histograms/gauges
│   │
│   ├── api/                            # REST API Service
│   │   ├── server.ts                   # Express app + middleware + routes
│   │   ├── middleware/
│   │   │   ├── auth.ts                 # JWT authenticate + requireRole
│   │   │   ├── rate-limiter.ts         # Redis sliding-window rate limiter
│   │   │   └── metrics.ts             # Prometheus HTTP instrumentation
│   │   ├── services/
│   │   │   ├── auth.service.ts         # Registration, login, JWT/refresh tokens
│   │   │   ├── matching.service.ts     # PostGIS matching + scoring
│   │   │   ├── load-acceptance.service.ts  # SERIALIZABLE bid acceptance
│   │   │   ├── pod.service.ts          # S3 presigned URLs + ledger settlement
│   │   │   ├── pricing.service.ts      # Dynamic pricing engine
│   │   │   └── payment.service.ts      # Stripe escrow + settlement + payouts
│   │   └── routes/
│   │       ├── auth.routes.ts          # /auth/register, login, refresh, logout
│   │       ├── matching.routes.ts      # /loads/:id/match
│   │       ├── loads.routes.ts         # /loads CRUD + search
│   │       ├── pod.routes.ts           # /pod/presign, confirm
│   │       ├── pricing.routes.ts       # /pricing/quote
│   │       └── payments.routes.ts      # /payments/escrow, settle, webhook
│   │
│   ├── tracking/                       # Real-time GPS Service
│   │   ├── server.ts                   # Socket.IO + Redis adapter
│   │   └── services/
│   │       ├── gps-hot-store.ts        # Redis GEO pipeline
│   │       ├── batch-flush.ts          # COPY to telemetry_logs
│   │       └── offline-detection.ts    # Tiered alerting sweep
│   │
│   ├── workers/                        # Background Job Processors
│   │   ├── entry.ts                    # WORKER_TYPE dispatcher
│   │   ├── matching.worker.ts          # BullMQ matching jobs
│   │   ├── notification.worker.ts      # Email/SMS/Push/In-App
│   │   ├── analytics.worker.ts         # Kafka → ES + MV refresh
│   │   └── payment.worker.ts           # Scheduled carrier payouts
│   │
│   └── web/                            # Frontend Components
│       ├── hooks/useTrackingMap.ts      # Socket.IO + RAF animation hook
│       └── components/TrackingMapView.tsx  # Mapbox GL JS map
│
├── docker/
│   ├── Dockerfile.api                  # Multi-stage Node 20 Alpine
│   ├── Dockerfile.tracking
│   └── Dockerfile.worker
│
├── nginx/
│   └── nginx.conf                      # TLS 1.2+, WSS upgrade, rate limits
│
├── k8s/                                # Kubernetes Manifests
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   ├── service-accounts.yaml
│   ├── ingress.yaml                    # TLS + cert-manager
│   ├── network-policies.yaml           # Zero-trust microsegmentation
│   ├── pdb.yaml                        # Pod Disruption Budgets
│   ├── api/deployment.yaml             # Deployment + Service + HPA
│   ├── tracking/deployment.yaml
│   └── workers/deployment.yaml         # 4 worker deployments
│
├── .github/workflows/                  # CI/CD Pipelines
│   ├── ci.yaml                         # Lint→Test→Build→Scan→Push
│   ├── cd-staging.yaml                 # Auto-deploy on main
│   └── cd-production.yaml              # Manual canary/blue-green
│
├── observability/
│   ├── prometheus/
│   │   ├── prometheus.yaml             # Scrape config
│   │   └── alerts.yaml                 # Alert rules
│   ├── grafana/dashboards/
│   │   └── logistics-overview.json     # Production dashboard
│   └── elasticsearch/
│       └── ilm-policy.json             # Index lifecycle management
│
├── tests/
│   ├── unit/
│   │   ├── pricing.service.test.ts     # Pricing engine tests
│   │   ├── circuit-breaker.test.ts     # Circuit breaker + retry tests
│   │   ├── auth.service.test.ts        # Auth service tests
│   │   └── rate-limiter.test.ts        # Rate limiter tests
│   ├── integration/
│   │   └── load-lifecycle.test.ts      # Full load flow with real PG
│   └── load/
│       └── api-load-test.js            # k6 performance test
│
└── secrets/                            # (gitignored) Local dev secrets
    ├── db_password.txt
    ├── jwt_public.pem
    ├── jwt_private.pem
    └── stripe_secret_key.txt
```

---

## 13. Production Audit — Findings & Hardening

### Critical Fixes Applied

| # | Severity | Component | Issue | Fix |
|---|----------|-----------|-------|-----|
| 1 | **CRITICAL** | `db.ts` | `SET LOCAL` without `BEGIN` — RLS context never applied | `getClient()` now wraps in `BEGIN` before `SET LOCAL` |
| 2 | **CRITICAL** | `server.ts` | `express.json()` parsed webhook body — Stripe signature verification always failed | `express.raw()` registered for `/api/payments/webhook` BEFORE `express.json()` |
| 3 | **CRITICAL** | `payments.routes.ts` | Role names `'ADMIN'`/`'SHIPPER'` don't exist in UserRole enum — endpoints unreachable | Corrected to `'PLATFORM_ADMIN'`/`'SHIPPER_STAFF'`/`'ORG_ADMIN'` |
| 4 | **CRITICAL** | `analytics.worker.ts` | Called `createConsumer(string)` but API expects `createConsumer({groupId, topics, handler})` — crashes on startup | Rewrote to correct object-based API |
| 5 | **CRITICAL** | `analytics.worker.ts` | SQL references non-existent columns (`rate_cents`, `load_status`, `origin_point`) | Fixed to actual schema columns (`offered_rate_usd`, `status`, `pickup_location`) |
| 6 | **CRITICAL** | `payment.service.ts` | Stripe `capture()` inside `SERIALIZABLE` transaction — DB rollback after Stripe success = double-spend | Two-phase pattern: DB commit → Stripe capture → reconciliation on failure |
| 7 | **HIGH** | `payment.worker.ts` | BullMQ connection used `{ url: config.redisUrl }` (invalid IORedis option) | Changed to `createRedis('payment-worker')` |
| 8 | **HIGH** | `matching.service.ts` | Circular dependency: API imports `matchQueue` from worker module | Extracted queues to `shared/queues.ts` |
| 9 | **HIGH** | `metrics.ts` | Raw request paths in Prometheus labels (UUID per request = cardinality explosion → OOM) | `normalizeRoute()` collapses UUIDs/numbers to `:id` |
| 10 | **HIGH** | `gps-hot-store.ts` | `drainBatch()` used N×LPOP — crash between pops = data loss | Replaced with atomic `LRANGE` + `LTRIM` |
| 11 | **HIGH** | `gps-hot-store.ts` | No backpressure on GPS ingestion — unbounded Redis list → OOM | Added `LLEN` check with 500K ceiling + sampled warning logs |
| 12 | **HIGH** | `kafka.ts` | Consumer errors logged but messages silently committed — no DLQ | Added retry loop (3 attempts) → Dead Letter Queue (`{topic}.dlq`) |
| 13 | **HIGH** | `kafka.ts` | `shutdownKafka()` only disconnected producer, not consumers | Now tracks and disconnects all active consumers |
| 14 | **MEDIUM** | `types.ts` | Duplicate `JwtPayload` interface | Removed redundant definition |
| 15 | **MEDIUM** | `config.ts` | No validation of critical secrets at startup | Fail-fast in production when missing `jwtPublicKey`, `databaseUrl`, etc. |

### New Components Created

| File | Purpose |
|------|---------|
| `src/shared/queues.ts` | Centralized BullMQ queue definitions — breaks worker/service circular deps |
| `src/shared/tracing.ts` | OpenTelemetry distributed tracing bootstrap with auto-instrumentation |
| `tests/unit/payment-settlement.test.ts` | Tests for two-phase settlement pattern (Stripe capture after DB commit) |

### Schema Hardening (Section 18 in schema.sql)

| Addition | Rationale |
|----------|-----------|
| BRIN index on `status_audit_log(changed_at)` | 100-1000× smaller than B-tree for append-only time-series |
| BRIN index on `telemetry_logs(recorded_at)` | Efficient range scans on partitioned time-series data |
| GIN index on `loads(special_requirements)` | Enables `@>` / `&&` array containment queries for load board filtering |
| Partial index on `payments(released_at)` WHERE `status = 'RELEASED'` | Reconciliation worker quickly finds stuck payments |
| Partial index on `carrier_payouts(scheduled_at)` WHERE `status = 'SCHEDULED'` | Payout batch processing hot path |
| Database-level `statement_timeout = 30s` | Prevents runaway queries from holding locks indefinitely |
| Database-level `lock_timeout = 10s` | Fail-fast on lock contention instead of queueing |
| `fn_ensure_telemetry_partitions()` function | Automated monthly partition creation (call via pg_cron) |

### Payment Settlement — Two-Phase Pattern

```
Phase 1 (DB Transaction — SERIALIZABLE):
  BEGIN
  → SELECT FOR UPDATE (lock payment row)
  → INSERT carrier_payouts (schedule transfer)
  → UPDATE payments SET status = 'RELEASED'
  → INSERT ledger journal + entries (double-entry)
  COMMIT

Phase 2 (External — after commit):
  → stripe.paymentIntents.capture() 
  → On success: publish payment.settled event
  → On failure: log + return (reconciliation retries)

Reconciliation (every 10 minutes):
  → Find RELEASED payments > 5 min old
  → Check Stripe PI status
  → If 'requires_capture': retry capture
  → If 'canceled': mark FAILED for manual review
```

### Kafka Dead Letter Queue Flow

```
Message received
  → Attempt handler (up to 3 retries)
  → If all fail: publish to {topic}.dlq with error metadata
  → DLQ message includes: original-topic, error, timestamp, dlq-id
```
