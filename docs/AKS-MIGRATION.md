# AKS Migration (`.com` only)

> ⚠️ **历史迁移记录（2026-05）。** 迁移已完成；**当前部署方式以根 `README.md` 的
> _Deployment_ 一节为准**（AKS + ArgoCD + `deploy/deploy-com-aks.sh`）。本文引用的
> GitHub Actions 构建 workflow（`build-com-aks` / `build-staging` / `build-prod`）**已废弃删除**，
> 改为本地 `az acr build` 经 deploy 脚本部署。下文保留作迁移过程参考。

> Live working document. Updated as we go. Source of truth for resuming the
> migration mid-stream — anyone (or any future session) should be able to read
> this and pick up where we left off.

---

## TL;DR

- **Scope:** Move `fizzdragon.com` (international side) from Alibaba Cloud ECS docker-compose → Azure Kubernetes Service (AKS) with Helm + ArgoCD + GitOps
- **Out of scope (at the time):** `fizzdragon.fizzspace.cn` (China side) stayed on Alibaba ECS docker-compose. **Update: .cn has since migrated to Aliyun ACK (2026-06-26; cluster `fizzdragon-cn`, ns `fizzdragon`, live host `fizzstudio.fizzspace.cn`) — see README § Deployment.**
- **Region:** `southeastasia` (Singapore) — matches existing `fizzdragon-ai-pg`. Future EU/US regions via Front Door / Traffic Manager when needed.
- **Target architecture:** Free-tier control plane + dual node pool (system always-on, worker KEDA scale-to-zero) — ~**$75/mo** estimated.
- **Subscription:** `fizzdragon-ai-prod` (`5d94f40f-701f-45e1-ab4b-0e1506104ebd`), tenant `FIZZDRAGON`.

---

## Status (2026-05-18)

| Phase | Step                                                                                                                                                                               | Status        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 0     | Azure PG migrated (existing)                                                                                                                                                       | ✅            |
| 0     | Local env file updated to point at Azure PG                                                                                                                                        | ✅            |
| 0     | Resource providers registered (ContainerRegistry / KeyVault / ContainerService / OperationalInsights)                                                                              | ✅            |
| 0     | RG `rg-fizzdragon-com-prod` created (southeastasia)                                                                                                                                | ✅            |
| 0     | ACR `acrfizzdragoncom` Basic created                                                                                                                                               | ✅            |
| 0     | Key Vault `kv-fizzdragon-com` Standard + RBAC created; current user has Admin role                                                                                                 | ✅            |
| 0     | Secrets migrated from `.env.production.com` → Key Vault (11 secrets total, hybrid naming)                                                                                          | ✅            |
| 0     | Azure Cache for Redis `redis-fizzdragon-com` Basic C0, TLS-only (6380)                                                                                                             | ✅            |
| 1     | AKS cluster `aks-fizzdragon-com` (Free tier, B2as_v2 system pool)                                                                                                                  | ✅            |
| 1     | Worker node pool (B2as_v2, 0-3 nodes, autoscaler)                                                                                                                                  | ✅            |
| 1     | `ingress-nginx` install (chart 4.15.1, LB IP `20.198.160.91`)                                                                                                                      | ✅            |
| 1     | `cert-manager` install (v1.20.2) + Let's Encrypt staging+prod ClusterIssuers                                                                                                       | ✅            |
| 1     | Secrets Store CSI Driver install + Azure provider + UAMI `id-fizzdragon-com-kv-reader` + federated credential + namespace `fizzdragon-com` + SA `fizzdragon-com-app`               | ✅            |
| 1     | ArgoCD install (chart 9.5.14)                                                                                                                                                      | ✅            |
| 1     | KEDA control plane install (v2.19.0); agent-worker ScaledObject deferred to Phase 2                                                                                                | ✅            |
| 1     | ACR attached to AKS (`--attach-acr acrfizzdragoncom`) — kubelet can pull images without imagePullSecrets                                                                           | ✅            |
| 2     | Helm umbrella chart `deploy/helm/fizzdragon/` (web/server/agent/agent-worker + SecretProviderClass + KEDA ScaledObject + multi-host Ingress, no PVC)                               | ✅            |
| 2     | Mastra storage migrated from libsql (file:/app/data) → Azure PG schema `mastra`; artifact-store also moved to `mastra.project_workflow_artifact`. No more shared filesystem state. | ✅            |
| 3     | UAMI `id-fizzdragon-com-gh-actions` + AcrPush role + federated credential `fic-gh-env-aks-prod` (subject `environment:aks-prod`)                                                   | ✅            |
| 3     | `.github/workflows/build-com-aks.yml` — OIDC login → ACR push → values.yaml tag bump → bot commit                                                                                  | ✅            |
| 3     | `deploy/argocd/applications/fizzdragon-com.yaml` — Application manifest pointing at chart                                                                                          | ✅            |
| 3     | Add GH repo variables (AZURE_CLIENT_ID / TENANT_ID / SUBSCRIPTION_ID) — needs human in GH UI                                                                                       | ⏳ pending    |
| 3.5   | First end-to-end run: fire workflow → ArgoCD sync → verify pods + TLS + LB                                                                                                         | ⏳ pending    |
| 4     | DNS: switch `fizzstudio.fizzdragon.com` A record from 136 ECS → AKS LB `20.198.160.91` via HiChina DNS console                                                                     | ⏳ pending    |
| 4     | Decommission 136 ECS (Node-only host; Java runs on a separate ECS that stays unchanged)                                                                                            | ⏳ pending    |
| 4     | `fizzdragon.com` (bare domain) stays pointed at Java ECS so AKS pods can keep calling `JAVA_STUDIO_URL=https://fizzdragon.com/studio` unchanged                                    | ⏳ keep as-is |
| 5     | Container Insights / Prometheus / alerting                                                                                                                                         | ⏳ pending    |
| 5     | Cloudflare Free in front of LB for WAF/DDoS/source-IP hiding                                                                                                                       | ⏳ pending    |
| 5     | ArgoCD ingress + SSO + IP allowlist                                                                                                                                                | ⏳ pending    |

