#!/usr/bin/env python3
"""Fail a pull request that changes a protected path without a human owner's approval.

.github/CODEOWNERS lists only protected paths, so every owned file is protected.
A changed file passes once one of its owners, other than the PR author and not a
bot, has a standing approval, which matches GitHub's code-owner review. The rules
come from the base branch, as GitHub reads them, so a PR cannot loosen its own.
"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

CODEOWNERS = ".github/CODEOWNERS"


def pattern_regex(pattern):
    if not pattern.startswith("/"):
        raise ValueError(f"{pattern}: anchor the pattern at the repository root with a leading /")
    body = pattern[1:]
    directory = body.endswith("/")
    body = body.rstrip("/")
    out, i = [], 0
    while i < len(body):
        if body.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif body.startswith("**", i):
            out.append(".*")
            i += 2
        elif body[i] == "*":
            out.append("[^/]*")
            i += 1
        elif body[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(body[i]))
            i += 1
    # Like gitignore, a pattern without a trailing slash also matches a directory.
    return re.compile("^" + "".join(out) + ("/.*$" if directory else "(?:/.*)?$"))


def parse_codeowners(text):
    rules = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        pattern, *owners = line.split()
        for owner in owners:
            if not owner.startswith("@") or "/" in owner:
                raise ValueError(f"{CODEOWNERS}:{number}: {owner}: list individual @users, not teams or emails")
        try:
            regex = pattern_regex(pattern)
        except ValueError as err:
            raise ValueError(f"{CODEOWNERS}:{number}: {err}") from None
        rules.append((regex, pattern, {owner[1:] for owner in owners}))
    return rules


def owners_for(rules, path):
    # The last matching line wins, and a line without owners leaves the path unowned.
    for regex, _, owners in reversed(rules):
        if regex.match(path):
            return owners
    return set()


def human_approvers(reviews, author):
    latest = {}
    for review in reviews:
        if review["state"] in ("COMMENTED", "PENDING") or not review.get("user"):
            continue
        latest[review["user"]["login"].lower()] = review
    return {
        login
        for login, review in latest.items()
        if review["state"] == "APPROVED" and review["user"]["type"] == "User" and login != author.lower()
    }


def evaluate(rules, paths, reviews, author):
    approvers = human_approvers(reviews, author)
    protected, missing = {}, []
    for path in sorted(set(paths)):
        owners = owners_for(rules, path)
        if owners:
            protected[path] = owners
            if not {owner.lower() for owner in owners} & approvers:
                missing.append(path)
    return protected, missing


def api(path):
    url = os.environ.get("GITHUB_API_URL", "https://api.github.com") + path
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def paginate(path):
    items, page = [], 1
    while True:
        batch = api(f"{path}?per_page=100&page={page}")
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def base_codeowners(repo, base_sha):
    try:
        content = api(f"/repos/{repo}/contents/{CODEOWNERS}?ref={base_sha}")
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return ""
        raise
    return base64.b64decode(content["content"]).decode()


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    number = os.environ["PR_NUMBER"]
    author = os.environ["PR_AUTHOR"]
    rules = parse_codeowners(base_codeowners(repo, os.environ["BASE_SHA"]))

    files = paginate(f"/repos/{repo}/pulls/{number}/files")
    # The files API stops at 3000 entries; anything past that is unseen.
    if len(files) >= 3000:
        print("::error::This PR changes 3000 or more files, so its protected paths cannot be listed.")
        return 1
    paths = [f["filename"] for f in files] + [f["previous_filename"] for f in files if f.get("previous_filename")]

    protected, missing = evaluate(rules, paths, paginate(f"/repos/{repo}/pulls/{number}/reviews"), author)
    summary = ["## Protected paths", ""]
    if not protected:
        summary.append("This PR changes no protected path.")
    for path, owners in protected.items():
        state = "needs approval" if path in missing else "approved"
        summary.append(f"- `{path}`: {state} (owners: {', '.join('@' + o for o in sorted(owners))})")
    print("\n".join(summary))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
            out.write("\n".join(summary) + "\n")

    if missing:
        print(f"::error::{len(missing)} protected path(s) need an approval from a human code owner "
              f"who is not the PR author. Bots must not merge this PR until then (see {CODEOWNERS}).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
