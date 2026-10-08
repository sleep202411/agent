"""Production release regressions; every cloud, build and database operation is simulated."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

DIRECTORY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("deploy_production", DIRECTORY / "deploy-production.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
DIGEST = "sha256:" + "a" * 64
NEXT_DIGEST = "sha256:" + "b" * 64
SOURCE = "c" * 40


def workloads():
    result = {}
    for service in deploy.SERVICES:
        env = [{"name": "KEEP_FIXTURE", "value": "preserved"}]
        if service in ("server", "agent-os"):
            key, secret = (("DATABASE_URL", "fizzdragon-secrets") if service == "server" else
                           ("AGENT_OS_CHECKPOINT_DATABASE_URL", "fizzdragon-agent-os-secrets"))
            env.append({"name": key, "valueFrom": {"secretKeyRef": {
                "name": secret, "key": key, "optional": False}}})
        if service == "server":
            env += [{"name": key, "value": "true"} for key in
                    ("BACKGROUND_TASKS_ENABLED", "AGENT_OS_ENABLED", "GAME_AGENT_ENABLED")]
        container = {"name": service, "image": deploy.pinned_image(service, DIGEST), "env": env,
                     "envFrom": [{"configMapRef": {"name": "existing-config"}}],
                     "resources": {"requests": {"memory": "128Mi"}},
                     "securityContext": {"runAsNonRoot": True}}
        pod = {"containers": [container], "imagePullSecrets": [{"name": "existing-pull"}],
               "nodeSelector": {"role": "app"}, "tolerations": [{"key": "fixture"}],
               "securityContext": {"fsGroup": 1001},
               "volumes": [{"name": "workspace", "persistentVolumeClaim": {"claimName": deploy.PVC}}]}
        if service == "server":
            pod["initContainers"] = [
                {"name": "unrelated-init", "image": "fixture/unrelated:keep", "command": ["keep"]},
                {"name": "db-migrate", "image": deploy.pinned_image(service, DIGEST),
                 "command": ["keep-migration-command"], "env": [{"name": "KEEP", "value": "yes"}]},
            ]
        if service == "game-agent":
            container["volumeMounts"] = [{"name": "workspace", "mountPath": "/var/lib/game-agent/workspaces"}]
        result[service] = {"metadata": {"name": "fizzdragon-" + service, "uid": service + "-uid",
                            "resourceVersion": "7", "generation": 1},
                           "spec": {"replicas": 1, "strategy": {"type": "Recreate"},
                                    "template": {"metadata": {"labels": {"keep": "yes"}},
                                                                    "spec": pod}},
                           "status": {"observedGeneration": 1, "replicas": 1, "readyReplicas": 1,
                                      "updatedReplicas": 1, "availableReplicas": 1}}
    return result


class FakeKube:
    """A strict in-memory API: any Secret read or unexpected operation fails the test."""
    def __init__(self):
        self.deployments = workloads()
        self.namespace = {"metadata": {"name": "fizzdragon", "uid": deploy.NS_UID},
                          "status": {"phase": "Active"}}
        self.pvc = {"metadata": {"uid": deploy.PVC_UID}, "status": {"phase": "Bound"}}
        self.calls, self.jobs = [], {}
        self.dry_run_failure = self.rollout_failure = None
        self.job_conditions = [{"type": "Complete", "status": "True"}]
        self.before_read = None
        self.deployment_reads = 0
        self.denied_permissions = set()

    def __call__(self, args, data=None, timeout=45):
        self.calls.append((copy.deepcopy(args), data, timeout))
        if args[:2] == ["auth", "can-i"]:
            return "no\n" if tuple(args[2:]) in self.denied_permissions else "yes\n"
        if args[0] == "get":
            if args[1:3] == ["namespace", "fizzdragon"]:
                return json.dumps(self.namespace)
            if args[1] == "deployment":
                self.deployment_reads += 1
                if self.before_read:
                    self.before_read(self, self.deployment_reads)
                return json.dumps({"items": list(self.deployments.values())})
            if args[1:3] == ["pvc", deploy.PVC]:
                return json.dumps(self.pvc)
            if args[1] == "job" and args[2] in self.jobs:
                return json.dumps({"status": {"conditions": self.job_conditions}})
            raise AssertionError("Unexpected metadata/Secret read: " + repr(args))
        if args[:2] == ["patch", "deployment"]:
            service = args[2].removeprefix("fizzdragon-")
            obj = self.deployments[service]
            operations = json.loads(args[args.index("-p") + 1])
            for operation in operations[:2]:
                key = operation["path"].split("/")[-1]
                if obj["metadata"][key] != operation["value"]:
                    raise deploy.DeployError("Concurrent JSON patch precondition failed")
            if "--dry-run=server" in args:
                if service == self.dry_run_failure:
                    raise deploy.DeployError("Simulated API dry-run rejection")
                return "deployment/" + args[2]
            for operation in operations[2:]:
                path = operation["path"]
                if path == "/spec/template/spec/containers/0/image":
                    obj["spec"]["template"]["spec"]["containers"][0]["image"] = operation["value"]
                elif path.startswith("/spec/template/spec/initContainers/") and path.endswith("/image"):
                    index = int(path.split("/")[5])
                    obj["spec"]["template"]["spec"]["initContainers"][index]["image"] = operation["value"]
                else:
                    raise AssertionError("Unexpected non-image mutation: " + path)
            obj["metadata"]["resourceVersion"] = str(int(obj["metadata"]["resourceVersion"]) + 1)
            obj["metadata"]["generation"] += 1
            obj["status"]["observedGeneration"] = obj["metadata"]["generation"]
            return "deployment/" + args[2]
        if args[:2] == ["rollout", "status"]:
            if args[2] == "deployment/fizzdragon-" + str(self.rollout_failure):
                raise deploy.DeployError("Simulated rollout failure")
            return "ready"
        if args[:3] == ["create", "-f", "-"]:
            job = json.loads(data)
            self.jobs[job["metadata"]["name"]] = job
            return "job/" + job["metadata"]["name"]
        if args[:2] == ["delete", "job"] and args[2] in self.jobs:
            del self.jobs[args[2]]
            return "deleted"
        raise AssertionError("Unexpected CLI/mutation: " + repr(args))

    def patches(self, dry_run=False):
        return [args for args, _, _ in self.calls if args[0] == "patch"
                and ("--dry-run=server" in args) == dry_run]


class DeployProductionTest(unittest.TestCase):
    def setUp(self):
        self.kube = FakeKube()
        self.output = io.StringIO()
        self.stdout = contextlib.redirect_stdout(self.output)
        self.stderr = contextlib.redirect_stderr(self.output)
        self.stdout.__enter__(); self.stderr.__enter__()
        self.addCleanup(self.stdout.__exit__, None, None, None)
        self.addCleanup(self.stderr.__exit__, None, None, None)
        # Importing the implementation is harmless; no test may invoke a real CLI.
        guard = patch.object(deploy.subprocess, "run", side_effect=AssertionError("Real process forbidden"))
        guard.start(); self.addCleanup(guard.stop)

    def baseline(self):
        return deploy.verify_live(self.kube)

    def test_valid_live_inventory_reads_no_secrets(self):
        self.assertEqual(set(self.baseline()), set(deploy.SERVICES))
        self.assertEqual([args[:2] for args, _, _ in self.kube.calls],
                         [["get", "namespace"], ["get", "deployment"], ["get", "pvc"]])

    def test_namespace_and_workspace_identity_phase_and_deletion_are_checked(self):
        changes = [
            ("namespace", ("metadata", "uid"), "wrong"),
            ("namespace", ("status", "phase"), "Terminating"),
            ("namespace", ("metadata", "deletionTimestamp"), "fixture"),
            ("pvc", ("metadata", "uid"), "wrong"),
            ("pvc", ("status", "phase"), "Pending"),
            ("pvc", ("metadata", "deletionTimestamp"), "fixture"),
        ]
        for resource, path, value in changes:
            with self.subTest(resource=resource, path=path):
                fake = FakeKube(); getattr(fake, resource)[path[0]][path[1]] = value
                with self.assertRaises(deploy.DeployError): deploy.verify_live(fake)
                self.assertFalse(fake.patches())

    def test_six_workload_inventory_is_exact_including_no_duplicates_or_legacy(self):
        for mode in ("missing", "legacy", "duplicate"):
            with self.subTest(mode=mode):
                fake = FakeKube()
                if mode == "missing": del fake.deployments["web"]
                elif mode == "legacy": fake.deployments["web"]["metadata"]["name"] = "fizzdragon-agent"
                else: fake.deployments["duplicate"] = copy.deepcopy(fake.deployments["web"])
                with self.assertRaisesRegex(deploy.DeployError, "six production"): deploy.verify_live(fake)

    def test_all_live_readiness_fields_and_observed_generation_are_required(self):
        for field in ("replicas", "readyReplicas", "updatedReplicas", "availableReplicas", "observedGeneration"):
            with self.subTest(field=field):
                fake = FakeKube(); fake.deployments["studio"]["status"][field] = 0
                with self.assertRaisesRegex(deploy.DeployError, "fully ready"): deploy.verify_live(fake)
        self.kube.deployments["server"]["spec"]["replicas"] = 0
        with self.assertRaisesRegex(deploy.DeployError, "fully ready"): self.baseline()

    def test_workload_structure_and_duplicate_environment_are_rejected(self):
        changes = [lambda x: x["metadata"].pop("uid"),
                   lambda x: x["metadata"].pop("resourceVersion"),
                   lambda x: x["metadata"].update(deletionTimestamp="fixture"),
                   lambda x: x["spec"]["template"]["spec"]["containers"][0].update(name="wrong"),
                   lambda x: x["spec"]["template"]["spec"]["containers"].append({"name": "sidecar"}),
                   lambda x: x["spec"]["template"]["spec"]["containers"][0]["env"].append(
                       {"name": "KEEP_FIXTURE", "value": "duplicate"})]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                fake = FakeKube(); change(fake.deployments["web"])
                with self.assertRaises(deploy.DeployError): deploy.verify_live(fake)

    def test_canonical_database_references_and_enabled_flags_are_required(self):
        for service, key in (("server", "DATABASE_URL"), ("agent-os", "AGENT_OS_CHECKPOINT_DATABASE_URL")):
            for field, value in (("name", "snapshot"), ("key", "OTHER"), ("optional", True)):
                with self.subTest(service=service, field=field):
                    fake = FakeKube(); env = fake.deployments[service]["spec"]["template"]["spec"]["containers"][0]["env"]
                    next(x for x in env if x["name"] == key)["valueFrom"]["secretKeyRef"][field] = value
                    with self.assertRaisesRegex(deploy.DeployError, "canonical"): deploy.verify_live(fake)
        for key in ("BACKGROUND_TASKS_ENABLED", "AGENT_OS_ENABLED", "GAME_AGENT_ENABLED"):
            with self.subTest(flag=key):
                fake = FakeKube(); env = fake.deployments["server"]["spec"]["template"]["spec"]["containers"][0]["env"]
                next(x for x in env if x["name"] == key)["value"] = "false"
                with self.assertRaisesRegex(deploy.DeployError, "enabled"): deploy.verify_live(fake)

    def test_harness_uses_existing_writable_workspace_mount_with_single_recreate_replica(self):
        def change_claim(obj):
            obj["spec"]["template"]["spec"]["volumes"][0]["persistentVolumeClaim"]["claimName"] = "other-volume"
        def change_mount(obj, field, value):
            obj["spec"]["template"]["spec"]["containers"][0]["volumeMounts"][0][field] = value
        def multiple_replicas(obj):
            obj["spec"]["replicas"] = 2
            obj["status"].update({key: 2 for key in ("replicas", "readyReplicas", "updatedReplicas", "availableReplicas")})
        changes = [change_claim, multiple_replicas,
                   lambda x: x["spec"]["strategy"].update(type="RollingUpdate"),
                   lambda x: x["spec"]["template"]["spec"].update(volumes=[]),
                   lambda x: x["spec"]["template"]["spec"]["containers"][0].update(volumeMounts=[]),
                   lambda x: change_mount(x, "name", "different-volume"),
                   lambda x: change_mount(x, "mountPath", "/wrong/path"),
                   lambda x: change_mount(x, "readOnly", True)]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                fake = FakeKube(); change(fake.deployments["game-agent"])
                with self.assertRaises(deploy.DeployError): deploy.verify_live(fake)
                self.assertFalse(fake.patches())

    def test_only_exact_service_repository_and_immutable_lowercase_digest_are_accepted(self):
        expected = deploy.pinned_image("web", DIGEST)
        self.assertEqual(deploy.pinned_image("web", expected), expected)
        for value in ("latest", "sha256:" + "a" * 63, "sha256:" + "A" * 64,
                      expected.replace("fizzdragon-web@", "fizzdragon-studio@"),
                      expected.replace("registry-vpc", "registry"), expected + "?tag=latest"):
            with self.subTest(value=value), self.assertRaises(deploy.DeployError):
                deploy.pinned_image("web", value)
        with self.assertRaises(deploy.DeployError): deploy.pinned_image("agent", DIGEST)
        self.kube.deployments["web"]["spec"]["template"]["spec"]["containers"][0]["image"] = "repo:latest"
        with self.assertRaises(deploy.DeployError): self.baseline()

    def test_selected_images_only_change_and_existing_init_configuration_is_preserved(self):
        before = self.baseline(); original = copy.deepcopy(before)
        with patch.object(deploy, "migrate") as migrate:
            changed = deploy.deploy(self.kube, {"server": NEXT_DIGEST, "web": NEXT_DIGEST}, before)
        self.assertEqual(changed, ["server", "web"])
        migrate.assert_called_once()
        for service in deploy.SERVICES:
            expected = copy.deepcopy(original[service]["spec"])
            if service in changed:
                expected["template"]["spec"]["containers"][0]["image"] = deploy.pinned_image(service, NEXT_DIGEST)
            if service == "server":
                expected["template"]["spec"]["initContainers"][1]["image"] = deploy.pinned_image(service, NEXT_DIGEST)
            self.assertEqual(self.kube.deployments[service]["spec"], expected)
        self.assertEqual(before, original)
        for args in self.kube.patches():
            operations = json.loads(args[args.index("-p") + 1])
            self.assertEqual([op["path"] for op in operations[:2]],
                             ["/metadata/uid", "/metadata/resourceVersion"])

    def test_unchanged_selected_image_performs_no_patch_migration_or_rollout(self):
        before = self.baseline()
        with patch.object(deploy, "migrate") as migrate:
            self.assertEqual(deploy.deploy(self.kube, {"server": DIGEST}, before), [])
        migrate.assert_not_called(); self.assertFalse(self.kube.patches())
        self.assertFalse(any(args[0] == "rollout" for args, _, _ in self.kube.calls))

    def test_image_patch_never_introduces_a_migration_init_container(self):
        server = self.baseline()["server"]
        server["spec"]["template"]["spec"].pop("initContainers")
        operations = deploy.image_patch(server, deploy.pinned_image("server", NEXT_DIGEST))
        self.assertEqual(len(operations), 3)
        self.assertNotIn("initContainers", server["spec"]["template"]["spec"])

    def test_every_selected_api_dry_run_precedes_migration_and_any_image_change(self):
        before = self.baseline(); self.kube.dry_run_failure = "web"
        with patch.object(deploy, "migrate") as migrate, self.assertRaisesRegex(deploy.DeployError, "dry-run"):
            deploy.deploy(self.kube, {"server": NEXT_DIGEST, "web": NEXT_DIGEST}, before)
        migrate.assert_not_called(); self.assertFalse(self.kube.patches())
        self.assertEqual(self.kube.deployments, before)

    def test_migration_failure_blocks_every_application_update_and_keeps_job_for_inspection(self):
        before = self.baseline(); self.kube.job_conditions = [{"type": "Failed", "status": "True"}]
        with self.assertRaisesRegex(deploy.DeployError, "no application images changed"):
            deploy.deploy(self.kube, {"server": NEXT_DIGEST, "web": NEXT_DIGEST}, before)
        self.assertFalse(self.kube.patches()); self.assertEqual(self.kube.deployments, before)
        self.assertEqual(len(self.kube.jobs), 1)
        self.assertFalse(any(args[:2] == ["delete", "job"] for args, _, _ in self.kube.calls))

    def test_successful_native_migration_job_finishes_and_is_deleted_before_image_patch(self):
        before = self.baseline()
        deploy.deploy(self.kube, {"server": NEXT_DIGEST}, before)
        operations = [args[0] for args, _, _ in self.kube.calls]
        create = operations.index("create"); delete = operations.index("delete")
        first_write = next(index for index, (args, _, _) in enumerate(self.kube.calls)
                           if args[0] == "patch" and "--dry-run=server" not in args)
        self.assertLess(create, delete); self.assertLess(delete, first_write); self.assertFalse(self.kube.jobs)

    def test_migration_timeout_blocks_images_and_retains_the_job(self):
        before = self.baseline(); self.kube.job_conditions = [{"type": "Complete", "status": "False"}]
        with patch.object(deploy.time, "monotonic", side_effect=[0, 0, 661]), \
                patch.object(deploy.time, "sleep"), self.assertRaisesRegex(deploy.DeployError, "timed out"):
            deploy.deploy(self.kube, {"server": NEXT_DIGEST}, before)
        self.assertFalse(self.kube.patches()); self.assertEqual(self.kube.deployments, before)
        self.assertEqual(len(self.kube.jobs), 1)

    def test_migration_job_uses_only_existing_secret_refs_and_preserves_runtime_constraints(self):
        server = self.baseline()["server"]
        job = deploy.migration_job(server, deploy.pinned_image("server", NEXT_DIGEST), "fixture-job")
        pod = job["spec"]["template"]["spec"]; container = pod["containers"][0]
        self.assertEqual(job["spec"]["backoffLimit"], 0)
        self.assertEqual(job["spec"]["activeDeadlineSeconds"], 600)
        self.assertFalse(pod["automountServiceAccountToken"]); self.assertFalse(pod["enableServiceLinks"])
        env = {entry["name"]: entry for entry in container["env"]}
        self.assertEqual(set(env), {"DATABASE_URL", "PGADMIN_USER", "PGADMIN_PASSWORD", "DOTENV_CONFIG_PATH"})
        self.assertEqual(env["DATABASE_URL"]["valueFrom"]["secretKeyRef"]["name"], "fizzdragon-secrets")
        self.assertEqual(env["PGADMIN_PASSWORD"]["valueFrom"]["secretKeyRef"],
                         {"name": "fizzdragon-db-admin", "key": "PGPASSWORD", "optional": False})
        self.assertEqual(env["DOTENV_CONFIG_PATH"]["value"], "/dev/null")
        for key in ("imagePullSecrets", "nodeSelector", "tolerations", "securityContext"):
            self.assertEqual(pod[key], server["spec"]["template"]["spec"][key])
        for key in ("resources", "securityContext"):
            self.assertEqual(container[key], server["spec"]["template"]["spec"]["containers"][0][key])
        self.assertEqual(container["command"][:2], ["node", "-e"])
        self.assertIn("migrate().catch", container["command"][2])

    def test_concurrent_spec_or_uid_change_stops_before_migration_and_image_updates(self):
        for field in ("spec", "uid"):
            with self.subTest(field=field):
                fake = FakeKube(); before = deploy.verify_live(fake)
                if field == "spec": fake.deployments["studio"]["spec"]["replicas"] = 2; fake.deployments["studio"]["status"].update({k: 2 for k in ("replicas", "readyReplicas", "updatedReplicas", "availableReplicas")})
                else: fake.deployments["studio"]["metadata"]["uid"] = "replacement-uid"
                with patch.object(deploy, "migrate") as migrate, self.assertRaisesRegex(deploy.DeployError, "changed during"):
                    deploy.deploy(fake, {"server": NEXT_DIGEST}, before)
                migrate.assert_not_called(); self.assertFalse(fake.patches())

    def test_concurrent_change_during_migration_is_not_overwritten(self):
        before = self.baseline()
        def concurrent(*_): self.kube.deployments["web"]["spec"]["template"]["metadata"]["labels"]["concurrent"] = "yes"
        with patch.object(deploy, "migrate", side_effect=concurrent), self.assertRaisesRegex(deploy.DeployError, "changed during"):
            deploy.deploy(self.kube, {"server": NEXT_DIGEST, "web": NEXT_DIGEST}, before)
        self.assertFalse(self.kube.patches())

    def test_resource_version_race_is_rejected_by_actual_json_patch(self):
        before = self.baseline()
        def racing_kube(args, data=None, timeout=45):
            if args[0] == "patch" and "--dry-run=server" not in args:
                self.kube.deployments["web"]["metadata"]["resourceVersion"] = "99"
            return self.kube(args, data, timeout)
        with self.assertRaisesRegex(deploy.DeployError, "precondition"):
            deploy.deploy(racing_kube, {"web": NEXT_DIGEST}, before)
        self.assertEqual(self.kube.deployments["web"]["spec"], before["web"]["spec"])
        self.assertFalse(any(args[0] == "rollout" for args, _, _ in self.kube.calls))

    def test_rollout_failure_stops_later_services_without_automatic_rollback(self):
        before = self.baseline(); self.kube.rollout_failure = "server"
        with patch.object(deploy, "migrate"), self.assertRaisesRegex(deploy.DeployError, "rollout failure"):
            deploy.deploy(self.kube, {"server": NEXT_DIGEST, "web": NEXT_DIGEST}, before)
        self.assertEqual([args[2] for args in self.kube.patches()], ["fizzdragon-server"])
        self.assertEqual(self.kube.deployments["web"]["spec"], before["web"]["spec"])
        self.assertEqual(self.kube.deployments["server"]["spec"]["template"]["spec"]["containers"][0]["image"],
                         deploy.pinned_image("server", NEXT_DIGEST))

    def main(self, arguments, identity_error=None, wrong_uid=False, build_error=None, after_build=None):
        with tempfile.NamedTemporaryFile() as kubeconfig:
            verify = Mock(side_effect=identity_error, return_value={"namespaceUid": "wrong" if wrong_uid else deploy.NS_UID})
            def build_images(*_, **__):
                if build_error: raise build_error
                if after_build: after_build()
                return {"web": deploy.pinned_image("web", NEXT_DIGEST)}
            build = Mock(side_effect=build_images)
            def command(args, data=None, timeout=45):
                prefix = ["kubectl", "--kubeconfig", kubeconfig.name, "-n", "fizzdragon", "--request-timeout=30s"]
                self.assertEqual(args[:len(prefix)], prefix)
                return self.kube(args[len(prefix):], data, timeout)
            with patch.object(deploy.preflight, "verify", verify), patch.object(deploy.builder, "build_images", build), \
                    patch.object(deploy.builder, "committed_source", return_value=SOURCE), \
                    patch.object(deploy, "command", side_effect=command):
                result = deploy.main(["--kubeconfig", kubeconfig.name, *arguments])
            return result, verify, build

    def test_check_is_read_only_and_never_builds_even_with_service_argument(self):
        result, verify, build = self.main(["web", "--check"])
        self.assertEqual(result, 0); verify.assert_called_once(); build.assert_not_called()
        self.assertTrue(all(args[0] in ("get", "auth") for args, _, _ in self.kube.calls))
        self.assertEqual([args[2:] for args, _, _ in self.kube.calls if args[0] == "auth"],
                         [["patch", "deployments.apps/fizzdragon-web"],
                          ["watch", "deployments.apps/fizzdragon-web"]])

    def test_check_without_selection_checks_current_admin_release_access_without_mutations(self):
        result, _, build = self.main(["--check"])
        self.assertEqual(result, 0); build.assert_not_called()
        permissions = [args[2:] for args, _, _ in self.kube.calls if args[0] == "auth"]
        expected = [[verb, f"deployments.apps/fizzdragon-{service}"]
                    for service in deploy.SERVICES for verb in ("patch", "watch")]
        expected += [[verb, "jobs.batch"] for verb in ("create", "get", "delete")]
        self.assertEqual(permissions, expected)
        self.assertTrue(all(args[0] in ("get", "auth") for args, _, _ in self.kube.calls))

    def test_missing_selected_patch_or_watch_permission_stops_before_building(self):
        for verb in ("patch", "watch"):
            with self.subTest(verb=verb):
                self.kube = FakeKube()
                self.kube.denied_permissions.add((verb, "deployments.apps/fizzdragon-web"))
                result, _, build = self.main(["web"])
                self.assertEqual(result, 1); build.assert_not_called()
                self.assertFalse(self.kube.patches()); self.assertFalse(self.kube.jobs)
                self.assertIn(f"does not allow {verb}", self.output.getvalue())

    def test_server_release_checks_existing_job_access_before_building(self):
        for verb in ("create", "get", "delete"):
            with self.subTest(verb=verb):
                self.kube = FakeKube()
                self.kube.denied_permissions.add((verb, "jobs.batch"))
                result, _, build = self.main(["server"])
                self.assertEqual(result, 1); build.assert_not_called()
                self.assertFalse(self.kube.patches()); self.assertFalse(self.kube.jobs)

    def test_unchanged_prebuilt_server_does_not_require_job_permissions(self):
        self.kube.denied_permissions = {(verb, "jobs.batch") for verb in ("create", "get", "delete")}
        result, _, build = self.main(["--image", "server=" + DIGEST])
        self.assertEqual(result, 0); build.assert_not_called()
        self.assertFalse(any(args[-1] == "jobs.batch" for args, _, _ in self.kube.calls))
        self.assertFalse(self.kube.patches()); self.assertFalse(self.kube.jobs)

    def test_permission_check_connection_failure_is_actionable_and_stops(self):
        kube = Mock(side_effect=deploy.DeployError("kubectl operation failed"))
        with self.assertRaisesRegex(deploy.DeployError, "Cannot confirm permission to patch"):
            deploy.verify_permissions(kube, ["web"])
        kube.assert_called_once_with(["auth", "can-i", "patch", "deployments.apps/fizzdragon-web"])

    def test_selected_build_runs_after_live_checks_and_preserves_other_services(self):
        original = copy.deepcopy(self.kube.deployments)
        result, _, build = self.main(["web"])
        self.assertEqual(result, 0)
        build.assert_called_once_with(deploy.ROOT, ["web"], deploy.cloud, source=SOURCE)
        self.assertEqual([args[2] for args in self.kube.patches()], ["fizzdragon-web"])
        for service in set(deploy.SERVICES) - {"web"}:
            self.assertEqual(self.kube.deployments[service], original[service])

    def test_nonproduction_source_stops_before_cloud_and_prebuilt_publication(self):
        for selection in (["web"], ["--image", "web=" + NEXT_DIGEST]):
            with self.subTest(selection=selection), tempfile.NamedTemporaryFile() as kubeconfig:
                with patch.object(deploy.builder, "committed_source", side_effect=deploy.builder.BuildError("main branch required")), \
                        patch.object(deploy.preflight, "verify") as verify, \
                        patch.object(deploy.builder, "build_images") as build, patch.object(deploy, "command") as command:
                    result = deploy.main(["--kubeconfig", kubeconfig.name, *selection])
                self.assertEqual(result, 1)
                verify.assert_not_called(); build.assert_not_called(); command.assert_not_called()

    def test_read_only_check_does_not_require_main_or_a_clean_worktree(self):
        with tempfile.NamedTemporaryFile() as kubeconfig:
            with patch.object(deploy.builder, "committed_source") as source, \
                    patch.object(deploy.preflight, "verify", return_value={"namespaceUid": deploy.NS_UID}), \
                    patch.object(deploy, "command", side_effect=lambda args, data=None, timeout=45: self.kube(args[6:], data, timeout)):
                result = deploy.main(["--kubeconfig", kubeconfig.name, "--check"])
        self.assertEqual(result, 0); source.assert_not_called()

    def test_concurrent_change_while_building_stops_before_deploy(self):
        def concurrent():
            self.kube.deployments["web"]["spec"]["template"]["metadata"]["labels"]["changed"] = "concurrent"
        result, _, build = self.main(["web"], after_build=concurrent)
        self.assertEqual(result, 1); build.assert_called_once(); self.assertFalse(self.kube.patches())
        self.assertIn("changed during this release", self.output.getvalue())

    def test_safe_build_errors_are_actionable_and_untrusted_error_details_are_hidden(self):
        result, _, _ = self.main(["web"], build_error=deploy.builder.BuildError("Local Docker daemon is unavailable"))
        self.assertEqual(result, 1); self.assertFalse(self.kube.patches())
        self.assertIn("Local Docker daemon is unavailable", self.output.getvalue())
        self.output.seek(0); self.output.truncate(0)
        result, _, _ = self.main(["web"], build_error=ValueError("fixture-password must not be printed"))
        self.assertEqual(result, 1); self.assertNotIn("fixture-password", self.output.getvalue())
        self.assertIn("Build or metadata validation failed", self.output.getvalue())

    def test_account_namespace_and_live_validation_fail_before_build(self):
        for mode in ("account", "verified-namespace", "live-namespace", "pvc"):
            with self.subTest(mode=mode):
                self.kube = FakeKube()
                if mode == "live-namespace": self.kube.namespace["metadata"]["uid"] = "wrong"
                if mode == "pvc": self.kube.pvc["status"]["phase"] = "Pending"
                error = deploy.preflight.PreflightError("Profile acct6 must address account 5332868355276356") if mode == "account" else None
                result, _, build = self.main(["web"], identity_error=error, wrong_uid=mode == "verified-namespace")
                self.assertEqual(result, 1); build.assert_not_called(); self.assertFalse(self.kube.patches())

    def test_real_identity_preflight_rejects_wrong_account_before_cluster_or_build(self):
        with tempfile.NamedTemporaryFile() as kubeconfig:
            def cloud_identity(args):
                self.assertEqual(args, ["aliyun", "sts", "GetCallerIdentity", "--profile", "acct6",
                                        "--region", "ap-southeast-1"])
                return {"AccountId": "5941647929258385"}
            with patch.object(deploy.preflight, "read_json", side_effect=cloud_identity) as reads, \
                    patch.object(deploy.builder, "committed_source", return_value=SOURCE), \
                    patch.object(deploy.builder, "build_images") as build, patch.object(deploy, "command") as command:
                result = deploy.main(["web", "--kubeconfig", kubeconfig.name])
            self.assertEqual(result, 1); self.assertEqual(reads.call_count, 1)
            build.assert_not_called(); command.assert_not_called()

    def test_real_identity_preflight_wrong_namespace_uid_stops_before_build(self):
        target = deploy.preflight.TARGET
        calls = []
        with tempfile.NamedTemporaryFile() as kubeconfig:
            def read_metadata(args):
                calls.append(args)
                if args[:3] == ["aliyun", "sts", "GetCallerIdentity"]:
                    return {"AccountId": target["accountId"]}
                if args[:3] == ["aliyun", "cs", "GET"]:
                    self.assertEqual(args[3], "/clusters/" + target["clusterId"])
                    return {"cluster_id": target["clusterId"], "region_id": target["region"],
                            "name": target["clusterName"], "state": "running",
                            "master_url": {"internal": "https://fixture-ack.invalid:6443"}}
                prefix = ["kubectl", "--kubeconfig", kubeconfig.name, "--namespace", "fizzdragon"]
                self.assertEqual(args[:len(prefix)], prefix)
                operation = args[len(prefix):]
                if operation[:2] == ["config", "view"]:
                    return {"clusters": [{"cluster": {"server": "https://fixture-ack.invalid:6443"}}]}
                if operation[:3] == ["get", "namespace", "fizzdragon"]:
                    return {"metadata": {"name": "fizzdragon", "uid": "different-existing-namespace"},
                            "status": {"phase": "Active"}}
                if operation[:2] == ["get", "storageclass"]: return {"items": []}
                raise AssertionError("Unexpected identity read: " + repr(args))
            with patch.object(deploy.preflight, "read_json", side_effect=read_metadata), \
                    patch.object(deploy.builder, "committed_source", return_value=SOURCE), \
                    patch.object(deploy.builder, "build_images") as build, patch.object(deploy, "command") as command:
                result = deploy.main(["web", "--kubeconfig", kubeconfig.name])
            self.assertEqual(result, 1); build.assert_not_called(); command.assert_not_called()
            self.assertEqual(len(calls), 5)

    def test_invalid_selection_or_kubeconfig_stops_before_identity_or_build(self):
        with patch.object(deploy.preflight, "verify") as verify, \
                patch.object(deploy.builder, "build_images") as build:
            for arguments in (["agent"], ["web", "web"], ["all", "web"],
                              ["web", "--image", "web=" + DIGEST]):
                with self.subTest(arguments=arguments), self.assertRaises(SystemExit):
                    deploy.main(arguments)
            for kubeconfig in ("/fixture/nonexistent", "/one" + os.pathsep + "/two"):
                self.assertEqual(deploy.main(["web", "--kubeconfig", kubeconfig]), 1)
            verify.assert_not_called(); build.assert_not_called()

    def test_image_argument_path_never_builds_and_rejects_duplicates_or_wrong_service(self):
        result, _, build = self.main(["--image", "web=" + NEXT_DIGEST])
        self.assertEqual(result, 0); build.assert_not_called()
        self.assertEqual([args[2] for args in self.kube.patches()], ["fizzdragon-web"])
        for arguments in (["--image", "web=" + DIGEST, "--image", "web=" + NEXT_DIGEST],
                          ["--image", "agent=" + DIGEST]):
            self.kube = FakeKube(); result, _, build = self.main(arguments)
            self.assertEqual(result, 1); build.assert_not_called(); self.assertFalse(self.kube.calls)


class MigrationNodeTest(unittest.TestCase):
    def test_native_migration_connection_cli_failure_and_each_privilege(self):
        fixture = Path(__file__).with_name("production_migrate_fixture.cjs")
        # This local Node VM admits only mocked pg/child_process modules.
        result = subprocess.run(["node", str(fixture), str(DIRECTORY / "production-migrate.cjs")],
                                capture_output=True, text=True, timeout=20, check=False,
                                env={"PATH": os.environ.get("PATH", "")})
        self.assertEqual(result.returncode, 0, result.stderr)
        cases = json.loads(result.stdout)
        self.assertGreaterEqual(len(cases), 18)
        for case in cases:
            with self.subTest(case=case["name"]):
                self.assertTrue(case["passed"], case)

    def test_retired_azure_shell_fails_without_invoking_python_git_or_cloud(self):
        script = DIRECTORY.parent / "deploy-com-aks.sh"
        result = subprocess.run(["/bin/bash", str(script)], capture_output=True, text=True, timeout=5,
                                env={"PATH": "/nonexistent"}, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("retired", result.stderr)
        self.assertIn("deploy/deploy-com.sh", result.stderr)


if __name__ == "__main__":
    unittest.main()
