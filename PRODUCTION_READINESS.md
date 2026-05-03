# RabbitTech Logistics — Production Readiness Report

> **Author:** SRE Team  
> **Date:** 2026-03-26  
> **Status:** CONDITIONAL GO — see Section 10  
> **Launch Window:** T-7 days

---

## Table of Contents

1. [Production Readiness Checklist](#step-1--production-readiness-checklist)
2. [Failure Injection (Chaos Testing)](#step-2--failure-injection-chaos-testing)
3. [Load & Stress Simulation](#step-3--load--stress-simulation)
4. [SLO, SLA, SLI Definitions](#step-4--slo-sla-sli-definitions)
5. [Incident Response Design](#step-5--incident-response-design)
6. [Deployment Execution Plan](#step-6--deployment-execution-plan)
7. [Data Integrity Verification](#step-7--data-integrity-verification)
8. [Final Security Verification](#step-8--final-security-verification)
9. [End-to-End Test Flows](#step-9--end-to-end-test-flows)
10. [Go-Live Decision](#step-10--go-live-decision)

---

# STEP 1 — Production Readiness Checklist

## Infrastructure Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 1.1 | PostgreSQL 16 + PostGIS 3.4 deployed | ✅ Ready | Docker & K8s manifests verified; shared_buffers=512MB, WAL level=replica |
| 1.2 | Redis 7.4 with AOF persistence | ✅ Ready | appendfsync everysec; **FIXED:** eviction policy changed from `allkeys-lru` to `volatile-lru` to protect BullMQ job data |
| 1.3 | Kafka 3.7 KRaft (no Zookeeper) | ✅ Ready | 6 partitions default, 168h retention, single-node (scale to 3-node for prod cluster) |
| 1.4 | Elasticsearch 8.16 | ✅ Ready | Single-node; ILM policy: hot(1d)→warm(3d)→cold(30d)→delete(90d) |
| 1.5 | Nginx reverse proxy with TLS | ✅ Ready | TLS 1.2+, rate limiting (60/5 rps), HSTS, security headers |
| 1.6 | PG max_connections sufficient | ✅ Ready | **FIXED:** Increased from 200 → 500 (3×API×30 + 2×tracking×30 + 4×workers×20 = 250 peak) |
| 1.7 | PG connection pooler (pgBouncer) | ❌ Not Ready | Recommended for 10M+ users; current pool of 500 is sufficient for launch |
| 1.8 | Multi-AZ database replication | ❌ Not Ready | Single-node PG; **MUST** deploy RDS Multi-AZ or Patroni cluster before launch |
| 1.9 | Redis Cluster/Sentinel | ❌ Not Ready | Single-node Redis; deploy Redis Sentinel (3-node) for HA |
| 1.10 | Kafka cluster (3+ brokers) | ❌ Not Ready | Single broker; replication_factor=1; **MUST** scale to 3 brokers, RF=3 |

## Service Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 2.1 | API: Health check (all deps) | ✅ Ready | **FIXED:** Now checks PG + Redis + Kafka + Elasticsearch (was DB-only) |
| 2.2 | API: Graceful shutdown | ✅ Ready | **FIXED:** 25s drain window (was 5s hardcoded), Redis/Kafka cleanup |
| 2.3 | Tracking: Socket.IO w/ Redis adapter | ✅ Ready | Multi-instance horizontal scaling via Redis pub/sub |
| 2.4 | Tracking: Graceful shutdown | ✅ Ready | **FIXED:** disconnectSockets→flush→close order; prevents data loss |
| 2.5 | Workers: All 4 types deployable | ✅ Ready | matching, notification, analytics, payment — all use entry.ts dispatcher |
| 2.6 | Workers: PDB + HPA | ✅ Ready | **FIXED:** Added PDB for matching/payment workers; HPA on queue depth |
| 2.7 | Workers: Minimum 2 replicas each | ✅ Ready | **FIXED:** analytics + payment upgraded from 1→2 replicas |
| 2.8 | OpenTelemetry tracing active | ✅ Ready | **FIXED:** `--import ./dist/shared/tracing.js` added to all Dockerfiles |
| 2.9 | Kafka publish with fallback | ✅ Ready | **FIXED:** Redis fallback buffer when Kafka is down (`kafka:fallback-buffer`) |
| 2.10 | DB pool backpressure | ✅ Ready | **FIXED:** query() rejects with 503 when >20 clients waiting |

## Database Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 3.1 | Schema deployed with migrations | ✅ Ready | `schema.sql` now has a tracked bootstrap plus versioned SQL runner via `db:bootstrap`, `db:migrate`, and `db:migrate:status` |
| 3.2 | RLS policies active | ✅ Ready | All tables have row-level security; org membership–scoped |
| 3.3 | Telemetry partitions (2026-2027) | ✅ Ready | Monthly partitions pre-created; `fn_ensure_telemetry_partitions()` for automation |
| 3.4 | BRIN indexes on time-series | ✅ Ready | status_audit_log + telemetry_logs BRIN indexes added |
| 3.5 | GIN index on special_requirements | ✅ Ready | Enables @>/&& array containment queries |
| 3.6 | Statement/lock timeouts | ✅ Ready | 30s statement, 10s lock, 60s idle-in-transaction |
| 3.7 | Backup strategy (PITR) | ❌ Not Ready | **MUST** configure WAL archiving + daily base backups (pg_basebackup or AWS RDS automated) |
| 3.8 | Read replicas | ❌ Not Ready | Not needed for launch; plan for 5M+ scale |

## Security Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 4.1 | JWT RS256 asymmetric signing | ✅ Ready | Public/private key pair, file-based secrets |
| 4.2 | Production secrets validation | ✅ Ready | Fail-fast on missing jwtKeys, databaseUrl, stripeKeys |
| 4.3 | Stripe webhook signature verification | ✅ Ready | express.raw() before express.json(); constructEvent with Buffer.isBuffer |
| 4.4 | Rate limiting (API + auth + webhook) | ✅ Ready | Sliding window via Redis ZSET; fail-open on Redis down |
| 4.5 | Helmet security headers | ✅ Ready | HSTS, X-Frame-Options, CSP via Nginx + helmet |
| 4.6 | Network policies (zero-trust) | ✅ Ready | K8s NetworkPolicy: default-deny, explicit allow-lists |
| 4.7 | Non-root containers | ✅ Ready | All Dockerfiles: user logistics:1001 |
| 4.8 | Secrets management | ❌ Not Ready | Repo now ships External Secrets manifests in `k8s/secrets.yaml`; cluster rollout plus AWS Secrets Manager population is still required before launch |
| 4.9 | JWT key rotation | ✅ Ready | `kid`-aware JWT signing/verification added with `JWT_PRIVATE_KEYS`, `JWT_PUBLIC_KEYS`, and `JWT_ACTIVE_KID`, while preserving legacy single-key fallback |

## Observability Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 5.1 | Prometheus metrics (20+ custom) | ✅ Ready | HTTP, business, GPS, queue, circuit breaker, DB pool metrics |
| 5.2 | Grafana dashboard (13 panels) | ✅ Ready | Throughput, errors, latency, GPS, payments, queues |
| 5.3 | Alert rules | ✅ Ready | **FIXED:** Added DLQ, backpressure, payment reconciliation, pod restart alerts |
| 5.4 | Structured logging (Pino) | ✅ Ready | JSON logs with service name, request ID |
| 5.5 | Distributed tracing (OTel) | ✅ Ready | Auto-instrumentation for HTTP, Express, PG, Redis, Kafka |
| 5.6 | Request correlation IDs | ✅ Ready | x-request-id header propagated through logs |
| 5.7 | ES index lifecycle management | ✅ Ready | 90-day retention with hot/warm/cold tiers |

## Deployment Readiness

| # | Item | Status | Details |
|---|------|--------|---------|
| 6.1 | CI pipeline (lint, test, scan, build) | ✅ Ready | GitHub Actions: eslint → jest → trivy → Docker build |
| 6.2 | CD staging (auto-deploy) | ✅ Ready | Auto-deploy on main merge; smoke test health endpoint |
| 6.3 | CD production (canary) | ✅ Ready | Manual trigger, 5-min canary, error rate check, auto-rollback |
| 6.4 | Rolling update (zero downtime) | ✅ Ready | maxSurge=1, maxUnavailable=0, preStop sleep 5 |
| 6.5 | Feature flags | ✅ Ready | Env-backed feature flags now support staged rollout for payments and real-time tracking via `FEATURE_FLAGS_JSON` and `FF_*` overrides |
| 6.6 | Database migration tool | ✅ Ready | Versioned SQL migration runner added in `scripts/run-migrations.mjs` for bootstrap, apply, and status flows |

---

# STEP 2 — Failure Injection (Chaos Testing)

## Scenario 1: Random Service Kill

| Aspect | Analysis |
|--------|----------|
| **Simulation** | `kubectl delete pod api-xxxxx --force` during active traffic |
| **What happens now** | K8s detects pod failure via liveness probe (15s period × 3 failures = 45s). SIGTERM triggers graceful shutdown: 5s preStop sleep → 25s drain window → cleanup. HPA maintains min 3 replicas. PDB ensures ≥2 API pods always available. |
| **Where it breaks** | In-flight requests during the 5s preStop-to-drain gap may receive connection reset if client doesn't retry. Long-running batch GPS uploads (up to 10K pings) may be interrupted. |
| **Fix applied** | ✅ API: 25s drain window (matches K8s terminationGracePeriodSeconds=30 minus preStop=5). ✅ Tracking: `io.disconnectSockets(true)` sends clean disconnect to clients, which triggers auto-reconnect in Socket.IO client. ✅ PDB ensures at least 1 tracking + 2 API pods survive during node drain. |
| **Final state** | **Resilient.** Traffic shifts to surviving pods within seconds via K8s Service load balancing. GPS clients auto-reconnect with exponential backoff. |

## Scenario 2: Kafka Lag Spike

| Aspect | Analysis |
|--------|----------|
| **Simulation** | Slow consumer (analytics worker OOM, GC pause) → lag grows to 50K+ offsets |
| **What happens now** | Analytics worker processes events from Kafka; if it falls behind, lag accumulates. Events are retained for 168h (7 days) so no data loss. Alert fires at 10K lag (warning), 50K lag (critical). |
| **Where it breaks** | Analytics dashboards become stale. If lag exceeds 168h retention, events are lost forever. Load-board ES index becomes inconsistent with PG. |
| **Fix applied** | ✅ DLQ: Failed messages go to `{topic}.dlq` after 3 retries instead of being silently lost. ✅ Worker HPA: Matching workers scale on queue depth → reduces processing backlog. ✅ Alert rule: `KafkaConsumerLagCritical` fires at 50K for immediate escalation. ✅ Analytics worker scaled to 2 replicas (was 1). |
| **Final state** | **Degraded but recoverable.** Stale dashboards for duration of lag. Workers auto-catch-up when capacity returns. No data loss within retention window. |

## Scenario 3: Database Failover

| Aspect | Analysis |
|--------|----------|
| **Simulation** | Primary PG crashes; standby promoted (in managed DB scenario) |
| **What happens now** | All DB connections drop. Pool emits error event, logged. New connections fail with ECONNREFUSED. API /health returns 503 (database check fails). K8s removes pod from service endpoints (readiness probe fails). |
| **Where it breaks** | All API requests fail for 30-60s during failover. In-flight transactions ROLLBACK. Payment settlements in Phase 1 (DB commit) roll back safely. Payments in Phase 2 (Stripe capture) continue — Stripe capture is idempotent. |
| **Fix applied** | ✅ DB pool backpressure: query() returns 503 immediately when >20 waiters (no cascading timeouts). ✅ 5s connectionTimeoutMillis prevents hung connections. ✅ statement_timeout=30s prevents runaway queries. ✅ Health check returns degraded fast → K8s stops routing traffic. |
| **Recovery** | Auto-reconnect via PG pool when new primary is available. Reconciliation worker catches any mid-settlement payments. |
| **Final state** | **30-60s downtime during failover.** Acceptable for ≤99.99% SLO (4.38 min/month allowed). |

## Scenario 4: Redis Eviction

| Aspect | Analysis |
|--------|----------|
| **Simulation** | Redis reaches maxmemory (384MB); LRU eviction begins |
| **What happens now** | **FIXED:** Changed from `allkeys-lru` to `volatile-lru`. Only keys with TTL are evicted. |
| **Where it breaks** | With `allkeys-lru` (old): BullMQ job metadata, GPS hot-store positions, rate limit keys — all evictable. Catastrophic. With `volatile-lru` (new): Only TTL-bearing keys (rate limit tokens, session cache) are evicted. Core data (GEO positions, ZSET last-seen, BullMQ jobs) has no TTL → protected. |
| **Remaining risk** | If no volatile keys exist to evict, Redis returns OOM errors on writes. GPS backpressure limit (500K pings × ~200 bytes = ~100MB) provides a ceiling. |
| **Fix applied** | ✅ Eviction policy: `volatile-lru`. ✅ GPS backpressure: 500K pending ceiling. ✅ Alert: RedisHighMemory fires at 90% utilization. |
| **Final state** | **Protected.** Core data survives eviction. Cache/rate-limit keys degrade gracefully. |

## Scenario 5: Payment Provider Failure (Stripe)

| Aspect | Analysis |
|--------|----------|
| **Simulation** | Stripe returns 500 errors for 30 minutes |
| **What happens now** | Escrow creation (createEscrow) fails → API returns 500 to shipper → load not accepted. Settlement Phase 2 (capture) fails → payment stays RELEASED in DB → reconciliation worker retries every 10 min. |
| **Where it breaks** | New load acceptance blocked during Stripe outage (no escrow = no assignment). User sees "Payment processing failed" error. |
| **Fix applied** | ✅ Two-phase settlement: DB commit happens FIRST, Stripe capture is external + retried. ✅ Reconciliation worker: Detects stuck RELEASED payments, retries Stripe capture. ✅ Stripe capture is idempotent (same PaymentIntent ID). ✅ Kafka publish fallback: Payment events buffered in Redis if Kafka also fails. |
| **Remaining gap** | New escrow creation still fails during Stripe outage. This is intentional — we don't want to accept loads if we can't guarantee payment. |
| **Final state** | **Gracefully degraded.** Existing settlements complete eventually. New assignments blocked (correct behavior). |

## Scenario 6: Region Outage

| Aspect | Analysis |
|--------|----------|
| **Simulation** | Entire us-east-1 AZ goes down |
| **What happens now** | K8s topologySpreadConstraints (API deployment) spread pods across AZs. If 1 of 3 AZs fails, ~33% of pods die. HPA scales remaining pods up. PDB prevents simultaneous eviction. |
| **Where it breaks** | If database is in the failed AZ (single-node), total outage until failover. GPS reconnect storm overloads surviving tracking pods. |
| **Pre-launch requirement** | Deploy PG on RDS Multi-AZ (automatic failover <60s). Deploy Redis with Sentinel across AZs. Kafka 3-broker cluster across AZs. |
| **Final state** | **Not ready for region outage.** Requires multi-AZ data tier (see Section 10 launch conditions). |

---

# STEP 3 — Load & Stress Simulation

## Capacity Model

### 1M Users (Launch Target)

| Metric | Value | Calculation |
|--------|-------|-------------|
| Active users (peak) | 50K concurrent | 5% of 1M |
| API requests/sec | 2,500 rps | 50K users × 3 req/min ÷ 60 |
| GPS pings/sec | 5,000 pps | 15K active trucks × 1 ping/3s |
| Kafka events/sec | 500 eps | Load + bid + assignment + payment events |
| PG queries/sec | 7,500 qps | ~3 queries per API request |
| DB connections needed | 90 | 3 API × 30 pool |

**Bottleneck analysis:**
- API: 3 pods × ~1000 rps each = 3,000 rps capacity. ✅ Sufficient at 2,500 rps (83% utilization).
- PG: shared_buffers=512MB handles 7,500 qps for indexed queries. ✅
- Redis: Single instance handles 100K+ ops/sec. ✅
- Tracking: 2 pods × 10K concurrent WebSocket connections each = 20K. ✅ with 15K trucks.

### 5M Users

| Metric | Value | Bottleneck |
|--------|-------|------------|
| API rps | 12,500 | HPA scales to 13 API pods (1000 rps each) |
| GPS pps | 25,000 | Scale tracking to 5 pods |
| PG qps | 37,500 | ❌ **Needs read replicas** for search queries |
| DB connections | 450/500 | ⚠️ Near limit; **need pgBouncer** |

### 10M Users

| Metric | Value | Bottleneck |
|--------|-------|------------|
| API rps | 25,000 | HPA scales to 20 API pods (max) → need to increase HPA max |
| GPS pps | 50,000 | Scale tracking to 10 pods + dedicated Redis cluster |
| PG qps | 75,000 | ❌ **Must shard or use read replicas + connection pooler** |
| Kafka partitions | ❌ | Need 12+ partitions per topic for parallel consumption |

## Expected Latency

| Endpoint | P50 | P95 | P99 | Threshold |
|----------|-----|-----|-----|-----------|
| GET /health | 2ms | 5ms | 10ms | 50ms |
| POST /auth/login | 150ms | 300ms | 500ms | 1s |
| GET /loads (search) | 30ms | 80ms | 200ms | 500ms |
| POST /loads/:id/match | 50ms | 150ms | 400ms | 1s |
| POST /payments/create-escrow | 800ms | 1.5s | 2.5s | 3s (Stripe latency) |
| WebSocket gps:ping | 5ms | 15ms | 30ms | 100ms |
| GPS batch flush (500 pings) | 50ms | 100ms | 200ms | 500ms |

## Optimizations Applied

1. **DB pool backpressure** — Reject with 503 when pool is saturated (prevents cascading timeouts)
2. **BRIN indexes on time-series** — 100-1000× smaller than B-tree for range scans
3. **GIN index on special_requirements** — O(1) array containment vs O(n) sequential scan
4. **Metrics route normalization** — Prevents Prometheus OOM from high-cardinality labels
5. **GPS backpressure** — 500K pending limit prevents Redis OOM
6. **Atomic batch drain** — LRANGE+LTRIM replaces N×LPOP (no data loss on crash)
7. **Kafka idempotent producer** — Prevents duplicate events under network retries

---

# STEP 4 — SLO, SLA, SLI Definitions

## Service Level Indicators (SLIs)

| SLI | Definition | Measurement |
|-----|------------|-------------|
| **Availability** | Percentage of successful (non-5xx) HTTP responses | `1 - (sum(rate(http_5xx[5m])) / sum(rate(http_total[5m])))` |
| **API Latency** | P99 response time for non-health endpoints | `histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])) by (le))` |
| **GPS Ingestion Rate** | Pings ingested per second | `rate(logistics_gps_pings_ingested_total[5m])` |
| **Payment Success Rate** | Percentage of payments completing settlement | `1 - (payments_failed / payments_total)` |
| **Matching Latency** | Time from load posted to first match result | `histogram_quantile(0.95, matching_duration_bucket)` |
| **Data Freshness** | Kafka consumer lag (seconds behind real-time) | `kafka_consumergroup_lag_sum / rate(kafka_topic_messages_total[5m])` |

## Service Level Objectives (SLOs)

| Service | SLO | Error Budget (30 days) |
|---------|-----|------------------------|
| **API Availability** | 99.95% | 21.6 min/month |
| **API P99 Latency** | < 500ms (non-payment endpoints) | 0.05% of requests may exceed |
| **GPS Ingestion Availability** | 99.9% | 43.2 min/month |
| **Payment Settlement Success** | 99.99% | 4.38 min/month |
| **Matching Engine Response** | P95 < 2s | 5% may exceed |
| **Data Freshness (Kafka lag)** | < 30s behind real-time | 99% of time |

## SLA (External Commitments)

| Metric | SLA | Penalty |
|--------|-----|---------|
| Platform Availability | 99.9% (8.76 hr/year downtime) | Service credit 10% per 0.1% below |
| Payment Processing | 99.95% success rate | Manual reconciliation + credit |
| GPS Tracking Uptime | 99.5% | Reduced tier pricing |

## Error Budget Policies

| Budget Consumed | Action |
|-----------------|--------|
| < 50% | Normal development velocity |
| 50-75% | Halt non-critical deployments; focus on reliability |
| 75-90% | Feature freeze; all hands on reliability |
| > 90% | Incident review required; deploy only critical fixes |

## Alert Mapping

| SLO Breach | Alert | Severity | Response |
|------------|-------|----------|----------|
| Availability < 99.95% (5m window) | HighErrorRate | Critical | Page on-call SRE |
| P99 > 2s | HighLatencyP99 | Warning | Investigate slow queries |
| Payment failures > 10% | PaymentProcessingFailures | Critical | Page on-call + payments team |
| Kafka lag > 10K | KafkaConsumerLag | Warning | Scale consumers |
| Kafka lag > 50K | KafkaConsumerLagCritical | Critical | Page on-call SRE |
| DB pool waiting > 20 | DatabaseConnectionPoolExhausted | Critical | Scale API pods / check slow queries |
| GPS batch > 400K | GPSBatchBackpressure | Warning | Scale tracking pods |

---

# STEP 5 — Incident Response Design

## Runbook 1: Service Outage

### Detection
- Alert: `ServiceDown` (up == 0 for 2 min)
- Alert: `HighErrorRate` (5xx > 5% for 5 min)
- PagerDuty page to on-call SRE

### Triage (< 5 min)
```bash
# 1. Check pod status
kubectl get pods -n logistics -o wide

# 2. Check recent events
kubectl get events -n logistics --sort-by='.lastTimestamp' | tail -20

# 3. Check logs for crash reason
kubectl logs -n logistics deployment/api --tail=100 --previous

# 4. Check health endpoint directly
kubectl exec -n logistics deploy/api -- wget -qO- http://localhost:3000/health
```

### Mitigation
| Root Cause | Action |
|------------|--------|
| OOM Kill | Increase memory limits; check for memory leaks; `kubectl describe pod` to confirm |
| CrashLoopBackOff | Check logs for startup error; likely missing secret or DB unreachable |
| Deployment rollout failure | `kubectl rollout undo deployment/api -n logistics` |
| Node failure | K8s auto-rescheduling; verify PDB not blocking |
| All pods healthy but 5xx | Check DB connection pool exhaustion; check Redis connectivity |

### Recovery Verification
```bash
# Verify all pods running
kubectl get pods -n logistics | grep -v Running

# Verify health
for pod in $(kubectl get pods -n logistics -l app=api -o name); do
  kubectl exec -n logistics $pod -- wget -qO- http://localhost:3000/health
done

# Verify error rate returning to normal
# Check Grafana: logistics_http_request_total{status_code=~"5.."}
```

## Runbook 2: Payment Failure

### Detection
- Alert: `PaymentProcessingFailures` (>10% failure rate for 5 min)
- Alert: `PaymentReconciliationStuck` (RELEASED payments accumulating)

### Triage (< 3 min)
```bash
# 1. Check Stripe status page: https://status.stripe.com/

# 2. Check stuck payments in DB
psql -c "SELECT status, COUNT(*) FROM logistics.payments 
         WHERE updated_at > NOW() - INTERVAL '1 hour' 
         GROUP BY status ORDER BY count DESC"

# 3. Check payment worker logs
kubectl logs -n logistics deployment/worker-payment --tail=50

# 4. Check reconciliation job last run
kubectl logs -n logistics deployment/worker-payment --tail=200 | grep reconcil
```

### Mitigation
| Root Cause | Action |
|------------|--------|
| Stripe outage | Wait; reconciliation worker retries every 10 min. Communicate to support team. |
| RELEASED payments stuck | Manually trigger reconciliation: bump BullMQ scheduler |
| Escrow creation failing | Check API logs for Stripe error codes. If card_declined, user issue. If rate_limit, backoff. |
| Ledger imbalance | Run ledger verification query (see Data Integrity section) |

### Recovery Verification
```sql
-- Verify no stuck payments
SELECT COUNT(*) FROM logistics.payments 
WHERE status = 'RELEASED' 
AND released_at < NOW() - INTERVAL '15 minutes';
-- Expected: 0

-- Verify ledger balance
SELECT 
  SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) as total_debits,
  SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as total_credits
FROM logistics.ledger_entries;
-- Expected: total_debits = total_credits
```

## Runbook 3: Data Inconsistency

### Detection
- Ledger imbalance alert (debit ≠ credit per journal)
- Kafka DLQ messages accumulating
- Customer reports: "payment deducted but load not assigned"

### Triage
```sql
-- 1. Check for unbalanced journals
SELECT j.id, j.description,
  SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as debits,
  SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as credits
FROM logistics.ledger_journals j
JOIN logistics.ledger_entries e ON e.journal_id = j.id
GROUP BY j.id, j.description
HAVING SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END)
    != SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END);

-- 2. Check for orphaned assignments (loaded but no payment)
SELECT a.id, a.status, p.id as payment_id
FROM logistics.assignments a
LEFT JOIN logistics.payments p ON p.id = a.payment_id
WHERE a.status IN ('IN_TRANSIT', 'DELIVERED') AND p.id IS NULL;

-- 3. Check DLQ for failed events
# kafka-console-consumer --bootstrap-server kafka:9092 --topic logistics.payment.events.dlq --from-beginning --max-messages 10
```

### Mitigation
- **Ledger imbalance:** Create correcting journal entry (manual approval required by finance team)
- **Orphaned assignment:** Investigate status_audit_log for the assignment to trace what happened
- **DLQ events:** Replay after fixing root cause: re-publish from DLQ topic to main topic

## Escalation Paths

| Severity | Response Time | Responder | Communication |
|----------|---------------|-----------|---------------|
| P0 (total outage) | < 5 min | SRE on-call → Eng Director → CEO | PagerDuty → Slack #incidents → Status page |
| P1 (partial outage / payment) | < 15 min | SRE on-call → Backend lead | PagerDuty → Slack #incidents |
| P2 (degraded performance) | < 1 hour | SRE on-call | Slack #alerts |
| P3 (non-customer-facing) | < 4 hours | Assigned engineer | Jira ticket |

## On-Call Strategy

| Role | Schedule | Responsibilities |
|------|----------|-----------------|
| Primary SRE | 1-week rotation | First responder for all alerts; triage + mitigate |
| Secondary SRE | 1-week rotation (offset) | Backup if primary unavailable within 10 min |
| Backend Engineer on-call | 1-week rotation | Escalation for code-level issues (payment, matching) |
| Database on-call | As needed | PG failover, replication issues, query optimization |

---

# STEP 6 — Deployment Execution Plan

## Day -7 to Day -1: Pre-Launch

### Day -7: Infrastructure Provisioning

```
1. AWS Account Setup
   ├── VPC: logistics-prod (3 AZs: us-east-1a/b/c)
   ├── EKS Cluster: logistics-prod (v1.29, managed node groups)
   │   ├── Node Group: general (m6i.2xlarge × 3, one per AZ)
   │   ├── Node Group: workers (m6i.xlarge × 2, auto-scaling 2-6)
   │   └── Cluster Autoscaler enabled
   ├── RDS PostgreSQL 16: Multi-AZ, db.r6g.xlarge, 500GB gp3
   │   ├── Automated backups: 7-day retention, PITR
   │   └── PostGIS extension enabled
   ├── ElastiCache Redis: r6g.large, 2 replicas, Multi-AZ
   ├── MSK (Kafka): kafka.m5.large × 3, RF=3, 6 partitions
   ├── Elasticsearch: OpenSearch r6g.large.search × 2
   ├── S3: rabbittech-logistics-pod (POD photos), versioning enabled
   ├── CloudWatch Logs: /rabbittech/logistics/*
   └── Route53: api.rabbittech.io, tracking.rabbittech.io
```

### Day -6: Secret Management

```
2. HashiCorp Vault / AWS Secrets Manager
   ├── Generate JWT RS256 key pair (4096-bit)
   ├── Create Stripe production API key
   ├── Create PostgreSQL service account password (32-char random)
   ├── Create Elasticsearch API key (read-write)
   ├── Configure K8s External Secrets Operator
   └── Verify all secrets mounted in test namespace
```

### Day -5: Database Migration

```
3. Database Setup
   ├── Connect to RDS instance
   ├── Execute schema.sql (all 18 sections)
   ├── Verify all tables created: SELECT count(*) FROM information_schema.tables WHERE table_schema='logistics'
   ├── Verify all functions: SELECT routine_name FROM information_schema.routines WHERE specific_schema='logistics'
   ├── Run fn_ensure_telemetry_partitions(6) — create 6 months of partitions
   ├── Verify indexes: SELECT indexname FROM pg_indexes WHERE schemaname='logistics'
   ├── Create monitoring role (read-only for Grafana)
   └── Validate RLS: SET app.current_user_id = '<test>'; SELECT * FROM logistics.loads; -- should return 0 rows
```

### Day -4: Service Deployment (Staging)

```
4. Deploy to staging namespace
   ├── kubectl apply -f k8s/namespace.yaml
   ├── kubectl apply -f k8s/configmap.yaml (staging values)
   ├── kubectl apply -f k8s/secrets.yaml (via External Secrets Operator)
   ├── kubectl apply -f k8s/service-accounts.yaml
   ├── kubectl apply -f k8s/network-policies.yaml
   ├── kubectl apply -f k8s/api/deployment.yaml
   ├── kubectl apply -f k8s/tracking/deployment.yaml
   ├── kubectl apply -f k8s/workers/deployment.yaml
   ├── kubectl apply -f k8s/pdb.yaml
   ├── kubectl apply -f k8s/ingress.yaml
   └── Verify: all pods Running, health checks passing
```

### Day -3: Integration Testing in Staging

```
5. Run full E2E test suite against staging
   ├── npm run test:integration
   ├── Run k6 load test (100 VUs, 5 min)
   ├── Verify GPS tracking WebSocket connection
   ├── Verify Stripe webhook delivery (test mode)
   ├── Verify Kafka event flow end-to-end
   ├── Verify Elasticsearch search results
   └── Run chaos: kubectl delete pod api-xxx (verify auto-recovery)
```

### Day -2: Observability Setup

```
6. Deploy monitoring stack
   ├── Prometheus (kube-prometheus-stack Helm chart)
   ├── Import alert rules: kubectl apply -f observability/prometheus/alerts.yaml
   ├── Grafana: Import logistics-overview.json dashboard
   ├── Configure PagerDuty integration for critical alerts
   ├── Verify all metrics endpoints scraped (/metrics)
   ├── Test alert pipeline: manually trigger HighErrorRate → verify PagerDuty page
   └── Configure Elasticsearch ILM policy
```

### Day -1: Final Validation

```
7. Go/No-Go checklist
   ├── All pods healthy (3 api, 2 tracking, 2×4 workers)
   ├── Health checks passing for all services
   ├── Prometheus scraping all targets
   ├── All alert rules loaded
   ├── PagerDuty paging confirmed
   ├── Database backup verified (restore test)
   ├── DNS records pointing to ingress
   ├── TLS certificates valid (Let's Encrypt)
   ├── Stripe webhook endpoint registered (production mode)
   └── On-call schedule confirmed for launch week
```

## Launch Day: Canary Release

### Service Deployment Order

```
1. Database (already running — schema applied Day -5)
2. Redis (ElastiCache — already running)
3. Kafka (MSK — already running)
4. Elasticsearch (OpenSearch — already running)
5. Workers (matching → notification → analytics → payment)
6. Tracking (Socket.IO + GPS)
7. API (Express — last, because it accepts user traffic)
8. Nginx/Ingress (enable traffic routing)
```

### Canary Strategy

```
Phase 1 (T+0h): 10% traffic → canary API pod
  └── Monitor for 30 min: error rate, latency, logs
  └── Go/No-Go decision

Phase 2 (T+1h): 25% traffic
  └── Monitor for 30 min
  └── Verify payment flow with test accounts

Phase 3 (T+2h): 50% traffic
  └── Monitor for 1 hour
  └── Verify GPS tracking at scale

Phase 4 (T+4h): 100% traffic
  └── Continue monitoring for 24 hours
```

### Rollback Strategy

```
Automatic (within 5 min):
  └── If canary error rate > 5%: auto-rollback via cd-production.yaml
  └── kubectl rollout undo deployment/api -n logistics

Manual:
  └── kubectl rollout undo deployment/api -n logistics
  └── kubectl rollout undo deployment/tracking -n logistics
  └── kubectl rollout undo deployment/worker-matching -n logistics
  └── kubectl rollout undo deployment/worker-payment -n logistics

Database rollback:
  └── Schema changes are additive only (new columns, new tables)
  └── Destructive changes (DROP, ALTER COLUMN TYPE) require separate migration with rollback script
  └── Point-in-Time Recovery available via RDS (up to 7 days)
```

---

# STEP 7 — Data Integrity Verification

## Event Delivery Guarantees

| Component | Guarantee | Mechanism |
|-----------|-----------|-----------|
| Kafka Producer | At-least-once | Idempotent producer (`idempotent: true`, `maxInFlightRequests: 5`) |
| Kafka Consumer | At-least-once | Auto-commit after handler success; DLQ on failure |
| Kafka Fallback | Best-effort | Redis `kafka:fallback-buffer` when Kafka is down |
| GPS Batch Flush | At-least-once | LRANGE+LTRIM atomic drain; if COPY fails, pings stay in Redis |
| Payment Settlement | Exactly-once (DB) + At-least-once (Stripe) | Two-phase: DB commit first, Stripe capture idempotent on PaymentIntent ID |

## Idempotency Matrix

| Operation | Idempotency Key | Safe to Retry? |
|-----------|-----------------|----------------|
| Create Escrow | `escrow:{loadId}:{carrierId}` | ✅ Stripe idempotency key |
| Settle Payment | PaymentIntent ID (Stripe ensures single capture) | ✅ |
| Kafka Event Publish | `eventId` (UUID) | ✅ Idempotent producer |
| GPS Ping Store | `(truckId, recorded_at)` tuple | ✅ UPSERT in PG via COPY |
| Ledger Journal Entry | `idempotency_key` column (UNIQUE) | ✅ DB constraint prevents duplicates |
| BullMQ Job | `jobId` | ✅ BullMQ deduplicates by ID |

## Kafka Replay Capability

```bash
# Reset consumer group to specific offset (replay from a point in time)
kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --group analytics-consumer \
  --topic logistics.load.events \
  --reset-offsets \
  --to-datetime 2026-03-25T00:00:00.000 \
  --execute

# Reset to beginning (full replay)
kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --group analytics-consumer \
  --reset-offsets \
  --to-earliest \
  --execute
```

Retention: 168 hours (7 days). For longer replay, configure S3 tiered storage.

## Audit Trail Completeness

| Entity | Audit Mechanism | Verified |
|--------|-----------------|----------|
| Load status changes | `status_audit_log` via trigger | ✅ Trigger on loads.status UPDATE |
| Bid status changes | `status_audit_log` via trigger | ✅ Trigger on bids.status UPDATE |
| Assignment status | `status_audit_log` via trigger | ✅ |
| Payment status | `status_audit_log` via trigger | ✅ Includes RELEASED → captured transition |
| Truck status | `status_audit_log` via trigger | ✅ |
| User login attempts | Redis counter + log | ✅ Rate-limited with lockout |
| API requests | Pino structured logs + x-request-id | ✅ Correlation IDs |
| GPS telemetry | telemetry_logs (PG partitioned) + Redis hot-store | ✅ Dual storage |

## Ledger Verification Queries

```sql
-- 1. Check all journals balance (debits = credits)
SELECT COUNT(*) as unbalanced_journals
FROM (
  SELECT journal_id,
    SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) as debits,
    SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as credits
  FROM logistics.ledger_entries
  GROUP BY journal_id
  HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END)
      != SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END)
) unbalanced;
-- Expected: 0

-- 2. Check for orphan ledger entries (no journal)
SELECT COUNT(*) FROM logistics.ledger_entries e
LEFT JOIN logistics.ledger_journals j ON j.id = e.journal_id
WHERE j.id IS NULL;
-- Expected: 0

-- 3. Check for duplicate idempotency keys
SELECT idempotency_key, COUNT(*)
FROM logistics.ledger_journals
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

# STEP 8 — Final Security Verification

## Attack Simulation Results

### 1. Injection Attacks

| Vector | Protection | Status |
|--------|------------|--------|
| SQL Injection | Parameterized queries (`$1`, `$2`) everywhere; no string concatenation | ✅ Verified |
| XSS | Helmet CSP headers; JSON-only API (no HTML rendering) | ✅ |
| Command Injection | No shell exec; no `eval`; no user input in system calls | ✅ |
| NoSQL Injection (ES) | Elasticsearch queries built with typed objects, not string interpolation | ✅ |
| WebSocket data injection | Zod schema validation on all Socket.IO payloads | ✅ |

### 2. API Abuse

| Attack | Protection | Status |
|--------|------------|--------|
| Brute-force login | Rate limit: 10 attempts → 15-min lockout (Redis counter) | ✅ |
| API flood | nginx: 60 req/s per IP; Express: sliding window per user | ✅ |
| Webhook replay | Stripe signature verification + timestamp tolerance (300s) | ✅ |
| JWT token theft | 15-min access token; httpOnly refresh cookie; RS256 asymmetric | ✅ |
| Session fixation | Refresh token rotation on use | ✅ |
| CORS bypass | Production: explicit origin whitelist; no wildcard | ✅ |

### 3. Fraud Attempts

| Vector | Protection | Status |
|--------|------------|--------|
| Double-spend on settlement | SERIALIZABLE transaction + SELECT FOR UPDATE + two-phase pattern | ✅ |
| Bid manipulation | `UNIQUE(load_id, carrier_org_id)` — one bid per carrier per load | ✅ |
| Fake GPS location | Server-side rate limit (3s minimum); accuracy_m field for client trust scoring | ⚠️ Partial |
| Unauthorized load access | RLS policies restrict to org membership | ✅ |
| Escalation of privilege | JWT role claim verified per-request; role checked in route middleware | ✅ |
| Payment to wrong carrier | carrier_org_id in payment matches assignment FK chain | ✅ |

### 4. Remaining Exploit Paths

| Risk | Severity | Mitigation Required |
|------|----------|---------------------|
| No email verification on registration | Medium | Add email verification flow before allowing load posting |
| No 2FA for admin accounts | Medium | Implement TOTP for PLATFORM_ADMIN and ORG_ADMIN roles |
| JWT key rotation not automated | Low | Implement JWKS endpoint with key ID rotation |
| Stripe webhook endpoint publicly enumerable | Low | Add IP allowlist for Stripe webhook IPs |

---

# STEP 9 — End-to-End Test Flows

## Flow 1: Happy Path — Load Lifecycle

```
Step 1: Shipper registers + creates org
  POST /auth/register → 201 { userId }
  POST /orgs → 201 { orgId }  (if this endpoint exists)

Step 2: Shipper posts load
  POST /loads → 201 { loadId, status: "DRAFT" }
  PATCH /loads/:loadId → 200 { status: "POSTED" }
  → Kafka: logistics.load.events { eventType: "load.posted" }
  → Elasticsearch: load indexed in logistics-loads

Step 3: Carrier bids on load
  POST /loads/:loadId/bids → 201 { bidId, status: "PENDING" }
  → Kafka: logistics.bid.events { eventType: "bid.created" }
  → Notification: shipper receives "New bid on your load"

Step 4: Shipper accepts bid → assignment created
  POST /loads/:loadId/accept → 200 { assignmentId }
  → Status: DRAFT → POSTED → BIDDING → CONFIRMED
  → Kafka: logistics.assignment.events { eventType: "assignment.created" }

Step 5: Payment escrow created
  POST /payments/escrow → 201 { paymentId, stripePaymentIntentId }
  → Stripe: PaymentIntent (manual capture) created
  → Ledger: escrow journal entry (debit shipper AP, credit escrow)

Step 6: Driver starts trip → GPS tracking begins
  WebSocket: gps:ping { truckId, lat, lng, speed_kmh }
  → Redis: GEO position updated, ZSET last-seen, batch list
  → Status: CONFIRMED → IN_TRANSIT

Step 7: Driver delivers → POD uploaded
  POST /pod/:assignmentId/upload → 200
  → S3: photo uploaded with presigned URL
  → Status: IN_TRANSIT → DELIVERED

Step 8: Payment settlement
  POST /payments/:paymentId/settle → 200
  → Phase 1: DB transaction (ledger entries, carrier payout schedule, status=RELEASED)
  → Phase 2: Stripe PaymentIntent.capture()
  → Kafka: logistics.payment.events { eventType: "payment.settled" }

Step 9: Carrier payout (scheduled)
  → Payment worker processes scheduled payouts every 2 hours
  → Stripe Transfer to carrier's bank account
```

**Verification Points:**
- [ ] Load appears in Elasticsearch search results after posting
- [ ] GPS positions visible on tracking dashboard via WebSocket
- [ ] Ledger debits = credits for all journals
- [ ] status_audit_log has complete chain: DRAFT → POSTED → BIDDING → CONFIRMED → IN_TRANSIT → DELIVERED
- [ ] Carrier payout scheduled for T+2 days

## Flow 2: Cancellation

```
Step 1: Load posted, bid accepted, assignment created
Step 2: Shipper cancels before pickup
  POST /loads/:loadId/cancel → 200
  → Status: CONFIRMED → CANCELLED
  → Payment: Stripe PaymentIntent.cancel() (refund auth hold)
  → Kafka: logistics.load.events { eventType: "load.cancelled" }
  → Notification: carrier notified of cancellation
```

**Verification Points:**
- [ ] Stripe PaymentIntent status: "canceled" (not "succeeded")
- [ ] No ledger settlement entries created
- [ ] Load removed from Elasticsearch index
- [ ] Assignment status: CANCELLED

## Flow 3: Failure + Retry

```
Step 1: Settlement Phase 2 fails (Stripe down)
  → Phase 1 committed: status=RELEASED, ledger entries created
  → Phase 2 fails: Stripe returns 500
  → Log: "Stripe capture failed after DB commit — reconciliation will retry"

Step 2: Reconciliation worker picks it up (within 10 min)
  → Query: SELECT payments WHERE status='RELEASED' AND released_at < NOW()-5min
  → Stripe: paymentIntents.retrieve() → status: "requires_capture"
  → Stripe: paymentIntents.capture() → succeeds
  → Log: "Reconciler captured stale PaymentIntent"

Step 3: Kafka publish fails (broker down)
  → publishEvent throws → caught by fallback
  → Redis: rpush('kafka:fallback-buffer', event)
  → When Kafka recovers: drain fallback buffer and re-publish
```

**Verification Points:**
- [ ] Payment eventually settles (within 10 min)
- [ ] No money lost — Stripe capture is idempotent
- [ ] Kafka events eventually delivered from fallback buffer
- [ ] status_audit_log shows complete chain even with retries

---

# STEP 10 — Go-Live Decision

## ❌ Reasons NOT to Launch (Blockers)

| # | Blocker | Risk | Required Action | Effort |
|---|---------|------|-----------------|--------|
| 1 | **Single-node PostgreSQL** | Total data loss on disk failure; 30-60s downtime on crash | Deploy RDS Multi-AZ (automatic failover) | 2 hours (Terraform) |
| 2 | **Single-node Redis** | Loss of GPS hot-store, BullMQ jobs, rate limit state | Deploy ElastiCache with Sentinel (3-node) | 2 hours |
| 3 | **Single Kafka broker (RF=1)** | Single broker crash = total event loss | Deploy MSK 3-broker cluster, RF=3 | 3 hours |
| 4 | **No automated database backups** | Unrecoverable data loss | Configure RDS automated backups + PITR | 1 hour |
| 5 | **No secrets management** | Repo-side manifests are ready, but cluster still needs External Secrets Operator + populated AWS Secrets Manager values | Deploy External Secrets Operator + AWS Secrets Manager | 4 hours |

## ✅ Conditions Required to Launch Safely

| # | Condition | Status |
|---|-----------|--------|
| 1 | Multi-AZ PostgreSQL with automatic failover | Required before launch |
| 2 | Redis Sentinel (3-node, Multi-AZ) | Required before launch |
| 3 | Kafka 3-broker cluster with RF=3 | Required before launch |
| 4 | Automated DB backups with PITR (7-day retention) | Required before launch |
| 5 | External Secrets Operator or Vault integration | Required before launch; repo manifests now available in `k8s/secrets.yaml` |
| 6 | All 11 Prometheus alert rules active + PagerDuty integration | Required before launch |
| 7 | On-call rotation staffed for launch week | Required before launch |
| 8 | k6 load test passing at 2× expected launch traffic | Required before launch; scenario scaffold now available in `load/k6/launch-2x.js` |
| 9 | E2E happy-path test passing in staging | Required before launch |
| 10 | DNS + TLS configured for production domains | Required before launch |

## 🟡 Recommended But Not Blocking

| # | Item | Timeline |
|---|------|----------|
| 1 | pgBouncer connection pooler | Before 5M users |
| 2 | Feature flag system (LaunchDarkly/Unleash) | Week 2 |
| 3 | Email verification on registration | Week 2 |
| 4 | 2FA for admin accounts | Week 3 |
| 5 | Circuit breaker on Stripe API calls | Week 2 |
| 6 | Versioned DB migrations (Flyway/db-migrate) | Week 3 |
| 7 | Read replicas for search queries | Before 5M users |
| 8 | JWT key rotation automation | Month 2 |

## 🚀 Final Go-Live Plan

```
T-7 days: Provision AWS infrastructure (RDS, ElastiCache, MSK, EKS)
T-6 days: Configure secrets management; generate production keys
T-5 days: Execute schema.sql on production RDS; validate
T-4 days: Deploy all services to staging namespace; E2E tests
T-3 days: Deploy observability stack; verify alerts + PagerDuty
T-2 days: k6 load test at 2× expected traffic; fix bottlenecks
T-1 day:  Final go/no-go meeting; on-call staffed; status page prepared

T+0h:     Deploy to production namespace
T+0.5h:   10% canary traffic → monitor 30 min
T+1h:     25% traffic → monitor 30 min
T+2h:     50% traffic → monitor 1 hour (verify payments)
T+4h:     100% traffic → 24-hour watch

T+24h:    War room stands down; normal on-call begins
T+7d:     Post-launch review; address non-blocking items
```

### Go/No-Go Criteria

| Metric | Go Threshold | Measured At |
|--------|--------------|-------------|
| Canary error rate | < 1% | After 30 min at 10% traffic |
| P99 latency | < 2s | After 30 min at 25% traffic |
| Payment success rate | > 99.5% | After 1 hour at 50% traffic |
| GPS ingestion rate | > 90% of expected | After 1 hour at 50% traffic |
| Zero P0/P1 alerts | No critical alerts for 4 hours | Before going to 100% |

### Emergency Rollback

```bash
# Full rollback (< 2 min)
kubectl rollout undo deployment/api -n logistics
kubectl rollout undo deployment/tracking -n logistics
kubectl rollout undo deployment/worker-matching -n logistics
kubectl rollout undo deployment/worker-notification -n logistics
kubectl rollout undo deployment/worker-analytics -n logistics
kubectl rollout undo deployment/worker-payment -n logistics

# Verify rollback
kubectl rollout status deployment/api -n logistics
```

---

## Summary

**The application code is production-ready.** All critical code-level issues have been fixed:
- Two-phase payment settlement with reconciliation
- Comprehensive health checks
- Kafka DLQ + fallback to Redis
- Graceful shutdown with connection draining
- GPS backpressure + atomic batch drain
- Prometheus alerting for all failure modes

**The infrastructure is NOT yet production-ready.** Single-node data stores (PG, Redis, Kafka) are the primary risk. These are standard managed-service deployments (RDS, ElastiCache, MSK) that can be provisioned in < 1 day.

**Verdict: CONDITIONAL GO — proceed with infrastructure provisioning immediately. Launch in 7 days is achievable.**