---

## Architecture decisions (locked-in)

| Decision                     | Choice                                                                                             | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster control plane tier   | **Free** ($0/mo, no SLA, SLO 99.5%)                                                                | Solo dev, no SLA need. Save $73/mo vs Standard.                                                                                                                                                                                                                                                                                                                                                            |
| Cluster mode                 | **Standard** AKS (NOT Auto Mode)                                                                   | Auto Mode forces Standard tier + larger SKUs. ~$400/mo overhead rejected.                                                                                                                                                                                                                                                                                                                                  |
| System node pool             | **1× `Standard_B2as_v2`** (2c/8G AMD, ~$27/mo), autoscale 1-2                                      | Cheapest 2c/8G in southeastasia. B-series v1 (`B2ms`) unavailable in this subscription/region — `_v2` is the modern replacement and cheaper. AMD variant saves ~10% vs Intel.                                                                                                                                                                                                                              |
| Worker node pool             | **0-3× `Standard_B2as_v2`** (~$0-81/mo, avg ~$15/mo at 10% busy)                                   | KEDA scales pods, cluster autoscaler scales nodes. Cold start 2-3 min on 0→1 — acceptable for background AI jobs.                                                                                                                                                                                                                                                                                          |
| Network plugin               | Azure CNI **Overlay** mode                                                                         | IP-efficient; pods get overlay IPs not VNet IPs. Avoids exhausting subnet.                                                                                                                                                                                                                                                                                                                                 |
| Identity                     | Managed Identity + OIDC issuer + Workload Identity                                                 | Required for Secrets Store CSI to pull from Key Vault without secrets-in-deployment-yaml.                                                                                                                                                                                                                                                                                                                  |
| Container registry           | **ACR Basic** `acrfizzdragoncom` ($5/mo)                                                           | Replaces GHCR. AKS auto-attached during create (`--attach-acr`) — no imagePullSecrets needed.                                                                                                                                                                                                                                                                                                              |
| Secrets                      | **Azure Key Vault** `kv-fizzdragon-com` + Secrets Store CSI Driver                                 | Helm references KV secret names; CSI mounts as files in pod at runtime.                                                                                                                                                                                                                                                                                                                                    |
| Redis                        | **Azure Cache for Redis Basic C0** (`redis-fizzdragon-com`, $16/mo, TLS-only 6380, no HA)          | Started as in-cluster StatefulSet, swapped to managed 2026-05-18 for enterprise hygiene: zero ops burden (patching/monitoring/backup), still cheapest tier matching previous capacity. Apps consume `rediss://` URL from KV `redis-conn-string`; KEDA consumes split `redis-address` + `redis-password` via TriggerAuthentication. Upgrade path: bump to Standard C0 ($32/mo) for HA without chart change. |
| Postgres                     | **Azure Database for PostgreSQL** (existing `fizzdragon-ai-pg` in `rg-fizzdragon-ai`)              | Already migrated. NOT in AKS. Keeps data lifecycle separate from compute.                                                                                                                                                                                                                                                                                                                                  |
| Ingress                      | `ingress-nginx` + `cert-manager` + Let's Encrypt                                                   | Standard combo. HTTP-01 challenge initially (works through ingress), no DNS-01 webhook needed.                                                                                                                                                                                                                                                                                                             |
| GitOps                       | **ArgoCD**                                                                                         | UI + rollback. Watches the git repo's `deploy/helm/` directory and syncs to cluster.                                                                                                                                                                                                                                                                                                                       |
| CI/CD                        | GitHub Actions → build → push ACR → commit-bump `values.yaml` image tag → ArgoCD detects and syncs | Replaces watchtower polling.                                                                                                                                                                                                                                                                                                                                                                               |
| DNS provider                 | **Alibaba Cloud DNS (万网/HiChina)** — already manages `fizzdragon.com`                            | Domain registered there, NS = `dns1.hichina.com / dns2.hichina.com`, expires 2027-03-25. Not transferring to Azure DNS (yet).                                                                                                                                                                                                                                                                              |
| Test access during build-out | LB public IP directly, or `<LB-IP>.nip.io` magic DNS                                               | No domain config needed until Phase 4. cert-manager can sign Let's Encrypt for `nip.io` hostnames too.                                                                                                                                                                                                                                                                                                     |
| Test subdomain (Phase 4)     | `aks.fizzdragon.com`                                                                               | Add A record at HiChina. Bare `fizzdragon.com` stays pointed at ECS until AKS verified stable.                                                                                                                                                                                                                                                                                                             |
| Bottleneck-driver            | `agent-worker` `mem_limit=10g` with `WORKER_CONCURRENCY=90`                                        | This is the reason worker pool exists with autoscaler. System pool stays small.                                                                                                                                                                                                                                                                                                                            |

