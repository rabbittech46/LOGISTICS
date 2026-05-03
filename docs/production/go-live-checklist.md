# Go-Live Checklist

Use this checklist after the repo-side blockers are landed and before approving production launch.

## Repo-side artifacts

- `npm run security:check` passes
- `npm run test:e2e:typecheck` passes
- `k8s/secrets.yaml` is applied through External Secrets, not replaced with plaintext manifests
- `k8s/configmap.production-managed.yaml` has been templated with real managed-service endpoints
- `load/k6/launch-2x.js` has been executed against staging and results archived
- `scripts/validate-staging.mjs` has been run against staging ingress endpoints

## Infrastructure

- RDS Multi-AZ PostgreSQL is provisioned and failover tested
- Redis Multi-AZ or Sentinel-backed deployment is provisioned and failover tested
- Kafka has at least 3 brokers and replication factor 3
- PITR backups are enabled and restore has been tested
- OpenSearch / Elasticsearch has redundancy and ILM applied

## Security and secrets

- AWS Secrets Manager contains the production app secret bundle `rabbittech/logistics/production/app`
- External Secrets Operator is healthy and the generated `logistics-secrets` secret is present in the `logistics` namespace
- TLS is issued through cert-manager or the production certificate authority
- no committed files remain under `secrets/` or `nginx/certs/` except README files

## Staging verification

- `npm run validate:staging` succeeds with production-like staging URLs
- Playwright happy-path flows complete successfully in staging
- shipper payment authorization flow succeeds in-browser against staging Stripe configuration
- carrier dispatch and driver POD flow complete end-to-end in staging

## Operational readiness

- Prometheus alerts are loaded and firing tests have been completed
- PagerDuty integration has been verified end-to-end
- primary and secondary on-call rotations are staffed for launch week
- rollback owner and communication owner are assigned
- dashboard and log access is confirmed for the launch team

## Launch decision

- k6 run at 2x launch traffic meets latency and error thresholds
- no P0 or P1 issues remain open
- product, engineering, and SRE sign-off is recorded