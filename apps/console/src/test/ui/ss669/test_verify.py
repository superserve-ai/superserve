"""Regression checks for fixture server ownership without starting a browser."""

import io
import json
import unittest
from unittest.mock import Mock, patch

import verify


class ServerOwnershipTests(unittest.TestCase):
    def test_existing_fixture_requires_explicit_reuse(self):
        with patch.object(verify, "health", return_value=True), patch.object(
            verify.subprocess, "Popen"
        ) as spawn:
            with self.assertRaisesRegex(RuntimeError, "already in use"):
                with verify.server(None):
                    self.fail("An existing fixture was reused")
            spawn.assert_not_called()

    def test_health_rejects_a_different_run_but_allows_explicit_reuse(self):
        payload = {"fixture": "ss669-storage-billing", "run_id": "other-run"}
        for expected_run, expected_result in [("this-run", False), ("other-run", True), (None, True)]:
            with self.subTest(expected_run=expected_run), patch.object(
                verify, "urlopen", return_value=io.StringIO(json.dumps(payload))
            ):
                self.assertEqual(verify.health("http://127.0.0.1:4174", expected_run), expected_result)

    def test_startup_race_does_not_yield_a_foreign_server(self):
        process = Mock(pid=12345)
        process.poll.side_effect = [None, 1]
        with patch.object(verify, "health", return_value=False) as health, patch.object(
            verify.subprocess, "Popen", return_value=process
        ) as spawn, patch.object(verify.os, "killpg") as kill, patch.object(verify.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "failed to start"):
                with verify.server(None):
                    self.fail("A foreign server satisfied startup")
            run_id = spawn.call_args.kwargs["env"]["SS669_UI_RUN_ID"]
            self.assertTrue(run_id)
            self.assertEqual(health.call_args.args, ("http://127.0.0.1:4174", run_id))
            kill.assert_called_once_with(process.pid, verify.signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
