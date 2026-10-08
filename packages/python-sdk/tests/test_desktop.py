"""Tests for sandbox.desktop — RPC shapes, key mapping, batching."""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
import gzip

from superserve.errors import ServerError, ValidationError
from superserve.types import PreviewToken
from superserve.desktop import (
    MAX_SCREENSHOT_RESPONSE_BYTES,
    AsyncDesktop,
    AsyncDesktopDeps,
    Desktop,
    DesktopDeps,
    Screenshot,
    StepResult,
    _chord_parts,
)

SANDBOX_HOST = "sandbox.example.com"
SBX = "sbx-1"
RPC_BASE = f"https://boxd-{SBX}.{SANDBOX_HOST}/superserve.boxd.v1.DesktopService"
_TOKEN = PreviewToken(
    token="spv1.secret",
    port=6080,
    header="X-Superserve-Preview-Token",
    query_param="superserve_preview_token",
    token_version=1,
    access="private",
    preview_access="private",
)


async def _mint_async() -> PreviewToken:
    return _TOKEN


async def _public_async() -> str:
    return "public"


def _make_desktop() -> Desktop:
    deps = DesktopDeps(
        sandbox_id=SBX,
        sandbox_host=SANDBOX_HOST,
        get_access_token=lambda: "tok-initial",
        refresh_activate=lambda: "tok-refreshed",
        publish_stream_port=lambda: "public",
        stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
        mint_stream_token=lambda: _TOKEN,
    )
    return Desktop(deps)


def _request_body(route: respx.Route) -> dict:
    return json.loads(route.calls.last.request.content)


class TestScreenshot:
    @respx.mock
    def test_decodes_png_and_dimensions(self) -> None:
        png = b"\x89PNG-fake"
        route = respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200,
                json={
                    "image": base64.b64encode(png).decode(),
                    "width": 1280,
                    "height": 800,
                },
            )
        )
        shot = _make_desktop().screenshot()
        assert route.called
        assert shot.data == png
        assert (shot.width, shot.height) == (1280, 800)
        assert route.calls.last.request.headers["X-Access-Token"] == "tok-initial"

    @respx.mock
    def test_missing_image_raises(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(200, json={"width": 1, "height": 1})
        )
        with pytest.raises(ValueError, match="missing image"):
            _make_desktop().screenshot()


