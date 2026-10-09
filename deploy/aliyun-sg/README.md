# Singapore .com production deployment

The six `.com` application services run on Alibaba Cloud Singapore ACK:
`web`, `server`, `studio`, `admin-ui`, `agent-os` and `game-agent` (Harness).

| Setting               | Value                                                           |
| --------------------- | --------------------------------------------------------------- |
| Alibaba Cloud account | `5332868355276356`                                              |
| Local CLI profile     | `acct6`                                                         |
| Region                | `ap-southeast-1`                                                |
| ACK cluster           | `fizzdragon-com-sg` / `cb3e336c4059a4112b65c783e7bf67f1e`       |
| Namespace             | `fizzdragon`                                                    |
| ACR instance          | `cri-d97629cirhkt3p9e`                                          |
| Public push host      | `fizzdragon-com-sg-registry.ap-southeast-1.cr.aliyuncs.com`     |
| Runtime pull host     | `fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com` |

Use `deploy/deploy-com.sh` from the repository root. The old Azure deployment
entrypoint and Azure build workflow are disabled. The `.cn` deployment is
independent and continues to use its own account, configuration and scripts.

## Operator setup

Each deployer uses their own RAM identity and kubeconfig for this account and
cluster. Reuse the standard system policies `AliyunCSFullAccess` and
`AliyunContainerRegistryFullAccess`, together with **Administrator** RBAC access
to this ACK cluster. Cloud API permissions and Kubernetes RBAC are separate;
both are required. No custom deployment permission hierarchy is needed.

For operators also managing RDS, `AliyunRDSFullAccess` is the standard system
policy. It covers all RDS resources in the account, so that scope must be
authorized before assignment. Database SQL login uses a separate database
account and network connection; the deployment script uses existing in-cluster
credentials and does not require a local database password.

1. Install Python 3.9+, Git, Alibaba Cloud CLI, kubectl and Docker with buildx.
   Start the local Docker daemon before building images.
2. Configure the local profile with the deployer's own authorized RAM identity:

   ```bash
   aliyun configure --profile acct6
   ```

   If that identity supports CLI OAuth login, use
   `aliyun configure --mode OAuth --profile acct6`, select the international
   site (`INTL`, `1`) and region `ap-southeast-1`. Do not reuse another
   operator's CLI configuration or credentials.

3. In ACK, open this cluster's connection information and download a kubeconfig
   for the deployer's identity. Choose an API endpoint reachable from the
   deployment machine and keep TLS certificate verification enabled.
4. Select that one kubeconfig and run the read-only preflight:

   ```bash
   export KUBECONFIG="$HOME/.kube/config-fizzdragon-com-sg"
   ./deploy/deploy-com.sh --check
   kubectl auth can-i patch deployments.apps -n fizzdragon
   kubectl auth can-i create jobs.batch -n fizzdragon
   kubectl auth can-i delete jobs.batch -n fizzdragon
   docker buildx version
   ```

`--check` verifies account identity, cluster endpoint/TLS, namespace, six ready
workloads, canonical database Secret references, the Harness workspace PVC and
the required Kubernetes RBAC permissions. It does not exercise actual writes,
image builds, registry login/push, SQL migration or a browser journey. The
commands above do not build or deploy.

## Publish selected services

Review the source and database migrations, complete the relevant local checks,
and merge the release into `main`. Every release, including `--image`, requires
literal `main` and a clean working tree, including no untracked files. Then
deploy the changed services:

```bash
./deploy/deploy-com.sh web
./deploy/deploy-com.sh server studio game-agent
./deploy/deploy-com.sh all

# Deploy a reviewed image already present in Singapore ACR:
./deploy/deploy-com.sh --image web=sha256:<64-hex-digest>
```

`all` builds all six services. Legacy `agent` is retired. Server, Studio and
Game Agent builds require the current Harness integration; deploy components
that change together in the same invocation. An existing image digest establishes
content identity; the operator must also verify release compatibility.

The builder captures the committed HEAD SHA once and archives that exact revision
into a temporary context. It does not follow subsequent branch changes or include
local modifications/untracked source. Local environment files are excluded;
public `.com` build inputs come from the committed
`apps/web/.env.production.com`. Builds target `linux/amd64`, tag images with the
full source SHA and deploy the pushed immutable `sha256` digest. Registry
authentication uses a temporary Docker configuration removed after the build.
The script does not start Docker, prune images or change Git. Read-only `--check`
does not require `main` or a clean working tree.

Before building, the release scans Singapore ACR for ancestor SHA tags with
matching per-service committed build inputs, verifies the registry digest, and
reuses matching images without requiring Docker. Registry errors stop the
release rather than triggering fallback builds. Missing images are built locally
with `--load`; credentials are refreshed immediately before pushing, and a failed
push is retried once without recompilation. The completed local image remains
available if both pushes fail; a later invocation may use Docker's build cache.
Previously pushed services remain reusable after another service fails.

CN and Singapore share `deploy/release_inputs.py`. Dependency declarations,
lockfiles, consumed workspace code, regional configuration and build recipes
remain inputs. Unconsumed workspace entry-point/documentation fields do not
invalidate other services. Historical recipes are parsed as data to compare
compilation arguments and platform, not whole scripts: login, retry, push/load,
logging and rollout changes do not require application rebuilds. The newest
matching ancestor source tag is preferred across all registry pages and its
digest is verified before reuse. An image whose historical recipe cannot be
verified is not eligible for reuse.

All selected images are verified or built before deployment. A changed Server image first
runs native `prisma migrate deploy` in a short-lived Job using that image and
the existing database admin Secret, owner role and CA. Database credentials
remain in the cluster. Migration failure stops before application image updates;
each subsequent image update waits for rollout readiness.

The script patches only the selected existing container image fields, including
an existing Server `db-migrate` init container when present. It preserves runtime
environment, Secrets, volumes, service identities, networking, replica counts
and rollout strategies. Concurrent workload changes stop the release rather
than overwrite another deployment.

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

### Agent OS connectivity repair

The retained Harness server isolation policy does not allow the Agent OS
connection on TCP 4301 or its domain callbacks on TCP 3001. Both Deployments can
be Ready while conversations fail with `Could not reach the Agent OS worker`.
`agent-os-server-networkpolicy.yaml` adds only those two same-namespace,
pod-selected paths. It preserves the existing policies and requires no image
build or pod restart. Apply it only to the existing Singapore namespace:

```bash
export KUBECONFIG="$HOME/.kube/config-fizzdragon-com-sg"
test "$(kubectl get namespace fizzdragon -o jsonpath='{.metadata.uid}')" = \
  '249a9075-37f2-4c41-aefc-050edd800e63' &&
kubectl apply -f deploy/aliyun-sg/agent-os-server-networkpolicy.yaml
```

Verify server-to-worker `/health` and authenticated `/v1/agent-os/models`,
and worker-to-server `/healthz` from their respective pods. Do not print the
internal token. These reads establish transport and model-list authorization;
a signed-in conversation is still required to verify inference and tool execution.
Ordinary image deployments preserve this policy. Do not apply this Singapore
repair to CN, whose network configuration is managed separately.

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
