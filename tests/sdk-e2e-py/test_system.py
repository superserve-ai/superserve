from _helpers import SKIP_IF_NO_CREDS

pytestmark = SKIP_IF_NO_CREDS


def test_health_returns_response(client):
    health = client.system.health()
    assert health is not None