class TestPointer:
    @respx.mock
    def test_click_is_single_rpc(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().click(10, 20)
        assert route.call_count == 1
        assert _request_body(route) == {
            "x": 10,
            "y": 20,
            "button": "POINTER_BUTTON_LEFT",
            "action": "POINTER_ACTION_CLICK",
        }

    @respx.mock
    def test_zero_is_a_valid_coordinate(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().click(0, 300)
        assert _request_body(route)["x"] == 0

    def test_invalid_coordinates_rejected_locally(self) -> None:
        desktop = _make_desktop()
        with pytest.raises(ValueError, match="Invalid coordinates"):
            desktop.click(-1, 5)
        with pytest.raises(ValueError, match="Invalid coordinates"):
            desktop.move_mouse(1.5, 5)  # type: ignore[arg-type]

    @respx.mock
    def test_drag_is_one_atomic_batch(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={"executed": 3})
        )
        _make_desktop().drag((1, 2), (30, 40))
        assert route.call_count == 1
        actions = _request_body(route)["actions"]
        assert [next(iter(a)) for a in actions] == ["pointer", "pointer", "pointer"]
        assert actions[0]["pointer"]["action"] == "POINTER_ACTION_DOWN"
        assert actions[1]["pointer"] == {
            "x": 30,
            "y": 40,
            "button": "POINTER_BUTTON_LEFT",
            "action": "POINTER_ACTION_MOVE",
        }
        assert actions[2]["pointer"]["action"] == "POINTER_ACTION_UP"


class TestKeyboard:
    @respx.mock
    def test_write_sends_literal_text(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().write("hello world")
        assert _request_body(route) == {"text": "hello world"}

    @respx.mock
    def test_write_empty_is_noop(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        _make_desktop().write("")
        assert not route.called

    @respx.mock
    def test_press_maps_names_and_chords(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendKey").mock(
            return_value=httpx.Response(200, json={})
        )
        desktop = _make_desktop()
        desktop.press("enter")
        assert _request_body(route) == {"key": "Return", "modifiers": []}
        desktop.press("ctrl+c")
        assert _request_body(route) == {"key": "c", "modifiers": ["ctrl"]}
        desktop.press(["cmd", "shift", "p"])
        assert _request_body(route) == {"key": "p", "modifiers": ["super", "shift"]}

    def test_chord_parts_passthrough_and_empty(self) -> None:
        assert _chord_parts("F5") == ([], "F5")
        with pytest.raises(ValueError, match="empty key"):
            _chord_parts("")


class TestBatchAndMisc:
    @respx.mock
    def test_actions_maps_every_type(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={"executed": 3})
        )
        _make_desktop().actions(
            [
                {"type": "click", "x": 5, "y": 6, "button": "right"},
                {"type": "write", "text": "hi"},
                {"type": "scroll", "dy": 3},
            ]
        )
        actions = _request_body(route)["actions"]
        assert actions == [
            {
                "pointer": {
                    "x": 5,
                    "y": 6,
                    "button": "POINTER_BUTTON_RIGHT",
                    "action": "POINTER_ACTION_CLICK",
                }
            },
            {"key": {"text": "hi"}},
            {"scroll": {"dx": 0, "dy": 3}},
        ]

    @respx.mock
    def test_invalid_action_rejects_batch_before_any_request(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendActions").mock(
            return_value=httpx.Response(200, json={})
        )
        with pytest.raises(ValueError, match="Invalid coordinates"):
            _make_desktop().actions(
                [
                    {"type": "click", "x": 1, "y": 1},
                    {"type": "move", "x": -4, "y": 2},
                ]
            )
        assert not route.called

    def test_unknown_action_type_rejected(self) -> None:
        with pytest.raises(ValueError, match="Unknown desktop action"):
            _make_desktop().actions([{"type": "teleport", "x": 1, "y": 1}])

    @respx.mock
    def test_scroll_and_resize(self) -> None:
        scroll = respx.post(f"{RPC_BASE}/Scroll").mock(
            return_value=httpx.Response(200, json={})
        )
        resize = respx.post(f"{RPC_BASE}/Resize").mock(
            return_value=httpx.Response(200, json={})
        )
        desktop = _make_desktop()
        desktop.scroll(dx=-2, dy=5)
        desktop.resize(1024, 768)
        assert _request_body(scroll) == {"dx": -2, "dy": 5}
        assert _request_body(resize) == {"width": 1024, "height": 768}


class TestStreamUrl:
    def test_activates_publishes_and_builds_novnc_url(self) -> None:
        order: list[str] = []
        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=lambda: (order.append("activate"), "tok")[1],
            publish_stream_port=lambda: (order.append("publish"), "public")[1],
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
            mint_stream_token=lambda: _TOKEN,
        )
        url = Desktop(deps).get_stream_url()
        assert order == ["activate", "publish"]
        assert url == (
            f"https://6080-{SBX}.{SANDBOX_HOST}/vnc.html?autoconnect=1&resize=scale"
        )

    def test_view_only_flag(self) -> None:
        url = _make_desktop().get_stream_url(view_only=True)
        assert "view_only=1" in url


class TestTokenRetry:
    @respx.mock
    def test_stale_token_activates_and_retries_once(self) -> None:
        tokens: list[str] = []

        def responder(request: httpx.Request) -> httpx.Response:
            tokens.append(request.headers["X-Access-Token"])
            if len(tokens) == 1:
                return httpx.Response(401, json={"error": "unauthenticated"})
            return httpx.Response(200, json={})

        respx.post(f"{RPC_BASE}/SendPointer").mock(side_effect=responder)
        refreshes: list[bool] = []

        def refresh() -> str:
            refreshes.append(True)
            return "tok-refreshed"

        state = {"token": "tok-initial"}

        def refresh_and_store() -> str:
            state["token"] = refresh()
            return state["token"]

        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: state["token"],
            refresh_activate=refresh_and_store,
            publish_stream_port=lambda: "public",
            stream_base_url=lambda: "unused",
            mint_stream_token=lambda: _TOKEN,
        )
        Desktop(deps).click(1, 1)
        assert tokens == ["tok-initial", "tok-refreshed"]
        assert refreshes == [True]


class TestAsyncDesktop:
    @respx.mock
    @pytest.mark.asyncio
    async def test_click_and_screenshot(self) -> None:
        pointer = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        png = b"png-bytes"
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200,
                json={
                    "image": base64.b64encode(png).decode(),
                    "width": 10,
                    "height": 5,
                },
            )
        )

        async def publish() -> str:
            return "public"

        async def refresh() -> str:
            return "tok"

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=refresh,
            publish_stream_port=publish,
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
            mint_stream_token=_mint_async,
        )
        desktop = AsyncDesktop(deps)
        await desktop.click(3, 4)
        shot = await desktop.screenshot()
        assert pointer.call_count == 1
        assert shot.data == png
        assert (shot.width, shot.height) == (10, 5)


