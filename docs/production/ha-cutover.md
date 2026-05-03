# Production HA Cutover

This runbook replaces the single-node local data plane with launch-grade managed infrastructure. It does not change application code paths; it swaps environment targets and secret sources while keeping service contracts stable.

## Target topology

| Component | Local/default manifest | Launch target |
|---|---|---|
| PostgreSQL | single PostGIS pod | RDS PostgreSQL 16 Multi-AZ with automated backups and PITR |
| Redis | single Redis pod | ElastiCache Redis replication group with Multi-AZ failover |
| Kafka | single KRaft broker | 3-broker MSK cluster with replication factor 3 |
| Elasticsearch | single node | Multi-node OpenSearch / Elasticsearch managed domain |
| Secrets | file-based placeholders | AWS Secrets Manager + External Secrets Operator |

## Cutover sequence

1. Provision RDS, ElastiCache, MSK, and OpenSearch in three AZs.
2. Enable automated PostgreSQL backups and confirm PITR retention.
3. Create or update the `rabbittech/logistics/production/app` secret in AWS Secrets Manager with the application keys consumed by `k8s/secrets.yaml`.
4. Install the External Secrets Operator in the cluster and confirm the `external-secrets` service account can read AWS Secrets Manager.
5. Apply `k8s/configmap.production-managed.yaml` instead of `k8s/configmap.yaml`.
6. Apply `k8s/secrets.yaml` and wait for the generated `logistics-secrets` secret to appear.
7. Roll deployments one tier at a time: API, tracking, then workers.
8. Run `npm run validate:staging` against the staging ingress.
9. Run `npm run load:test:launch` against staging with 2x launch traffic.
10. Promote to production only after alerts, PagerDuty, and on-call coverage are confirmed.

## Required managed-service checks

### PostgreSQL

- Multi-AZ failover enabled
- automated backups enabled
- PITR retention confirmed
- PostGIS extension available
- connection limits sized for peak pod count

### Redis

- Multi-AZ failover enabled
- TLS enforced for production clients
- memory headroom verified above projected queue plus GPS hot-set usage

### Kafka

- 3 brokers minimum
- replication factor 3 for all production topics
- `min.insync.replicas` set to 2 or higher

### OpenSearch / Elasticsearch

- at least 2 data nodes
- index lifecycle policies loaded from `observability/elasticsearch/ilm-policy.json`
- ingest credentials stored in AWS Secrets Manager

## Rollback plan

1. Re-apply the previous known-good ConfigMap.
2. Roll back the last Deployment revision with `kubectl rollout undo`.
3. Keep the managed data plane intact; only revert traffic and application environment if the fault is app-level.
4. If the issue is data-plane connectivity, hold rollout, keep staging in managed mode, and re-run validation after remediation.