---

## Resource inventory

### Currently in `fizzdragon-ai-prod` subscription

| Resource                 | Type                                        | RG                     | Location      | Status      | Monthly cost                       |
| ------------------------ | ------------------------------------------- | ---------------------- | ------------- | ----------- | ---------------------------------- |
| `rg-fizzdragon-com-prod` | Resource group                              | —                      | southeastasia | ✅ Created  | $0                                 |
| `acrfizzdragoncom`       | Container registry (Basic)                  | rg-fizzdragon-com-prod | southeastasia | ✅ Created  | ~$5                                |
| `kv-fizzdragon-com`      | Key Vault (Standard, RBAC, 7-day retention) | rg-fizzdragon-com-prod | southeastasia | ✅ Created  | ~$1                                |
| `redis-fizzdragon-com`   | Azure Cache for Redis (Basic C0, TLS-only)  | rg-fizzdragon-com-prod | southeastasia | ✅ Created  | ~$16                               |
| `aks-fizzdragon-com`     | AKS cluster (Free tier, B2as_v2)            | rg-fizzdragon-com-prod | southeastasia | ✅ Created  | $0 control plane + $27 system node |
| `fizzdragon-ai-pg`       | Azure DB for PostgreSQL (B1ms, 32GiB)       | rg-fizzdragon-ai       | southeastasia | ✅ Existing | ~$23                               |
| `fizzdragon-ai-foundry`  | AI Foundry                                  | rg-fizzdragon-ai       | eastus2       | ✅ Existing | pay-as-go                          |
| `fizzdragon-realtime`    | Web PubSub                                  | rg-fizzdragon-ai       | eastus2       | ✅ Existing | varies                             |
| `fizzdragonblob`         | Storage account                             | rg-fizzdragon-ai       | eastus2       | ✅ Existing | varies                             |

### Cost summary (steady state)

| Item                                       | Monthly        |
| ------------------------------------------ | -------------- |
| AKS control plane (Free)                   | $0             |
| System node × 1 B2as_v2                    | ~$27           |
| Worker nodes (avg ~10% busy, 1 node burst) | ~$3-15         |
| ACR Basic                                  | $5             |
| Key Vault                                  | $1             |
| Azure Cache for Redis Basic C0             | $16            |
| Public IP (LB)                             | ~$4            |
| Standard LB rules (5 free)                 | $0             |
| Azure Disk (managed-csi, on-demand)        | minimal        |
| Outbound data transfer                     | varies         |
| **Compute subtotal**                       | **~$60-75/mo** |
| Azure PG (existing)                        | $23            |
| **Total .com infra**                       | **~$83-98/mo** |

