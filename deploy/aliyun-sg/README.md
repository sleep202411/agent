# Singapore .com production deployment

The six `.com` services run on Alibaba Cloud Singapore ACK: `web`, `server`,
`studio`, `admin-ui`, `agent-os` and `game-agent` (Harness).

Normal publishing runs in the managed [Deploy COM pipeline](https://fizzdragon-ap-southeast-1.devops.alibabacloudcs.com/flow/pipelines/3998215/current).
The GitHub push webhook triggers this pipeline for commits merged into `main`.
Colleagues only need GitHub repository access. Cloud permissions,
Docker and Kubernetes credentials stay in the managed job; no ECS Runner,
local cloud login or personal IP allowlist is required.

`deploy/deploy-com.sh` remains the single publishing entrypoint. `.cn` has its own
account and deployment scripts.

| Setting                    | Value                                                           |
| -------------------------- | --------------------------------------------------------------- |
| Account / region           | `5332868355276356` / `ap-southeast-1`                           |
| ACK cluster                | `fizzdragon-com-sg` / `cb3e336c4059a4112b65c783e7bf67f1e`       |
| Namespace                  | `fizzdragon`                                                    |
| ACR instance               | `cri-d97629cirhkt3p9e`                                          |
| Registry for push and pull | `fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com` |

## Managed pipeline configuration

- GitHub App installation: only `Fizzdragon-Pte-Ltd-2/fizzdragon-platform`, with
  read access to code and metadata. Source connection: `fizzdragon-com-github`.
- Source: `main`, filter `^main$`, push events only, full history (clone depth `0`).
  Add the source's GitHub webhook to this repository with a shared signature
  secret. The deployment helper changes must reach `main` before the first
  managed publishing run; merging them triggers that first release.
- Managed VPC pool: `fizzdragon-com-sg`, attached to the existing Singapore VPC.
  Use `XLARGE_8C16G`, a 60-minute job timeout and Docker Daemon. Set job
  concurrency across pipeline runs to `1`, with up to `100` pipeline runs
  running or queued; do not cancel an active deployment when a new push arrives.
- Native **Setup Kubeconfig**: Singapore cluster connection over Private Network,
  output `/root/.kube/config`. Its existing RAM role has administrator RBAC for
  this cluster only. No kubeconfig or account key is stored in the repository.
- **Prepare COM Tools**: Python 3.11 virtual environment at
  `/opt/fizzdragon-release` and checksum-verified `kubectl` matching ACK 1.36.
- Native **Docker Login ACR**: the existing Singapore enterprise ACR connection,
  using the VPC registry host. The builder uses this job's temporary Docker login.
- **Publish COM** executes the existing entrypoint from the cloned repository:

  ```bash
  set -euo pipefail
  set +x
  export PATH="/opt/fizzdragon-release/bin:$PATH"
  ./deploy/deploy-com.sh all --kubeconfig /root/.kube/config
  ```

For a read-only check in the same environment, replace `all` with `--check`.
The check validates the known ACK TLS endpoint, namespace identity, six ready
Deployments, database Secret references, Harness PVC and publishing permissions.
It reads metadata only and does not build images, run SQL or deploy.

## Release behavior

Publishing requires a clean `main` checkout and captures its full committed SHA
once. Builds use an archive of that revision, the repository `.dockerignore` and
approved public inputs in `apps/web/.env.production.com`; local environment files
are excluded. Images target `linux/amd64`, carry source/input labels, are tagged
with the full SHA and are deployed by immutable digest.

The running immutable image is reused when its source is an ancestor of this
release and its per-service input fingerprint matches. The shared
`deploy/release_inputs.py` accounts for source, consumed workspace dependencies,
lockfiles, regional configuration and compilation arguments. Existing images
without these labels are rebuilt once. Registry errors stop the release.
A failed push is retried once without recompiling; expired native credentials
require a new pipeline run.

All selected images are ready before any production mutation. A changed Server
image first runs native Prisma migrations in a Job using existing in-cluster
credentials. A failed migration stops before application image changes. Each
image update waits for rollout readiness, preserves runtime configuration and
stops if another deployment changes the workloads concurrently.

## Failure handling and configuration changes

If a migration or rollout fails, inspect the named Job or Deployment before
retrying. Successful migration Jobs are removed; failed Jobs retain logs for up
to one day. There is no automatic database or image rollback. Migrations must
remain compatible with the running release; reverting an image does not undo
schema or customer data changes.

The production entrypoint does not apply historical migration preparation
configuration. Runtime configuration changes need a separately reviewed change to the actual
production resources; do not use a whole-release Helm upgrade for an image-only
release.

## Routing and retained dependencies

- `fizzstudio.fizzdragon.com`, `studio.fizzdragon.com` and
  `admin.fizzdragon.com` use Cloudflare → Singapore ALB → ACK.
- The root domain and `www` retain Azure Front Door. Existing Azure Blob media
  remains available; new global outputs use Cloudflare R2.
- Java/MySQL services remain separate in account `5941647929258385` and are
  reached through the configured Java endpoints.
- Azure application writers and automatic reconciliation remain stopped.
  Front Door, legacy media and retained backups must not be removed as part of
  an application release.

An ordinary deployment does not change DNS, TLS certificates, edge routing,
Java services or `.cn` resources.
