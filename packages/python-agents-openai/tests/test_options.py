from agents.sandbox.session.sandbox_client import BaseSandboxClientOptions
from superserve_agents_openai import (
    SuperserveSandboxClient,
    SuperserveSandboxClientOptions,
)


def test_client_options_defaults():
    options = SuperserveSandboxClientOptions()
    assert options.type == "superserve"
    assert options.api_key is None
    assert options.base_url is None
    assert options.template is None
    assert options.timeout_seconds is None


def test_client_options_custom():
    options = SuperserveSandboxClientOptions(
        api_key="ss_live_custom",
        base_url="https://api.superserve.ai",
        template="python-3.12",
        timeout_seconds=600,
    )
    assert options.type == "superserve"
    assert options.api_key == "ss_live_custom"
    assert options.base_url == "https://api.superserve.ai"
    assert options.template == "python-3.12"
    assert options.timeout_seconds == 600


def test_client_options_polymorphic_parse():
    payload = {
        "type": "superserve",
        "api_key": "ss_live_parsed",
        "template": "my-template",
    }
    parsed = BaseSandboxClientOptions.parse(payload)
    assert isinstance(parsed, SuperserveSandboxClientOptions)
    assert parsed.api_key == "ss_live_parsed"
    assert parsed.template == "my-template"


def test_client_defaults():
    client = SuperserveSandboxClient()
    assert client.backend_id == "superserve"
    assert client.supports_default_options is True


def test_client_options_api_key_hidden_in_repr():
    options = SuperserveSandboxClientOptions(api_key="ss_secret_live_key_999")
    assert options.api_key == "ss_secret_live_key_999"
    assert "ss_secret_live_key_999" not in repr(options)
    assert "ss_secret_live_key_999" not in str(options)

