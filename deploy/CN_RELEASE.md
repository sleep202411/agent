# Production releases: .com and CN

Start from clean, committed `main`. Both release coordinators automatically
check local and remote `main` at stage boundaries. If application inputs change,
they rebuild the entire selected service set at the newer commit before rollout.
A CN migration already running finishes first. If a commit arrives during an
atomic rollout, that rollout finishes and another release cycle follows.

Each cycle has one immutable source SHA for the release. Each selected service
may reuse an older immutable image tag whose application/build inputs match that
source. Images are regional: a successful
.com build does not create CN images. The scripts preserve the operator's
checkout, including edits or branch changes made after startup.

## 1. Update the checkout

```bash
git checkout main &&
git pull --ff-only origin main
```

Select every service affected by application or shared dependency changes.
For the regional currency changes, select all four services below.

## 2. Build and publish .com

```bash
deploy/deploy-com-aks.sh web server studio admin-ui
```

The script first searches the regional registry for each selected service. It
reuses a verified image with matching committed build inputs, including images
built by another operator. Only services without a matching image are built
from a committed snapshot; every new ACR run is verified.
It publishes image tags from a disposable checkout of the latest remote branch.
Concurrent GitOps commits are preserved; a rejected push is refetched and
retried. It refuses to overwrite a newer or divergent published image.

Deployment-only commits do not rebuild .com application images. Their changes
are retained in the publication base. The running tooling stays frozen for the
invocation. The script reports the final source SHA; do not infer it from
`HEAD~1` or assume your starting SHA is still the final one.

ArgoCD applies the published GitOps commit asynchronously. Verify using an
authorized context (the provisioned admin context here):

```bash
export KUBECONFIG="$HOME/.kube/config"
kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com \
  get deployments -o 'custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image'
for service in web server studio admin-ui; do
  kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com \
    rollout status "deployment/fizzdragon-$service" --timeout=300s || break
done
```

Compare each selected service with the expected image tag and digest printed by
the release; unchanged services can legitimately retain older image tags. Ready old pods do not prove that ArgoCD has applied the new tags.
Then verify the affected signed-in UI/API workflows.

## 3. Build, back up, migrate and deploy CN

```bash
export DEPLOY_KEY="$HOME/.ssh/id_ed25519_fizzdragon_cn"
export KUBECONFIG="$HOME/.kube/config-fizzdragon-cn"

CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --allow-chart-update web server studio admin-ui
```

This automatically:

1. Reuses matching verified CN images across operators, builds only missing or
   changed services, and verifies every selected image digest.
2. When Server is selected, creates a manual RDS backup and waits for completion.
3. Resolves the returned **BackupJobId** to the completed **BackupId**, then
   verifies that the backup is available and less than six hours old.
4. Runs the migration using the verified Server image.
5. Checks for newer source again, then applies the pinned Helm chart and images.
6. Waits for rollout and checks readiness.

There is no need to create a backup or copy its ID manually in this normal flow.
A frontend-only selection skips backup and migration. CN chart changes also
start a new cycle because CN applies the whole pinned chart. Changes only to
.com image tags overridden by CN do not trigger a CN rebuild. Other deployment
tooling edits are recorded by the source checks but take effect on the next
invocation; running scripts are never swapped midway.

The Aliyun `default` profile needs ECS, ACR and RDS access; ACK credentials,
registry credentials and the build-ECS SSH allowlist must already be configured.
Use the private SSH key, not its `.pub` file.

## 4. Recover an interrupted CN release

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --resume --allow-chart-update
```

Resume retains the original selected services and cluster target. It verifies
saved digests and reattaches to any existing migration before following newer
source. It never deletes or repeats a failed migration automatically. Previous
cycles and backup identifiers remain in the receipt under Git's common directory:
`fizzdragon-releases/cn.json`.

If an unfinished receipt exists, finish it with `--resume` before starting a new
service selection. A completed receipt is not redeployed by `--resume`.
If the original receipt omitted a newly affected service, release that service
afterward. For example:

```bash
deploy/release-cn.sh --allow-chart-update admin-ui
```

An uncertain backup request is not duplicated automatically. Find its completed
BackupId in RDS and resume with `--backup-id BACKUP_ID`. Image-pull errors still
require checking pod events and cluster registry access; existing registry
images alone do not establish that ACK can pull them.

## 5. Verify CN

```bash
kubectl -n fizzdragon get deployments \
  -o 'custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image'
for service in web server studio admin-ui; do
  kubectl -n fizzdragon rollout status "deployment/fizzdragon-$service" \
    --timeout=300s || break
