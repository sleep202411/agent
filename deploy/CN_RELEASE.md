# Production releases: .com and CN

Start from clean, committed `main`. Both release coordinators automatically
check local and remote `main` at stage boundaries. If application inputs change,
they rebuild the entire selected service set at the newer commit before rollout.
A CN migration already running finishes first. If a commit arrives during an
atomic rollout, that rollout finishes and another release cycle follows.

Each cycle has one immutable source SHA. Images are regional: a successful
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

The script builds from a committed snapshot and verifies each ACR run.
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

Compare the selected services' image tags with the final source SHA printed by
the release. Ready old pods do not prove that ArgoCD has applied the new tags.
Then verify the affected signed-in UI/API workflows.

## 3. Build, back up, migrate and deploy CN

```bash
export DEPLOY_KEY="$HOME/.ssh/id_ed25519_fizzdragon_cn"
export KUBECONFIG="$HOME/.kube/config-fizzdragon-cn"

CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --allow-chart-update web server studio admin-ui
```

This automatically:

1. Builds and verifies every selected CN image and its digest.
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

Compare the selected services to the final receipt's source SHA and digests.
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
cause. A local CN lock prevents simultaneous releases in the same Git common
directory; coordinate operators using separate clones. .com and CN can run
concurrently because their registries and clusters are separate.
