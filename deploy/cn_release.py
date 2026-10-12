#!/usr/bin/env python3
"""CN release coordinator. State contains identifiers only, never credentials."""
import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from cn_registry import verify, safe_code, transient_code
from release_revision import latest_source, ToolingUpdated
from release_images import find as find_image

ROOT = Path(__file__).resolve().parent.parent
RDS = "pgm-1ud5k5e8ed864ld6"
REGION = "cn-hangzhou"


def run(*args, capture=False, env=None, input=None):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, text=True,
                            input=input, stdout=subprocess.PIPE if capture else None,
                            env=env, check=True)
    return result.stdout.strip() if capture else None


def read_json(*args):
    return json.loads(run(*args, capture=True))


def rds(action, **params):
    args = ["aliyun", "rds", action, "--DBInstanceId", RDS,
            "--RegionId", REGION, "--profile", "default"]
    for key, value in params.items():
        args += ["--" + key, str(value)]
    # Reads are idempotent; CreateBackup is not and must never be retried here.
    attempts = 4 if action in ("DescribeBackupTasks", "DescribeBackups") else 1
    for attempt in range(attempts):
        try:
            result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True,
                                    check=True, timeout=45)
            payload = json.loads(result.stdout)
            if not isinstance(payload, dict):
                raise ValueError("Expected an object")
            code = payload.get("Code")
            if code not in (None, 200, "200", "Success", "success"):
                if transient_code(str(code)):
                    raise ValueError("Transient RDS API response")
                raise RuntimeError(f"CN RDS {action} rejected: {safe_code(code)}; release state is saved")
            return payload
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError) as error:
            detail = str(getattr(error, "stderr", "") or "")
            denied = re.search(r"forbidden|accessdenied|invalidaccesskey|signaturedoesnotmatch|unauthorized|invalidparameter", detail, re.I)
            if denied or attempt + 1 == attempts:
                raise RuntimeError(f"CN RDS {action} failed after {attempt + 1} attempt(s); release state is saved. Check access/connectivity and resume.") from None
            delay = (2, 5, 10)[attempt]
            print(f"==> CN RDS {action}: transient read failure; retry {attempt + 2}/{attempts} in {delay}s", flush=True)
            time.sleep(delay)