done
```

Compare selected services with the final receipt's `imageTags` and `digests`.
Older receipts without `imageTags` use the receipt's source SHA for each service.
Check migration completion and the affected signed-in workflows. Infrastructure
readiness does not replace product acceptance.

## Explicit image reuse and limits

`--tag FULL_SOURCE_SHA` sets the starting source, not an instruction to ignore
newer application commits. `--use-existing-images` verifies and reuses the
selected images at that source; if source advances, the coordinator automatically
builds the newer source instead.

The lower-level `deploy-cn-services.sh` and `run-cn-migrations.sh` commands remain
pinned primitives for deliberate separate steps; they do not coordinate automatic
release cycles. Use `release-cn.sh` for the automatic workflow.

The scripts stop on divergent Git history, inaccessible remotes, failed builds
or migrations, or ten successive source restarts. Resume after correcting the
cause. A regional shared lock serializes separate clones and operators before
image lookup. A local CN lock additionally protects the receipt. .com and CN
can run concurrently because their registries and clusters are separate.

## Image reuse and transient RDS failures

Both coordinators discover reusable images from the regional registry, not just
an operator's local receipt. Reuse requires a full Git SHA in the selected
source's ancestry, matching committed service inputs, and a verified digest.
Inputs include the selected app, workspace manifests, shared packages, lockfiles,
root build configuration, regional build environment and image-build recipe.
Unrelated app source, documentation and publication-only changes do not require
recompilation. Shared build inputs are conservatively included.

Images keep their original SHA tags; they are never retagged as a newer source.
A previously built image can be reused even if an earlier rollout failed or was
replaced. GitOps/Helm still reconciles desired deployment state; reuse is not a
claim that the image is already running. CN skips Helm upgrade when its rendered
manifest already matches, and still checks rollout/readiness. Registry access
errors or a digest changing during verification stop the release, never cause a
fallback build. COM rollout remains asynchronous under ArgoCD.

RDS `DescribeBackupTasks` and `DescribeBackups` retry transient reads up to four
times with 2/5/10-second backoff and 45-second request timeouts. Authorization
errors stop immediately. `CreateBackup` is never automatically retried after an
uncertain response; the saved job/backup identity remains the recovery authority.

Direct CN build-only/deploy-only commands also discover reusable images, but
only the coordinator manages backup, migration and source cycles.

## Shared release lock across operators

All operators must use these updated entry points. `.com` and CN each use an
atomic Kubernetes ConfigMap lock named `fizzdragon-release-lock` in their own
production namespace. Lock acquisition happens before source snapshots and image
lookup, and lasts through publication/deployment. A second operator waits (up to
four hours), then checks regional registry images again; equivalent inputs reuse
the existing image. CN's shared ECS and Helm release are serialized too. The
regions do not block each other. Older scripts or manual cloud commands do not
participate in this protocol and must not run concurrently.

The current entry points use `~/.kube/config`, context
`aks-fizzdragon-com-admin`, namespace `fizzdragon-com` for .com, and
`~/.kube/config-fizzdragon-cn`, context
`218059191361846222-c72d2039c68624a3e8d0dee257a13d451`, namespace `fizzdragon`
for CN. These explicit targets avoid acquiring a lock in the wrong current
cluster. Operators need `get`, `create`, and `update` ConfigMap permissions;
missing permission/connectivity fails before any build. The lock contains only
an owner UUID, region and timestamp. Do not delete it or place it in Helm/GitOps
pruning ownership. Nested commands validate inherited ownership rather than
acquiring the same lock twice.

A successful command releases the lock automatically using a resource-version
compare-and-swap. Failed, interrupted or killed commands leave the lock held:
remote ACR/ECS builds or migrations can outlive a local process. There is no TTL
or automatic takeover that could permit overlapping work. On failure, the CLI
prints the owner UUID. Before recovering, stop the old local invocation and
verify its remote ACR/ECS builds, migration Jobs and Helm operations have stopped
or completed. Then use the printed UUID (not an image SHA):

```bash
CONFIRM_REMOTE_RELEASE_STOPPED=YES python3 deploy/release_lock.py \
  --recover-owner "$FD_FAILED_LOCK_OWNER" cn
# For .com, replace the final cn with com.
```

Recovery checks both the exact owner UUID and resource version; it will not
clear a different operator's lock. After recovery, CN can use the normal
`--resume` command with its saved image/backup/migration state. A process failure
before the first acquisition cannot leave an active remote build, but an
uncertain acquisition response still requires inspection. In-flight invocations
keep their frozen tooling; pull and start a new invocation to use this protocol.

## Private storyboard export storage

Merged MP4 exports are rendered by the Server FFmpeg worker and stored privately.
A successful Server rollout does not establish export acceptance. Configure a
separate private destination before testing export:

- CN: `OSS_PRIVATE_BUCKET`, with the Server identity granted read/write/delete
  access. With `OSS_INTERNAL=true`, also set `OSS_PRIVATE_PUBLIC_BASE_URL` to a
  separate HTTPS OSS CNAME bound directly to that private bucket, with a valid
  certificate. It must not be the public media bucket's CNAME or a read CDN.
  Signed uploads and downloads use this endpoint; bucket contents stay private.
- .com: `S3_PRIVATE_BUCKET`, distinct from the public media and quarantine buckets,
  with the Server R2 identity granted read/write/delete access.

Persist these settings through the region's existing Helm/secret configuration.
Do not substitute public media/auth/build buckets, publish private outputs, or
assume that bucket discovery proves a destination is suitable. After provisioning,
verify signed upload, authorized download and cleanup, then export a storyboard
with both images and videos and play the resulting MP4. No bucket or production
configuration is provisioned by these code changes.
