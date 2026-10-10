# CN production releases

Use `release-cn.sh` for the coordinated CN build, backup, migration and rollout.
International `.com` releases use [deploy-com.sh](deploy-com.sh) and the
[Singapore runbook](aliyun-sg/README.md); they do not use this CN coordinator,
Azure ArgoCD or its release-lock procedure.

Start CN releases from clean, committed `main`. The CN coordinator checks local
and remote `main` at stage boundaries. If application inputs change, it rebuilds
the selected service set at the newer commit before rollout. An already running
migration finishes first; an atomic rollout finishes before another source cycle.
Each cycle pins one source SHA and verified regional image digests. Matching
committed inputs can reuse older CN images. The scripts preserve checkout edits
or branch changes made after startup.

## 1. Update the checkout

```bash
git checkout main &&
git pull --ff-only origin main
```

Select every service affected by application or shared dependency changes.
Select all four services when shared changes affect them.

## 2. Build, back up, migrate and deploy CN

```bash
export DEPLOY_KEY="$HOME/.ssh/id_ed25519_fizzdragon_cn"
export KUBECONFIG="$HOME/.kube/config-fizzdragon-cn"

CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --allow-chart-update web server studio admin-ui game-agent
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

## 3. Recover an interrupted CN release

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

## 4. Verify CN

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

The CN coordinator discovers reusable images from the regional registry, not just
an operator's local receipt. Reuse requires a full Git SHA in the selected
source's ancestry, matching committed service inputs, and a verified digest.
Inputs include the selected app, workspace manifests, shared packages, lockfiles,
root build configuration, regional build environment and image-build recipe.
Unrelated app source, documentation and publication-only changes do not require
recompilation. Shared build inputs are conservatively included.

Images keep their original SHA tags; they are never retagged as a newer source.
A previously built image can be reused even if an earlier rollout failed or was
replaced. Helm still reconciles desired deployment state; reuse is not a
claim that the image is already running. CN skips Helm upgrade when its rendered
manifest already matches, and still checks rollout/readiness. Registry access
errors or a digest changing during verification stop the release, never cause a
fallback build.

RDS `DescribeBackupTasks` and `DescribeBackups` retry transient reads up to four
times with 2/5/10-second backoff and 45-second request timeouts. Authorization
errors stop immediately. `CreateBackup` is never automatically retried after an
uncertain response; the saved job/backup identity remains the recovery authority.

Direct CN build-only/deploy-only commands also discover reusable images, but
only the coordinator manages backup, migration and source cycles.

## Shared release lock across operators

All CN operators must use these entry points. An atomic Kubernetes ConfigMap
lock named `fizzdragon-release-lock` in the CN namespace serializes the shared
ECS builder and Helm release. It is acquired before source snapshots/image
lookup and held through deployment. A second operator waits up to four hours,
then checks for reusable regional images. Older scripts and manual cloud commands
do not participate and must not run concurrently.

The CN entry points use `~/.kube/config-fizzdragon-cn`, context
`218059191361846222-c72d2039c68624a3e8d0dee257a13d451`, namespace `fizzdragon`.
Operators need `get`, `create` and `update` ConfigMap permissions; missing access
or connectivity fails before builds. The lock records an owner UUID, region and
timestamp. Keep it outside Helm pruning ownership. Nested commands validate the
inherited owner rather than acquiring it again.

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

Game Agent uses a separate regional provider Secret (`fizzdragon-game-agent-provider`)
and internal admission Secret (`fizzdragon-game-agent-internal`). Its private workspace PVC
survives Recreate rollouts; do not replace it during image releases. Include `game-agent`
when releasing Harness or shared appearance contracts.

## Complete the six-service CN release

Run `python3 deploy/cn-game-agent-secrets.py` before first enabling Game Agent.
It creates missing, separate provider/admission Secrets in the pinned CN cluster,
using the existing CN Server Bailian credential in memory and a freshly generated
internal token. Existing Secrets are validated, never rotated or printed. The
`alicloud-disk-essd` StorageClass must exist for the private Harness workspace.

A new full release selects all six services explicitly:

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --allow-chart-update \
  web server studio admin-ui agent-os game-agent
```

For an unfinished five-service receipt still before successful build/backup,
resume with `--add-service game-agent`. The coordinator holds both release locks,
retains source/target/history and replans image reuse. Once build or backup has
completed, finish the original release and start a new six-service release;
never manually edit the receipt or clear an active owner's lock.

### Python compatibility

Deployment tooling retains Python 3.9 compatibility for existing operators.
For new installations, use the latest stable Python 3 release. CI tests 3.9–3.14
and a floating `3.x` job with `check-latest` on Linux and macOS, so new stable
releases are included automatically. Python 3.15 prereleases have a separate
advisory check; a preview result is not production certification. Scheduled
weekly runs catch interpreter changes even when deployment code is unchanged.

The entrypoints reject Python older than 3.9 before loading release code.
Use `python3 --version` to check the interpreter selected by your PATH; activate
your chosen Python environment before running the deployment command. Child
commands also resolve `python3` from PATH. No automatic interpreter upgrade occurs.
These tests mock cloud operations; passing them does not establish live rollout success.

## CN build registry credentials

The release obtains fresh ACR temporary credentials from the pinned Hangzhou
instance/profile during build preflight and again immediately before upload to
the builder. Token expiry is checked; credential values are never logged. The
second pair is held in the private temporary release directory and removed by
release cleanup. The build does not use saved `~/.fizzdragon-cn/acr-*.txt` files:
those one-hour credentials can expire between deployment attempts.

CN build SSH access is checked against the operator's current IPv4 and the
builder's attached security groups before starting ECS. A missing TCP/22 allow
rule stops with the exact CIDR and group IDs; no rules are changed automatically.
The check also runs after a remote build exits with SSH status 255, since a
changing operator IP can interrupt an established session. Diagnostic API/network
failures leave the existing SSH readiness checks in place. A matching allow rule
alone does not prove SSH readiness or exclude higher-priority deny/network rules.

### Automatic operator SSH authorization (explicit opt-in)

Build-capable entry points check current-IP SSH access before acquiring the
release lock. A failed access lookup or missing allow rule stops without creating
a new lock. Deploy-only and existing-image releases do not require builder access.
The build checks access again before starting ECS because the operator IP can change.

To authorize the current operator IPv4 automatically on each invocation, set:

```bash
export CN_AUTHORIZE_CURRENT_IP=YES
export CN_SSH_SECURITY_GROUP=sg-bp1e4dekh1wmj99tama7
```

This grants only TCP/22 from the detected `/32`, verifies that the chosen security
group is attached to the builder, and reads back the rule. The CLI identity needs
`ecs:AuthorizeSecurityGroup`. No existing rules are deleted, no broad CIDR is
added, and authorization failures stop the precheck. Unset these variables to
return to read-only access checks. Operator rules persist; administrators should
periodically remove obsolete entries. Existing locks are never silently cleared;
use the exact-owner recovery procedure above after verifying remote work stopped.