class TestRoutingHint:
    @respx.mock
    def test_sync_sends_hint_when_present(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )
        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
            publish_stream_port=lambda: "public",
            stream_base_url=lambda: "",
            mint_stream_token=lambda: _TOKEN,
            get_routing_hint=lambda: "hint-1",
        )
        Desktop(deps).click(1, 2)
        assert route.calls.last.request.headers["X-Superserve-Routing-Hint"] == "hint-1"
        _make_desktop().click(1, 2)
        assert "X-Superserve-Routing-Hint" not in route.calls.last.request.headers

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_sends_hint_when_present(self) -> None:
        route = respx.post(f"{RPC_BASE}/SendPointer").mock(
            return_value=httpx.Response(200, json={})
        )

        async def _tok() -> str:
            return "tok"

        async def _noop() -> None:
            return None

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=_tok,
            publish_stream_port=_public_async,
            stream_base_url=lambda: "",
            mint_stream_token=_mint_async,
            get_routing_hint=lambda: "hint-1",
        )
        await AsyncDesktop(deps).click(1, 2)
        assert route.calls.last.request.headers["X-Superserve-Routing-Hint"] == "hint-1"


class TestPrivateStreamUrl:
    def test_sync_signs_private_port(self) -> None:
        minted: list[bool] = []

        def mint() -> PreviewToken:
            minted.append(True)
            return _TOKEN

        deps = DesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=lambda: "tok",
            publish_stream_port=lambda: "private",
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
            mint_stream_token=mint,
        )
        url = Desktop(deps).get_stream_url(view_only=True)
        assert url == (
            f"https://6080-{SBX}.{SANDBOX_HOST}/vnc.html"
            "?autoconnect=1&resize=scale&view_only=1&superserve_preview_token=spv1.secret"
        )
        assert minted == [True]

    def test_sync_public_port_is_not_signed(self) -> None:
        url = _make_desktop().get_stream_url()
        assert "superserve_preview_token" not in url

    @pytest.mark.asyncio
    async def test_async_signs_private_port(self) -> None:
        async def private() -> str:
            return "private"

        async def refresh() -> str:
            return "tok"

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=refresh,
            publish_stream_port=private,
            stream_base_url=lambda: f"https://6080-{SBX}.{SANDBOX_HOST}",
            mint_stream_token=_mint_async,
        )
        url = await AsyncDesktop(deps).get_stream_url()
        assert url.endswith("&superserve_preview_token=spv1.secret")
        assert "/vnc.html?autoconnect=1&resize=scale" in url


class TestScreenshotCap:
    @respx.mock
    def test_sync_rejects_oversized_body_while_reading(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200, content=b"x" * (MAX_SCREENSHOT_RESPONSE_BYTES + 1)
            )
        )
        with pytest.raises(ValidationError, match="maximum size"):
            _make_desktop().screenshot()

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_rejects_oversized_body_while_reading(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(
            return_value=httpx.Response(
                200, content=b"x" * (MAX_SCREENSHOT_RESPONSE_BYTES + 1)
            )
        )

        async def refresh() -> str:
            return "tok"

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=refresh,
            publish_stream_port=_public_async,
            stream_base_url=lambda: "",
            mint_stream_token=_mint_async,
        )
        with pytest.raises(ValidationError, match="maximum size"):
            await AsyncDesktop(deps).screenshot()


@respx.mock
def test_sync_sandbox_desktop_resolves_client_per_call() -> None:
    """A handle created before os.fork() must not pin the parent's pool."""
    from superserve import Sandbox

    respx.post("https://api.example.com/sandboxes").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": SBX,
                "name": "example",
                "status": "active",
                "vcpu_count": 2,
                "memory_mib": 512,
                "access_token": "auth",
                "created_at": "2026-01-01T00:00:00Z",
                "metadata": {},
            },
        )
    )
    sb = Sandbox.create(
        name="example", api_key="ss_live_test", base_url="https://api.example.com"
    )
    assert sb.desktop._client is None


def _gzipped_screenshot() -> httpx.Response:
    body = json.dumps(
        {"image": base64.b64encode(b"\x89PNG").decode(), "width": 4, "height": 2}
    )
    return httpx.Response(
        200,
        content=gzip.compress(body.encode()),
        headers={"content-encoding": "gzip", "content-type": "application/json"},
    )


