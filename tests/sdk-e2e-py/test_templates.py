import pytest

from superserve import (
    EnvStep,
    EnvStepValue,
    RunStep,
    Sandbox,
    Template,
    WorkdirStep,
)
from superserve.errors import BuildError, ConflictError

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


def test_list_includes_system_templates(connection_opts):
    templates = Template.list(**connection_opts)
    assert len(templates) > 0
    assert any(t.alias.startswith("superserve/") for t in templates)


def test_full_lifecycle(connection_opts, run_id):
    """Multi-step build, launch, verify env/workdir propagate, rebuild
    idempotency, conflict-on-delete-while-referenced."""
    alias = f"sdk-e2e-py-tpl-{run_id}"
    template = Template.create(
        alias=alias,
        vcpu=2,
        memory_mib=2048,
        disk_mib=4096,
        from_="python:3.11",
        steps=[
            RunStep(run="mkdir -p /srv/app"),
            WorkdirStep(workdir="/srv/app"),
            EnvStep(env=EnvStepValue(key="GREETING", value="hello-from-build")),
            RunStep(run='sh -c "echo $GREETING > /srv/app/greet.txt"'),
            RunStep(run="python --version > /srv/app/pyver.txt 2>&1"),
        ],
        **connection_opts,
    )
    assert template.alias == alias
    assert template.vcpu == 2
    assert template.memory_mib == 2048

    try:
        template.wait_until_ready(
            on_log=lambda ev: (
                print(ev.text, end="")
                if ev.stream.value in ("stdout", "stderr")
                else None
            ),
        )

        fresh = template.get_info()
        assert fresh.status.value == "ready"
        assert fresh.built_at is not None

        # list_builds shows the build that just finished
        builds = template.list_builds()
        assert len(builds) >= 1
        assert builds[0].status.value == "ready"

        # Rebuild with same spec → idempotent (same hash returns existing build)
        rebuilt = template.rebuild()
        assert rebuilt.build_spec_hash == builds[0].build_spec_hash

        # Launch a sandbox, verify all build-step effects propagate to runtime
        sandbox = Sandbox.create(
            name=f"sdk-e2e-py-tpl-sbx-{run_id}",
            from_template=template,
            **connection_opts,
        )
        try:
            # env var from build step persists at runtime
            env_result = sandbox.commands.run("printenv GREETING")
            assert env_result.stdout.strip() == "hello-from-build"

            # workdir from build step is the runtime cwd
            cwd_result = sandbox.commands.run("pwd")
            assert cwd_result.stdout.strip() == "/srv/app"

            # file written during build is present
            greet = sandbox.commands.run("cat /srv/app/greet.txt")
            assert greet.stdout.strip() == "hello-from-build"

            # python build-step output is on disk
            pyver = sandbox.commands.run("cat /srv/app/pyver.txt")
            assert pyver.exit_code == 0
            assert pyver.stdout.strip().startswith("Python 3.11")

            # Deleting the template while the sandbox still references it → 409
            with pytest.raises(ConflictError):
                template.delete()
        finally:
            try:
                sandbox.kill()
            except Exception as err:
                print(f"Cleanup failed for sandbox {sandbox.id}: {err}")
    finally:
        try:
            template.delete()
        except Exception as err:
            print(f"Cleanup failed for template {template.id}: {err}")


def test_build_error_on_failed_step(connection_opts, run_id):
    """A build with a failing step raises BuildError."""
    alias = f"sdk-e2e-py-tpl-fail-{run_id}"
    template = Template.create(
        alias=alias,
        from_="python:3.11",
        # Force a step failure as quickly as possible: `false` exits 1.
        steps=[RunStep(run="false")],
        **connection_opts,
    )

    try:
        with pytest.raises(BuildError) as exc_info:
            template.wait_until_ready()
        assert exc_info.value.template_id == template.id
    finally:
        try:
            template.delete()
        except Exception as err:
            print(f"Cleanup failed for template {template.id}: {err}")