def revision(value):
    tag = run("git", "rev-parse", "--verify", f"{value}^{{commit}}", capture=True)
    if not re.fullmatch(r"[0-9a-f]{40}", tag):
        raise RuntimeError("Invalid immutable revision")
    if not any(subprocess.run(["git", "merge-base", "--is-ancestor", tag, ref], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
               for ref in ("main", "origin/main")):
        raise RuntimeError("Release revision must belong to main or origin/main")
    return tag


def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write before each remote mutation so a timeout cannot lose its intent.
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class SourceUpdated(RuntimeError):
    pass


class ExpiredBackup(RuntimeError):
    pass


class BackupNotReady(RuntimeError):
    pass


def validate_backup(backup_id):
    rows = rds("DescribeBackups", BackupId=backup_id).get("Items", {}).get("Backup", [])
    if not rows:
        raise BackupNotReady(f"BackupId {backup_id} is not yet visible in the RDS backup catalogue")
    if len(rows) != 1 or str(rows[0].get("BackupId")) != str(backup_id):
        raise RuntimeError(f"RDS returned an unexpected backup for BackupId {backup_id}")
    backup = rows[0]
    if backup.get("BackupMode") != "Manual" or backup.get("BackupStatus") != "Success" or backup.get("IsAvail") != 1:
        raise RuntimeError(f"Backup {backup_id} is not a successful available manual backup")
    ended = dt.datetime.fromisoformat(backup["BackupEndTime"].replace("Z", "+00:00"))
    if not 0 <= (dt.datetime.now(dt.timezone.utc) - ended).total_seconds() <= 21600:
        raise ExpiredBackup(f"Backup {backup_id} expired; create a fresh backup before migration")
    return backup


def ensure_backup(state, persist, supplied=None):
    if supplied:
        validate_backup(supplied)
        state["backupId"] = supplied
        persist()
        return supplied
    if state.get("backupId"):
        try:
            validate_backup(state["backupId"])
            return state["backupId"]
        except ExpiredBackup:
            state.setdefault("previousBackupIds", []).append(state.pop("backupId"))
            state.pop("backupJobId", None)
            state.pop("backupRequested", None)
            persist()
    if state.get("backupRequested") and not state.get("backupJobId"):
        # CreateBackup has no idempotency token. Do not duplicate an uncertain request.
        raise RuntimeError("Backup request outcome is unknown. Find its completed BackupId in RDS and resume with --backup-id; no second backup was requested")
    if not state.get("backupJobId"):
        state["backupRequested"] = True
        persist()
        print("==> creating manual CN RDS backup", flush=True)
        response = rds("CreateBackup", BackupMethod="Physical")
        job_id = str(response.get("BackupJobId", ""))
        if not job_id.isdigit():
            raise RuntimeError("CreateBackup did not return a BackupJobId")
        state["backupJobId"] = job_id
        persist()
    deadline = time.monotonic() + 3600
    while time.monotonic() < deadline:
        rows = rds("DescribeBackupTasks", BackupJobId=state["backupJobId"]).get("Items", {}).get("BackupJob", [])
        rows = [b for b in rows if str(b.get("BackupJobId")) == state["backupJobId"]]
        if len(rows) > 1:
            raise RuntimeError("Ambiguous RDS backup task response")
        if rows:
            task = rows[0]
            if task.get("BackupStatus") == "Failed":
                raise RuntimeError("RDS manual backup failed; inspect the backup task before retrying")
            if task.get("BackupStatus") == "Finished" and task.get("BackupId"):
                backup_id = str(task["BackupId"])
                try:
                    validate_backup(backup_id)
                except BackupNotReady:
                    print(f"==> backup job finished; waiting for BackupId {backup_id} to appear in the RDS backup catalogue", flush=True)
                    time.sleep(15)
                    continue
                state["backupId"] = backup_id
                persist()
                print(f"==> verified completed BackupId {backup_id}", flush=True)
                return backup_id
        print(f"==> waiting for RDS backup job {state['backupJobId']}", flush=True)
        time.sleep(15)
    raise RuntimeError("Backup wait timed out; resume to keep waiting for the same backup job")


def kubectl(*args, capture=False):
    return run("kubectl", *args, capture=capture)


def cluster_server():
    return kubectl("config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}", capture=True)


def get_job(name, namespace):
    value = kubectl("get", "job", name, "-n", namespace, "--ignore-not-found", "-o", "json", capture=True)
    return json.loads(value) if value else None


def job_state(job, image, tag):
    metadata = job.get("metadata", {})
    containers = job.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
    if len(containers) != 1 or containers[0].get("image") != image or containers[0].get("command") != ["npm", "run", "db:deploy"] or metadata.get("labels", {}).get("fizzdragon.com/revision") != tag or not metadata.get("annotations", {}).get("fizzdragon.com/rds-backup-id"):
        raise RuntimeError("Existing migration job does not match the pinned release and backup audit")
    conditions = job.get("status", {}).get("conditions", [])
    if any(c.get("type") == "Complete" and c.get("status") == "True" for c in conditions):
        return "complete"
    if any(c.get("type") == "Failed" and c.get("status") == "True" for c in conditions):
        raise RuntimeError("Migration job failed. Inspect its logs and database state; automatic deletion/re-execution is disabled")
    return "active"


@contextlib.contextmanager
def chart_snapshot(tag):
    with tempfile.TemporaryDirectory(prefix="fizz-cn-chart-") as directory:
        archive = Path(directory) / "chart.tar"
        run("git", "archive", tag, "deploy/helm/fizzdragon", "-o", archive)
        run("tar", "-xf", archive, "-C", directory)
        yield Path(directory) / "deploy/helm/fizzdragon"


def migration(tag, backup_id=None, state=None, persist=None, render_only=False, before_create=None):
    image_tag = (state or {}).get("imageTags", {}).get("server", tag)
    namespace = os.environ.get("CN_NAMESPACE", "fizzdragon")
    release = os.environ.get("CN_RELEASE", "fizzdragon")
    name = f"{release}-db-migrate-{tag}"[:63].rstrip("-")
    run(ROOT / "deploy/cn-preflight.sh", "--phase", "migration", "--tag", tag, "server")
    with chart_snapshot(tag) as chart:
        def render(backup):
            return run("helm", "template", release, chart, "--namespace", namespace,
                       "-f", chart / "values.yaml", "-f", chart / "values.cn-prod.yaml",
                       "--show-only", "templates/server-migration-job.yaml",
                       "--set-string", f"server.image.tag={image_tag}",
                       "--set", "server.migrationJob.enabled=true",
                       "--set-string", f"server.migrationJob.revision={tag}",
                       "--set-string", f"server.migrationJob.backupId={backup}", capture=True)
        if render_only:
            print(render(backup_id or "render-only-unverified"))
            return
        if os.environ.get("CONFIRM_CN_PROD_MIGRATION") != "YES":
            raise RuntimeError("Set CONFIRM_CN_PROD_MIGRATION=YES to authorize production migrations")
        # Resolve the exact image from this revision's chart, not today's checkout.
        rendered = render(backup_id or "pending")
        image_match = re.search(r'^\s+image:\s*"([^"\n]+)"', rendered, re.M)
        if not image_match or not image_match[1].endswith(f"/fizzdragon-server:{image_tag}"):
            raise RuntimeError("Unexpected migration image in pinned chart")
        image = image_match[1]
        existing = get_job(name, namespace)
        if existing and job_state(existing, image, tag) == "complete":
            print(f"==> migration already completed: {name}", flush=True)
            return
        verified_digest = verify(image_tag, ["server"])["server"]
        expected_digest = (state or {}).get("digests", {}).get("server")
        if expected_digest and verified_digest != expected_digest:
            raise RuntimeError("Server image changed before migration; refusing to execute it")
        if not existing:
            if state is not None:
                backup_id = ensure_backup(state, persist, backup_id)
            elif backup_id:
                validate_backup(backup_id)
            else:
                raise RuntimeError("CN_RDS_BACKUP_ID is required for standalone migration")
            if before_create and before_create():
                raise SourceUpdated("Source advanced before migration creation")
            # Creation is atomic. If another operator wins, stop and resume against its job.
            kubectl_input = render(backup_id)
            run("kubectl", "create", "-f", "-", input=kubectl_input)
        print(f"==> waiting for migration job {name} (resume reattaches, never deletes)", flush=True)
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            current = get_job(name, namespace)
            if not current:
                raise RuntimeError("Migration job disappeared; investigate before retrying")
            if job_state(current, image, tag) == "complete":
                break
            time.sleep(10)
        else:
            raise RuntimeError(f"Migration wait timed out. Inspect kubectl -n {namespace} describe job {name}; resume the same release")
        print(f"DONE: migrations completed for {tag}", flush=True)


def extend_services(state, additions):
    if not additions:
        return
    allowed = {"web", "server", "studio", "admin-ui", "agent-os", "game-agent", "app-story-agent"}
    if not set(additions) <= allowed:
        raise RuntimeError("Invalid added service")
    if set(additions) <= set(state["services"]):
        return
    if state.get("complete") or state.get("built") or state.get("backupRequested") or state.get("backupId") or state.get("backupJobId"):
        raise RuntimeError("Service additions require a pre-build receipt; finish this release, then start a new six-service release")
    state["services"] = sorted(set(state["services"]) | set(additions))
    state.pop("imageTags", None)
    state.pop("digests", None)
    state["useExistingImages"] = False


def release(args):
    run("git", "diff", "--exit-code", "--quiet")
    run("git", "diff", "--cached", "--exit-code", "--quiet")
    git_dir = Path(run("git", "rev-parse", "--path-format=absolute", "--git-common-dir", capture=True))
    directory = git_dir / "fizzdragon-releases"
    directory.mkdir(exist_ok=True)
    path = directory / "cn.json"
    # OS lock is released on exit/crash. Never delete another process's lock.
    with (directory / "cn.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another CN release is running from this repository") from None
        if getattr(args, "add_service", None) and not args.resume:
            raise RuntimeError("--add-service requires --resume")
        previous = json.loads(path.read_text()) if path.exists() else None
        if args.resume:
            if not previous:
                raise RuntimeError("No CN release receipt exists to resume")
            state = previous
            if args.services and sorted(args.services) != sorted(state["services"]):
                raise RuntimeError("Resume must use the original service set")
            if args.tag and revision(args.tag) != state["tag"]:
                raise RuntimeError("Resume must use the pinned revision")
        else:
            if previous and not previous.get("complete"):
                raise RuntimeError("An unfinished CN release exists. Use --resume; its pinned revision is " + previous["tag"])
            services = args.services or ["web", "server", "studio", "admin-ui"]
            if any(s not in ("web", "server", "studio", "admin-ui", "agent-os", "game-agent", "app-story-agent") for s in services):
                raise RuntimeError("Invalid service set")
            state = {"version": 1, "tag": revision(args.tag or "HEAD"), "services": sorted(set(services)),
                     "namespace": os.environ.get("CN_NAMESPACE", "fizzdragon"),
                     "release": os.environ.get("CN_RELEASE", "fizzdragon"),
                     "context": kubectl("config", "current-context", capture=True),
                     "clusterServer": cluster_server(),
                     "useExistingImages": bool(args.use_existing_images)}
            save(path, state)
        if state.get("complete"):
            extend_services(state, getattr(args, "add_service", None))
            print(f"DONE: saved CN release {state['tag']} already completed; no deployment repeated")
            return
        if "server" in (set(state["services"]) | set(getattr(args, "add_service", None) or [])) and os.environ.get("CONFIRM_CN_PROD_MIGRATION") != "YES":
            raise RuntimeError("Set CONFIRM_CN_PROD_MIGRATION=YES for the automated backup/migration workflow")
        # Refuse accidental resume against another cluster, namespace or Helm release.
        if state.get("clusterServer") != cluster_server() or state.get("version") != 1 or state["namespace"] != os.environ.get("CN_NAMESPACE", "fizzdragon") or state["release"] != os.environ.get("CN_RELEASE", "fizzdragon") or state["context"] != kubectl("config", "current-context", capture=True):
            raise RuntimeError("Release target differs from the saved receipt")
        extend_services(state, getattr(args, "add_service", None))
        persist = lambda: save(path, state)
        persist()
        run_cycles(state, args, persist)


def run_cycles(state, args, persist):
    """Finish an existing migration before changing the receipt's source."""
    for cycle in range(10):
        tag = revision(state["tag"])
        services = state["services"]
        def checkpoint():
            candidate = latest_source(ROOT, tag, cn=True, require_current_tooling=True)
            if candidate == tag:
                return False
            if state.get("backupRequested") and not state.get("backupJobId") and not state.get("backupId"):
                raise RuntimeError("Backup request outcome is unknown; resolve its BackupId before changing release source")
            history = state.get("previousCycles", [])
            history.append({k: v for k, v in state.items() if k != "previousCycles"})
            keep = {k: state[k] for k in ("version", "services", "namespace", "release", "context", "clusterServer")}
            state.clear()
            state.update(keep, tag=candidate, previousCycles=history, useExistingImages=False)
            persist()
            return True

        # A crash can happen immediately after job creation, before any receipt
        # update. Inspect its deterministic name before discarding the old source.
        if "server" in services:
            name = f"{state['release']}-db-migrate-{tag}"[:63].rstrip("-")
            if get_job(name, state["namespace"]):
                migration(tag, args.backup_id, state, persist)
        if checkpoint():
            continue
        print(f"==> CN release cycle {cycle + 1}: {tag}", flush=True)
        def verify_images():
            tags = state.get("imageTags", {})
            return {service: verify(tags.get(service, tag), [service])[service] for service in services}

        if not state.get("built"):
            tags, reused_digests, missing = {}, {}, []
            for service in services:
                existing = None if state.get("useExistingImages", False) else find_image(ROOT, tag, 'cn', service)
                tags[service] = existing['tag'] if existing else tag
                if existing:
                    reused_digests[service] = existing['digest']
                    print(f"==> reusing CN {service}:{existing['tag']} ({existing['digest']}); no build", flush=True)
                elif not state.get("useExistingImages", False):
                    missing.append(service)
            state["imageTags"] = tags
            persist()
            if missing:
                run(ROOT / "deploy/deploy-cn-services.sh", "--tag", tag, "--full", "--build-only", *missing,
                    env={**os.environ, "CN_RELEASE_BUILD_PLANNED": "1"})
            state["digests"] = verify_images()
            if any(state["digests"][service] != value for service, value in reused_digests.items()):
                raise RuntimeError("Reused image digest changed while preparing release")
            state["built"] = True
            persist()
        elif verify_images() != state["digests"]:
            raise RuntimeError("Pinned image digests changed; refusing to deploy overwritten tags")
        if checkpoint():
            continue
        if "server" in services:
            try:
                migration(tag, args.backup_id, state, persist, before_create=checkpoint)
            except SourceUpdated:
                continue
        # Never interrupt migration for a new commit. Rebuild only after it ends.
        if checkpoint():
            continue
        if verify_images() != state["digests"]:
            raise RuntimeError("Pinned image digests changed during migration; refusing deployment")
        deploy_args = [ROOT / "deploy/deploy-cn-services.sh", "--tag", tag, "--deploy-only"]
        if args.allow_chart_update:
            deploy_args.append("--allow-chart-update")
        try:
            run(*deploy_args, *services, env={**os.environ, "CN_RELEASE_COORDINATED": "1",
                "CN_RELEASE_IMAGE_TAGS": json.dumps(state.get("imageTags", {})),
                "CN_RELEASE_IMAGE_DIGESTS": json.dumps(state["digests"])})
        except subprocess.CalledProcessError as error:
            if error.returncode != 75:
                raise
            if not checkpoint():
                raise RuntimeError("Release inputs changed at rollout; retry the release") from error
            continue
        # An atomic Helm upgrade already underway is allowed to finish too.
        # A commit arriving during it gets a subsequent complete cycle.
        if checkpoint():
            continue
        state["complete"] = True
        persist()
        print(f"DONE: CN release {tag} verified for selected services: {', '.join(services)}", flush=True)
        return
    raise RuntimeError("Ten source updates interrupted this release; resume when commits settle")


def validate_checkout():
    """Reject local preflight failures before acquiring the regional lock."""
    inherited = os.environ.get("CN_RELEASE_TOOLING_CHECKOUT")
    if inherited:
        if run("git", "rev-parse", "HEAD", capture=True) != inherited or revision(inherited) != inherited:
            raise RuntimeError("Invalid inherited CN tooling checkout")
    elif run("git", "branch", "--show-current", capture=True) != "main":
        raise RuntimeError("Start the CN release from main")
    try:
        run("git", "diff", "--quiet")
        run("git", "diff", "--cached", "--quiet")
    except subprocess.CalledProcessError as error:
        if error.returncode != 1:
            raise
        raise RuntimeError("CN release requires a clean tracked checkout; commit or stash local changes and retry") from error


@contextlib.contextmanager
def stable_checkout(tooling_revision=None):
    """Freeze runtime tooling too; the operator's checkout may advance freely."""
    global ROOT
    original = ROOT
    validate_checkout()
    tooling_sha = revision(tooling_revision) if tooling_revision else run("git", "rev-parse", "HEAD", capture=True)
    with tempfile.TemporaryDirectory(prefix="fizz-cn-tooling-") as directory:
        checkout = Path(directory) / "checkout"
        run("git", "worktree", "add", "--detach", checkout, tooling_sha)
        try:
            if (original / "node_modules").exists():
                (checkout / "node_modules").symlink_to(original / "node_modules", target_is_directory=True)
            ROOT = checkout
            yield
        finally:
            ROOT = original
            run("git", "worktree", "remove", "--force", checkout)


def resume_with_updated_tooling(args, tooling_revision):
    if args.action != "release":
        raise RuntimeError("Resume the release to load updated deployment tooling")
    depth = int(os.environ.get("CN_RELEASE_TOOLING_RESTARTS", "0"))
    if depth >= 5:
        raise RuntimeError("Deployment tooling changed five times; resume when commits settle")
    print(f"==> reloading CN deployment tooling at {tooling_revision}; saved images and migration receipt retained", flush=True)
    with stable_checkout(tooling_revision):
        command = [sys.executable, ROOT / "deploy/cn_release.py", "release", "--resume"]
        if args.allow_chart_update:
            command.append("--allow-chart-update")
        if args.backup_id:
            command += ["--backup-id", args.backup_id]
        run(*command, env={**os.environ, "CN_RELEASE_TOOLING_CHECKOUT": tooling_revision,
                          "CN_RELEASE_TOOLING_RESTARTS": str(depth + 1)})


def main():
    os.environ.setdefault("KUBECONFIG", str(Path.home() / ".kube/config-fizzdragon-cn"))
    os.environ.setdefault("DEPLOY_KEY", str(Path.home() / ".ssh/id_ed25519_fizzdragon_cn"))
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("release")
    p.add_argument("--tag")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--add-service", action="append", default=[], help="Add a service to an unfinished pre-build resume receipt")
    p.add_argument("--use-existing-images", action="store_true", help="Verify and reuse all selected images at the pinned tag without building")
    p.add_argument("--allow-chart-update", action="store_true")
    p.add_argument("--backup-id", help="Completed manual BackupId for recovery, not BackupJobId")
    p.add_argument("services", nargs="*")
    p = sub.add_parser("migrate")
    p.add_argument("--tag", default="HEAD")
    p.add_argument("--render-only", action="store_true")
    args = parser.parse_args()
    # Protect direct Python/migration entry points as well as release-cn.sh.
    if not (args.action == "migrate" and args.render_only):
        from release_lock import Lock
        owner = os.environ.get("FD_REGIONAL_LOCK_CN")
        if not owner:
            validate_checkout()
            if args.action == "release" and not args.use_existing_images:
                run(sys.executable, ROOT / "deploy/cn_ssh_access.py",
                    os.environ.get("CN_BUILD_ECS_ID", "i-bp11r90r4g91u39iimnx"), "--required")
            os.execv(sys.executable, [sys.executable, str(ROOT / "deploy/release_lock.py"),
                                     "cn", "--", sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])
        Lock("cn").check(owner)
    try:
        with stable_checkout():
            if args.action == "release":
                release(args)
            else:
                migration(revision(args.tag), os.environ.get("CN_RDS_BACKUP_ID"), render_only=args.render_only)
    except ToolingUpdated as update:
        # The local receipt lock and old tooling worktree have been released.
        # Keep the shared regional lock, and load all Python modules afresh.
        resume_with_updated_tooling(args, update.revision)

if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"FATAL: {error}", file=sys.stderr)
        sys.exit(1)
