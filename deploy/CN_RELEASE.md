# CN releases

Choose one source commit for a release. The `.com` script builds that commit,
then creates a separate GitOps commit containing image tags. That later commit
is not a CN image tag. Do not derive the source revision using `HEAD~1`.

After the deployment scripts are committed, run from a clean `main` checkout:

```bash
export DEPLOY_KEY="$HOME/.ssh/id_ed25519_fizzdragon_cn"
export KUBECONFIG="$HOME/.kube/config-fizzdragon-cn"
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --allow-chart-update web server studio admin-ui
```

The coordinator records the source SHA once, builds regional images, checks ACR
image digests, creates and waits for a manual RDS backup, runs the migration,
and deploys the pinned chart and images. Use `--tag FULL_SOURCE_SHA` to select an
existing source revision explicitly. It must belong to local `main` history.
By default this builds the selected images. To reuse an already successful CN
build, add `--use-existing-images --tag FULL_SOURCE_SHA`. Every selected image
must exist and pass verification before backup or migration; missing images
stop the release without silently rebuilding or selecting another tag.

If interrupted or a step fails:

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --resume --allow-chart-update
```

The receipt is stored under Git's common directory in
`fizzdragon-releases/cn.json`, outside tracked source. Resume preserves its
revision and services, verifies the cluster target and image digests, and
reattaches to an active migration job. A completed receipt is not redeployed.
A partial image-build failure rebuilds the selected service set on resume.
The local lock prevents concurrent runs sharing the same Git common directory;
coordinate operators using separate clones.

RDS returns a **BackupJobId** when a backup starts. The coordinator resolves
that job to a completed **BackupId**. A new migration requires an available
manual backup completed within six hours. An expired saved backup is renewed.
If a backup request's outcome is unknown, no duplicate is created automatically:
find its completed BackupId in RDS and resume with `--backup-id BACKUP_ID`.

A failed migration stops for investigation; the coordinator never deletes and
reruns it automatically. Registry verification establishes image availability,
not cluster pull authorization or connectivity. An image-pull failure still
requires inspecting the pod events and correcting the cluster's access.

For separate steps, pass the **same explicit `--tag FULL_SOURCE_SHA`** to
`deploy-cn-services.sh --full --build-only`, `run-cn-migrations.sh`, and
`deploy-cn-services.sh --deploy-only`. Standalone migration also requires
`CN_RDS_BACKUP_ID` and `CONFIRM_CN_PROD_MIGRATION=YES`.

The flow uses the configured Aliyun `default` profile for CN ECS, ACR and RDS.
The ACR checks use its control-plane API and need read permissions for
`ListRepository` and `GetRepoTag`; no public registry ingress is required.

## Routine release: first step through final verification

Use a clean checkout with these deployment scripts committed. Do not stash or
reset unrelated work to satisfy preflight. Select the services from the actual
changes, including shared-package dependencies. Frontend-first deployment is
appropriate only when it remains compatible with the currently running backend;
otherwise migrate and deploy the backend first.

### 1. Update main and record the source revision

```bash
git checkout main &&
git pull --ff-only origin main &&
export FD_SOURCE_SHA="$(git rev-parse HEAD)"
```

Keep this full SHA in the release record. A source SHA identifies the code;
an image is identified by region, service, tag and digest. Building Web/Studio
does not create Server/Admin UI images. Different services may legitimately use
different source SHAs when their code and dependencies have not changed.

### 2. Publish .com images, if .com is part of this release

For a four-service change:

```bash
test "$(git rev-parse HEAD)" = "$FD_SOURCE_SHA" &&
deploy/deploy-com-aks.sh web server studio admin-ui
```

For a Web/Studio-only change, select `web studio` instead. The script builds
Azure images and commits their tags for ArgoCD. Its resulting GitOps commit is
not a newly built image. Do not overwrite `FD_SOURCE_SHA` with that newer HEAD.
CN images are built separately with regional configuration.

Check the actual .com rollout using an authorized AKS context. For example,
if Isaac has provisioned the `aks-fizzdragon-com-admin` context:

```bash
export KUBECONFIG="$HOME/.kube/config"
kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com \
  get deployments -o 'custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image'
for service in web server studio admin-ui; do
  kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com \
    rollout status "deployment/fizzdragon-$service" --timeout=300s || break
done
```

Restrict the verification loop to the services deployed. Missing contexts or
Azure authorization failures require correcting access; image-build success
alone does not establish that ArgoCD rolled out the new version.

### 3. Configure CN access

```bash
export DEPLOY_KEY="$HOME/.ssh/id_ed25519_fizzdragon_cn"
export KUBECONFIG="$HOME/.kube/config-fizzdragon-cn"
```

Use the private SSH key, not its `.pub` file. The Aliyun profile, ACR credentials,
ACK access and build-ECS SSH allowlist must be provisioned. A failed connection
must be resolved before retrying; it does not justify changing the source SHA.

### 4. Build, back up, migrate and deploy CN

For a new four-service build, the coordinator performs the steps in order:

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --tag "$FD_SOURCE_SHA" --allow-chart-update web server studio admin-ui
```

It verifies selected images **before** requesting a backup or creating a
migration job. When Server is selected, it creates a manual RDS backup, waits
for its completed BackupId, migrates using the Server image at the pinned SHA,
and then deploys. A frontend-only selection skips backup and migration.

To reuse images already built for the selected services:

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --tag "$FD_SOURCE_SHA" --use-existing-images \
  --allow-chart-update web server studio admin-ui
```

Do not use this four-service command when only Web/Studio were built. For the
split release pattern used on 8 October 2026, the two verified revisions were:

```bash
export FD_FRONTEND_SHA=19ea4856746c45c7aed0e88af43cac58ab7e8b52
export FD_BACKEND_SHA=efb4790081c8fc239f9ecc3e896416cfa0ae4b21

deploy/release-cn.sh --tag "$FD_FRONTEND_SHA" --use-existing-images \
  --allow-chart-update web studio &&
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh \
  --tag "$FD_BACKEND_SHA" --use-existing-images \
  --allow-chart-update server admin-ui
```

These are historical example SHAs, not defaults for future updates. Choose
future tags from actual build output and registry verification. Reusing an older
backend requires checking its source, migrations and shared/build dependencies
against the intended release. Each invocation preserves the other services'
live image tags. Helm still applies the pinned chart to the entire release;
review the displayed configuration diff when allowing chart updates.

### 5. Resume a failure using its saved receipt

```bash
CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --resume --allow-chart-update
```

Run this from the same repository as the failed invocation. Do not start the
next service group until the previous group has completed. The receipt retains
whether existing images were selected, even when the retry omits that option.
Image digests are checked again after migration and before rollout.

### 6. Verify the deployed version and user flows

```bash
kubectl -n fizzdragon get deployments \
  -o 'custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image'
for service in web server studio admin-ui; do
  kubectl -n fizzdragon rollout status "deployment/fizzdragon-$service" \
    --timeout=300s || break
done
```

Compare each selected service's image tag to its recorded source SHA. Inspect
migration completion when Server was included, then exercise the affected
signed-in workflows in the relevant region. Helm/Pod readiness is infrastructure
verification; it does not replace UI and API acceptance. Record the source SHAs,
image digests, backup ID, migration result and acceptance results together.
