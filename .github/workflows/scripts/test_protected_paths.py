import io
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import protected_paths as pp

ROOT = Path(__file__).resolve().parents[3]


class PatternTest(unittest.TestCase):
    def test_patterns_match_like_codeowners(self):
        cases = {
            "/infra/": (["infra/a.tf", "infra/envs/x/main.tf"], ["infrastructure.md", "x/infra/a.tf"]),
            "/Dockerfile": (["Dockerfile"], ["Dockerfile.dev", "cmd/Dockerfile"]),
            "/internal/api/billing_*": (["internal/api/billing_rollup.go"], ["internal/api/billing/x.go"]),
            "/app/(auth)/**/*action.ts": (["app/(auth)/a/b/action.ts", "app/(auth)/google-action.ts"],
                                          ["app/(auth)/a/page.tsx"]),
        }
        for pattern, (hits, misses) in cases.items():
            regex = pp.pattern_regex(pattern)
            for path in hits:
                self.assertTrue(regex.match(path), f"{pattern} should match {path}")
            for path in misses:
                self.assertFalse(regex.match(path), f"{pattern} should not match {path}")

    def test_unanchored_patterns_and_team_owners_are_rejected(self):
        with self.assertRaises(ValueError):
            pp.parse_rules("*.sql @owner")
        with self.assertRaises(ValueError):
            pp.parse_rules("/infra/ @org/team")


class EvaluateTest(unittest.TestCase):
    rules = pp.parse_rules("/infra/ @alice @bob\n/infra/README.md\n/supabase/ @alice\n")

    def test_last_match_wins_and_ownerless_line_unprotects(self):
        self.assertEqual(pp.evaluate(self.rules, ["infra/README.md", "docs/a.md"]), {})

    def test_protected_files_are_classified_without_querying_reviews(self):
        self.assertEqual(pp.evaluate(self.rules, ["infra/main.tf", "supabase/a.sql"]),
                         {"infra/main.tf": {"alice", "bob"}, "supabase/a.sql": {"alice"}})


class MainTest(unittest.TestCase):
    def run_check(self, files):
        env = {"GITHUB_REPOSITORY": "superserve-ai/superserve", "PR_NUMBER": "12", "BASE_SHA": "base"}
        with patch.dict(os.environ, env, clear=True), patch("sys.stdout", new_callable=io.StringIO) as out, \
                patch.object(pp, "base_rules", return_value="/infra/ @alice"), \
                patch.object(pp, "paginate", return_value=files) as api:
            result = pp.main()
            api.assert_called_once_with("/repos/superserve-ai/superserve/pulls/12/files")
            return result, out.getvalue()

    def test_rename_out_of_protected_path_reports_human_merge_decision_without_failing(self):
        result, output = self.run_check([{"filename": "docs/moved.tf", "previous_filename": "infra/main.tf"}])
        self.assertEqual(result, 0)
        self.assertIn("infra/main.tf", output)
        self.assertIn("human merge decision required", output)

    def test_ordinary_pr_passes_without_human_review(self):
        result, output = self.run_check([{"filename": "apps/console/src/app/page.tsx"}])
        self.assertEqual(result, 0)
        self.assertIn("no protected path", output)

    def test_truncated_file_lists_fail_instead_of_claiming_ordinary(self):
        self.assertEqual(self.run_check([{"filename": "docs/a.md"}] * 3000)[0], 1)


class RepositoryProtectedPathsTest(unittest.TestCase):
    # Sensitive files that reviews found unowned. Dropping or narrowing the entry
    # that covers one of them fails here instead of silently removing the gate.
    MUST_BE_PROTECTED = [
        ".github/protected-paths",
        ".github/workflows/protected-paths.yml",
        ".github/workflows/scripts/protected_paths.py",
        "CLAUDE.md",
        "apps/console/src/app/(dashboard)/admin/billing/teams/[team_id]/actions.ts",
        "apps/console/src/app/(public)/device/actions.ts",
        "apps/console/src/app/(auth)/auth/signin/google-signup-check.ts",
        "apps/console/src/lib/cells.ts",
        "apps/console/src/lib/api/legacy-plan-entry.ts",
        "apps/console/src/lib/cloudflare/turnstile-client.ts",
        "apps/console/src/lib/fingerprint/account-device-action.ts",
        "apps/console/src/lib/recaptcha/verify.ts",
    ]

    @classmethod
    def setUpClass(cls):
        cls.rules = pp.parse_rules((ROOT / pp.PROTECTED_PATHS).read_text())
        cls.files = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, capture_output=True,
                                   text=True).stdout.splitlines()

    def test_every_protected_pattern_matches_a_tracked_file(self):
        # A mistyped or stale pattern protects nothing and fails silently otherwise.
        stale = [pattern for regex, pattern, _ in self.rules if not any(regex.match(f) for f in self.files)]
        self.assertEqual(stale, [])

    def test_known_sensitive_files_stay_protected(self):
        for path in self.MUST_BE_PROTECTED:
            self.assertIn(path, self.files, f"{path} moved: update this list and .github/protected-paths")
            self.assertTrue(pp.owners_for(self.rules, path), f"{path} is not protected")

    def test_no_codeowners_file(self):
        # Code-owner review is on in the main rulesets, so a CODEOWNERS file in any
        # location GitHub reads would require a named owner's approval.
        found = {".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"} & set(self.files)
        self.assertEqual(found, set())


if __name__ == "__main__":
    unittest.main()
