import subprocess
import unittest
from pathlib import Path

import protected_paths as pp

ROOT = Path(__file__).resolve().parents[3]


def review(login, state, kind="User"):
    return {"user": {"login": login, "type": kind}, "state": state}


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
            pp.parse_codeowners("*.sql @owner")
        with self.assertRaises(ValueError):
            pp.parse_codeowners("/infra/ @org/team")


class EvaluateTest(unittest.TestCase):
    rules = pp.parse_codeowners("/infra/ @alice @bob\n/infra/README.md\n/supabase/ @alice\n")

    def test_last_match_wins_and_ownerless_line_unprotects(self):
        protected, missing = pp.evaluate(self.rules, ["infra/README.md", "docs/a.md"], [], "bot[bot]")
        self.assertEqual((protected, missing), ({}, []))

    def test_only_a_standing_human_owner_approval_counts(self):
        paths = ["infra/main.tf", "supabase/migrations/1.sql"]
        reviews = [review("superserve-qm[bot]", "APPROVED", "Bot"), review("bob", "APPROVED")]
        _, missing = pp.evaluate(self.rules, paths, reviews, "vorflux[bot]")
        self.assertEqual(missing, ["supabase/migrations/1.sql"])

        reviews += [review("alice", "APPROVED"), review("alice", "COMMENTED")]
        self.assertEqual(pp.evaluate(self.rules, paths, reviews, "vorflux[bot]")[1], [])

        reviews.append(review("alice", "DISMISSED"))
        self.assertEqual(pp.evaluate(self.rules, paths, reviews, "vorflux[bot]")[1], ["supabase/migrations/1.sql"])

    def test_author_cannot_satisfy_their_own_protected_change(self):
        _, missing = pp.evaluate(self.rules, ["supabase/x.sql"], [review("Alice", "APPROVED")], "alice")
        self.assertEqual(missing, ["supabase/x.sql"])


class RepositoryCodeownersTest(unittest.TestCase):
    def test_every_protected_pattern_matches_a_tracked_file(self):
        # A mistyped or stale pattern protects nothing and fails silently otherwise.
        rules = pp.parse_codeowners((ROOT / pp.CODEOWNERS).read_text())
        files = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, capture_output=True,
                               text=True).stdout.splitlines()
        stale = [pattern for regex, pattern, _ in rules if not any(regex.match(f) for f in files)]
        self.assertEqual(stale, [])


if __name__ == "__main__":
    unittest.main()
