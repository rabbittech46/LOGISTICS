# Create these files locally before running docker-compose.
# In production, inject them from your secrets manager (AWS Secrets Manager via External Secrets, Vault, Doppler, 1Password, etc.).
#
# Required filenames:
# - db_password.txt
# - jwt_public.pem
# - jwt_private.pem
# - stripe_secret_key.txt
# - stripe_webhook_secret.txt
#
# This directory must contain only local untracked secret files plus this README.
# `.gitignore` excludes all payload files here and `npm run security:check`
# fails if any payload is committed.
#
# Secret rotation and history purge must be handled outside the application codebase.
