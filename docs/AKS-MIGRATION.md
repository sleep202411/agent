# Archived Azure AKS migration guide

The former `.com` AKS deployment was replaced by Alibaba Cloud Singapore ACK.
The current production runbook is [Singapore deployment](../deploy/aliyun-sg/README.md),
using `deploy/deploy-com.sh`.

The old Azure build entrypoint and workflow are disabled. Earlier AKS setup,
Key Vault projection, ArgoCD and migration instructions are available in Git
history and must not be used for current deployments.

Azure Front Door for the root domain and `www`, legacy Azure Blob media and
retained backups remain separate dependencies. Their retention does not make
AKS the active application deployment target. The `.cn` environment and the
independent Java/MySQL services were not part of this application move.