class TestCompressedScreenshot:
    """The capped read streams decoded chunks; the rebuilt response must not
    carry the wire encoding or httpx decompresses the JSON twice."""

    @respx.mock
    def test_sync_decodes_gzip_once(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(return_value=_gzipped_screenshot())
        shot = _make_desktop().screenshot()
        assert (shot.width, shot.height) == (4, 2)

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_decodes_gzip_once(self) -> None:
        respx.post(f"{RPC_BASE}/Screenshot").mock(return_value=_gzipped_screenshot())

        async def refresh() -> str:
            return "tok"

        deps = AsyncDesktopDeps(
            sandbox_id=SBX,
            sandbox_host=SANDBOX_HOST,
            get_access_token=lambda: "tok",
            refresh_activate=refresh,
            publish_stream_port=_public_async,
            stream_base_url=lambda: "",
            mint_stream_token=_mint_async,
        )
        shot = await AsyncDesktop(deps).screenshot()
        assert (shot.width, shot.height) == (4, 2)


@respx.mock
def test_connect_error_message_is_preserved() -> None:
    respx.post(f"{RPC_BASE}/SendActions").mock(
        return_value=httpx.Response(
            500,
            json={"code": "internal", "message": "action 1 failed after 1 executed"},
        )
    )
    with pytest.raises(ServerError, match="after 1 executed"):
        _make_desktop().actions([{"type": "click", "x": 1, "y": 1, "button": "left"}])


class TestStep:
    @respx.mock
    def test_sends_batch_and_settle_and_decodes_frame(self) -> None:
        png = b"\x89PNG-fake"
        route = respx.post(f"{RPC_BASE}/Step").mock(
            return_value=httpx.Response(
                200,
                json={
                    "executed": 2,
                    "screenshot": {
                        "image": base64.b64encode(png).decode(),
                        "width": 4,
                        "height": 2,
                    },
                },
            )
        )
        result = _make_desktop().step(
            [{"type": "click", "x": 1, "y": 2}, {"type": "press", "key": "enter"}],
            settle_ms=300,
        )
        assert _request_body(route) == {
            "actions": [
                {
                    "pointer": {
                        "x": 1,
                        "y": 2,
                        "button": "POINTER_BUTTON_LEFT",
                        "action": "POINTER_ACTION_CLICK",
                    }
                },
                {"key": {"key": "Return", "modifiers": []}},
            ],
            "settleMs": 300,
        }
        assert result == StepResult(
            executed=2, screenshot=Screenshot(data=png, width=4, height=2)
        )

    @respx.mock
    def test_asks_for_a_changed_frame_and_reports_whether_one_arrived(self) -> None:
        png = b"\x89PNG"
        route = respx.post(f"{RPC_BASE}/Step").mock(
            return_value=httpx.Response(
                200,
                json={
                    "executed": 1,
                    "screenshot": {
                        "image": base64.b64encode(png).decode(),
                        "width": 4,
                        "height": 2,
                    },
                    "changed": True,
                },
            )
        )
        result = _make_desktop().step(
            [{"type": "click", "x": 1, "y": 2}], settle_ms=500, wait_for_change=True
        )
        body = _request_body(route)
        assert body["settleMs"] == 500 and body["waitForChange"] is True
        assert result.changed is True
        assert result.screenshot == Screenshot(data=png, width=4, height=2)

    @respx.mock
    def test_stopped_batch_returns_its_frame_instead_of_raising(self) -> None:
        respx.post(f"{RPC_BASE}/Step").mock(
            return_value=httpx.Response(
                200,
                json={
                    "executed": 1,
                    "actionError": "action 1 failed after 1 executed: boom",
                    "screenshot": {
                        "image": base64.b64encode(b"x").decode(),
                        "width": 4,
                        "height": 2,
                    },
                },
            )
        )
        result = _make_desktop().step([{"type": "click", "x": 1, "y": 2}])
        assert result.executed == 1
        assert result.action_error is not None and "action 1" in result.action_error
        assert result.screenshot is not None and result.screenshot.width == 4
        assert result.screenshot_error is None

    @respx.mock
    def test_failed_capture_reports_error_with_executed_count(self) -> None:
        respx.post(f"{RPC_BASE}/Step").mock(
            return_value=httpx.Response(
                200, json={"executed": 1, "captureError": "import: nope"}
            )
        )
        result = _make_desktop().step([{"type": "click", "x": 1, "y": 2}])
        assert result == StepResult(executed=1, screenshot_error="import: nope")

    def test_empty_batch_is_rejected_without_a_request(self) -> None:
        with pytest.raises(ValueError, match="actions is empty"):
            _make_desktop().step([])