This is comparable to (or below) the current Alibaba ECS spend.

---

## Naming convention

### Current state (mixed, acknowledged)

Two styles coexist in this subscription:

| Style                                                  | Examples                                                                                | Era                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------- |
| `<workload>-<role>` (no type prefix)                   | `fizzdragon-ai-pg`, `fizzdragon-realtime`, `fizzdragon-ai-foundry`, `fizzdragonblob`    | Pre-AKS, legacy       |
| `<type>-fizzdragon-<scope>` (type prefix, partial CAF) | `acrfizzdragoncom`, `kv-fizzdragon-com`, `aks-fizzdragon-com`, `rg-fizzdragon-com-prod` | This migration onward |

Renaming Azure resources is effectively impossible without delete + recreate, which is impractical for the legacy resources (they hold data, connection strings, deployed models). Legacy names stay as-is.

### Forward rule (apply to new resources)

```
<type-prefix>-fizzdragon-<scope>[-<env>]
```

Where:

- `<type-prefix>` follows [Microsoft CAF abbreviations](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) (`rg`, `kv`, `aks`, `acr`, `st`, `psql`, `cog`, `wps`, `kv`, etc.)
- `<scope>` distinguishes business contexts where it matters (`com`, `ai`, `cn`-if-ever)
- `<env>` only when multiple environments exist in the same subscription (skip for now; we have prod-only). Add `-staging`, `-dev` etc. when those land.
- Region NOT in the name. Use tags instead.

Examples:

- `kv-fizzdragon-com` ✅ (current)
- Future: `kv-fizzdragon-com-staging` when staging exists
- Future EU expansion: `aks-fizzdragon-com-eu` (region in scope, not as separate token)

### Naming-constraint exceptions

| Resource type      | Hard limit                               | Adaptation                                     |
| ------------------ | ---------------------------------------- | ---------------------------------------------- |
| Storage account    | 3-24 chars, alphanumeric only, lowercase | `stfizzdragoncomprod` (no separators)          |
| Container Registry | 5-50 chars, alphanumeric only            | `acrfizzdragoncom` (no separators)             |
| Key Vault          | 3-24 chars, hyphens allowed              | `kv-fizzdragon-com` (room for `-staging` etc.) |

When the hyphenated form doesn't fit, drop separators (don't drop info).

### Metadata via tags

Tags are the source of truth for `env`, `workload`, `purpose`, `stack` — not the name. Names are short and stable; tags are queryable and updatable. Today's new resources already carry `env=prod` + `stack=com` + `purpose=*` tags.

### Decision: skip retroactive tag cleanup

Not adding tags to legacy `rg-fizzdragon-ai` resources right now — documentation captures the convention, retro-fitting tags is low-priority chore work.

### Key Vault secret naming (hybrid policy, locked-in 2026-05-18)

Two flavors, picked deliberately:

| Category                                                | Pattern                 | Examples                                                                                                                |
| ------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **LLM provider keys**                                   | `<provider>-api-key`    | `alibaba-api-key`, `deepseek-api-key`, `anthropic-api-key`, `azure-openai-api-key`                                      |
| **Azure-native infra connection strings**               | `<purpose>-conn-string` | `realtime-conn-string`, `blob-conn-string`, `db-conn-string`                                                            |
| **Third-party with purpose-specific use**               | `<purpose>-key`         | `image-cover-key` (Replicate, only used by `generate_project_cover` tool)                                               |
| **Same Azure-native service, multiple representations** | `<purpose>-<form>`      | `redis-conn-string` (rediss:// URL for apps), `redis-address` (host:port for KEDA), `redis-password` (raw key for KEDA) |

Why hybrid:

- LLM provider names carry **model behaviour information** — `anthropic-api-key` vs `deepseek-api-key` says something meaningful about routing. Swap providers = swap codepaths anyway.
- Azure-native services don't need the `azure-` prefix — they're inside an Azure subscription by construction. Purpose (`realtime`, `blob`, `db`) is the useful distinguisher.
- Third-party services with narrow function (`image-cover-key` for Replicate) — purpose name beats vendor name since vendor could change without semantic shift.

The mapping `KV-secret-name → pod-env-var-name` lives in `deploy/helm/fizzdragon/values.yaml::secrets.mapping` — that file is the only place that needs to change if either side is renamed.

### Kubernetes resource naming

- Release name: `fizzdragon`, namespace: `fizzdragon-com`
- Resource names: `{{ .Release.Name }}-<component>` → `fizzdragon-web`, `fizzdragon-server`, `fizzdragon-agent`, `fizzdragon-agent-worker`, `fizzdragon-kv` (SPC), `fizzdragon-main-ingress` / `fizzdragon-studio-ingress`, `fizzdragon-secrets` (projected from KV), `fizzdragon-redis-auth` (KEDA TriggerAuth).
- Labels: K8s recommended set (`app.kubernetes.io/{name,instance,version,managed-by,part-of,component}` + `helm.sh/chart`). See `templates/_helpers.tpl`.

---

## Critical configuration knobs

### `agent-worker` concurrency

- ECS default: `WORKER_CONCURRENCY=90`, `mem_limit=10g`
- AKS: keep same concurrency on worker pool nodes (B2as_v2 8G fits one worker pod cleanly)
- KEDA `ScaledObject` watches BullMQ queue depth; scales pods 0 → N
- Cluster autoscaler then scales worker pool nodes 0 → N

### Redis sizing

- Current peak: ~30MB / 900MB cap (3.4% utilization)
- AKS sizing: same 1GB cap, 200-500MB request
- Persistence: managed (Azure Cache for Redis Basic C0 — no pod-side persistence needed)
- Eviction: `noeviction` (BullMQ + Mastra workflow state MUST NOT be dropped mid-run)

### Network policy

- AKS overlay CNI: pods on `10.244.0.0/16` (default), services on `10.0.0.0/16`
- LB egress: Standard SKU SNAT
- No private cluster (public API server) — simpler, fine for solo dev

---

## How to resume mid-stream

1. **Verify Azure auth + subscription:**

   ```bash
   az account show --query "{name:name, id:id}" -o table
   # Expect: name=fizzdragon-ai-prod, id=5d94f40f-...
   ```

2. **Check what's already provisioned:**

   ```bash
   az resource list -g rg-fizzdragon-com-prod --query "[].{name:name, type:type}" -o table
   ```

3. **kubectl access (after AKS is created):**

   ```bash
   az aks get-credentials -g rg-fizzdragon-com-prod -n aks-fizzdragon-com
   kubectl get nodes
   ```

4. **What to do next:** read the `Status` table above, pick the first `⏳ pending` row.

---

## Reference commands

### Re-key kubectl

```bash
az aks get-credentials -g rg-fizzdragon-com-prod -n aks-fizzdragon-com --overwrite-existing
```

### Add worker node pool

```bash
az aks nodepool add \
  -g rg-fizzdragon-com-prod \
  --cluster-name aks-fizzdragon-com \
  -n worker \
  --node-vm-size Standard_B2as_v2 \
  --enable-cluster-autoscaler \
  --min-count 0 \
  --max-count 3 \
  --node-count 0 \
  --node-taints workload=worker:NoSchedule \
  --labels pool=worker \
  --mode User \
  --node-osdisk-size 32
```

### Read a secret from Key Vault

```bash
az keyvault secret show --vault-name kv-fizzdragon-com -n <secret-name> --query value -o tsv
```

### Push an image to ACR

```bash
az acr login --name acrfizzdragoncom
docker tag fizzdragon/web:dev acrfizzdragoncom.azurecr.io/web:dev
docker push acrfizzdragoncom.azurecr.io/web:dev
```

---

## CI/CD (Phase 3 — implemented 2026-05-18)

### Branching model — GitLab Flow with environment branches

| Branch    | Role                     | Triggers                                                                        | Target                                        |
| --------- | ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `develop` | Integration / daily work | `push` → `build-staging.yml` auto-triggers                                      | Staging ECS (existing). _No staging AKS yet._ |
| `main`    | Production release       | `workflow_dispatch` → `build-prod.yml` (target=prod-cn) and `build-com-aks.yml` | Prod ECS (CN) + Prod AKS (COM)                |

Promotion: `develop` → `main` via merge after staging verification. Both prod targets (CN ECS, COM AKS) deploy from the **same `main` commit** — release consistency across the two clouds.

### What stays the same

- `.cn` side: `build-prod.yml` workflow with target=prod-cn is untouched. Builds + pushes to GHCR, ECS Watchtower pulls. Zero impact from AKS work.
- 3-image build matrix (web/server/agent) and Dockerfiles unchanged.
- `build-staging.yml`, `ci.yml`, `cleanup-branches.yml` unchanged.

### What's new (`.com` AKS path)

| File                                             | Purpose                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/build-com-aks.yml`            | `workflow_dispatch` from **main only** (guard rejects other refs). Builds web/server/agent, pushes to ACR `:<sha>` + `:latest`, then bot-commits `values.yaml` tag bump to main. |
| `deploy/argocd/applications/fizzdragon-com.yaml` | ArgoCD `Application` pointing at `deploy/helm/fizzdragon` on **`main`**. Auto-sync + self-heal + CreateNamespace. Ignores `agent-worker.spec.replicas` so KEDA can scale freely. |

Auth: Azure OIDC federation via UAMI `id-fizzdragon-com-gh-actions` — no static credentials in GH. Single federated subject:

- `repo:Fizzdragon-Pte-Ltd-2/fizzdragon-platform:environment:aks-prod`

The workflow's build job declares `environment: aks-prod`, which is what surfaces the env-scoped variables (`AZURE_*`) and matches this federated credential. Branch-ref credentials are intentionally absent — the environment is the only gate.

UAMI role: `AcrPush` on `acrfizzdragoncom`. That's it — no AKS admin, no KV access; the workflow only pushes images.

### One-time setup before first run

1. **Create GitHub Environment `aks-prod`** (Settings → Environments → New environment → name `aks-prod` → Configure environment):
   - Optional but recommended: tick **Required reviewers** = yourself. Every workflow run will pause for explicit Approve before pushing to ACR.
   - **Deployment branches** = "Selected branches" → allow `main` only. Matches the workflow's branch guard.
2. **Add environment variables** (on the same `aks-prod` environment page, Environment variables section — NOT Repository variables, NOT Secrets):
   ```
   AZURE_CLIENT_ID        = c5629489-473e-4ea6-8ebb-a04ba7ead8a6
   AZURE_TENANT_ID        = 04aa24ae-21ea-447d-b33e-a9b6bfeda97a
   AZURE_SUBSCRIPTION_ID  = 5d94f40f-701f-45e1-ab4b-0e1506104ebd
   ```
   These are visible only to jobs that declare `environment: aks-prod` — the build job in `build-com-aks.yml` already does.
3. **Apply ArgoCD Application**:
   ```bash
   kubectl apply -f deploy/argocd/applications/fizzdragon-com.yaml
   ```
4. **Merge `develop` → `main`** when ready to release (after staging verification on develop).
5. **Fire the build workflow** from GitHub Actions UI on **main** (or `gh workflow run build-com-aks.yml --ref main`). If required reviewers is on, click Approve when prompted.
6. ArgoCD detects the values.yaml bump on main and reconciles the cluster.

### Why git-commit-bump over ArgoCD Image Updater

- Git history shows what was deployed when, who triggered it, what changed
- Rollback = `git revert <deploy commit>` (clean and obvious)
- No extra component to install/maintain
- Trade-off: 1 commit per deploy on `main` — noisy but auditable. `[skip ci]` keeps the loop tight.

### Rollback recipes

| Scenario                      | Action                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bad image just deployed       | Re-fire `build-com-aks.yml` with `inputs.ref` set to the previous good SHA on main. CI rebuilds + bumps values back.                                                                 |
| Bad values change (non-image) | `git revert <commit>` on main. ArgoCD reconciles in <1 min.                                                                                                                          |
| ArgoCD is misbehaving         | `kubectl -n argocd patch application fizzdragon-com --type merge -p '{"spec":{"syncPolicy":{"automated":null}}}'` to pause auto-sync; then debug. Re-enable with the opposite patch. |

---

## Glossary

- **ACR** — Azure Container Registry (we use Basic tier, $5/mo)
- **AKS** — Azure Kubernetes Service
- **CSI** — Container Storage Interface; here specifically Secrets Store CSI Driver (mounts Key Vault secrets as files in pods)
- **KEDA** — Kubernetes Event-Driven Autoscaling; scales pod count from 0 to N based on external metrics (BullMQ queue depth in our case)
- **OIDC issuer** — AKS issues OIDC tokens that Workload Identity federates with Azure AD, so pods can authenticate to Azure resources (KV / ACR / Storage) without secrets
- **Overlay network plugin** — pod IPs come from a separate CIDR not in the VNet; saves IP space, slight latency cost vs full Azure CNI

---

## Related memory files

- `project_aks_migration_session.md` — live session notes (decisions, what's done, what's open)
- `project_azure_migration.md` — broader Azure-first policy for international side
- `project_deployment.md` — current Alibaba ECS production setup
- `feedback_minimum_azure_skus.md` — user prefers cheapest Azure SKUs by default
