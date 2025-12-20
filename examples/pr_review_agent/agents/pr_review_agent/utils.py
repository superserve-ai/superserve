"""
Utility helpers for the PR Review Agent.
"""

import re
from typing import Any


def extract_pr_url(text: str) -> str:
    """
    Extract a GitHub Pull Request URL from free-form text.
    """
    match = re.search(
        r"https://github\.com/[^/]+/[^/]+/pull/\d+",
        text,
    )
    if not match:
        raise ValueError("No valid GitHub Pull Request URL found in the message.")
    return match.group(0)


def summarize_reviews(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Aggregate per-file reviews into a concise summary.
    """
    high = []
    medium = []

    for r in reviews:
        if r is None:
            continue
        review = r.get("review", {})
        severity = review.get("severity")
        if severity == "high":
            high.append(r["filename"])
        elif severity == "medium":
            medium.append(r["filename"])

    summary_lines = [
        f"Reviewed {len(reviews)} files.",
    ]

    if high:
        summary_lines.append(f"⚠️ High severity issues found in: {', '.join(high)}")

    if medium:
        summary_lines.append(f"⚠️ Medium severity issues found in: {', '.join(medium)}")

    if not high and not medium:
        summary_lines.append("✅ No high or medium severity issues detected.")

    return {
        "summary": " ".join(summary_lines),
        "high_severity_files": high,
        "medium_severity_files": medium,
    }
