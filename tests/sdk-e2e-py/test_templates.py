from superserve import RunStep, Sandbox, Template

from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


def test_list_includes_system_templates(connection_opts):
    templates = Template.list(**connection_opts)
    assert len(templates) > 0
    assert any(t.alias.startswith("superserve/") for t in templates)


def test_create_build_launch_cleanup(connection_opts, run_id):
    alias = f"sdk-e2e-py-tpl-{run_id}"
    template = Template.create(
        alias=alias,
        from_="python:3.11",
        steps=[RunStep(run="echo hello > /tmp/marker")],
        **connection_opts,
    )
    assert template.alias == alias

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

        sandbox = Sandbox.create(
            name=f"sdk-e2e-py-tpl-sbx-{run_id}",
            from_template=template,
            **connection_opts,
        )
        try:
            result = sandbox.commands.run("cat /tmp/marker")
            assert result.stdout.strip() == "hello"
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
