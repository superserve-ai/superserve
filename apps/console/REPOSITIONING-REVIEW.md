# Console — Repositioning Review (HIGH-risk, needs human approval)

Repositioning thesis: Superserve → **open agent infrastructure**. Two composable
primitives on one substrate:

- **Sandbox** = "a computer that remembers" — compute + persistent versioned
  filesystem; exec/fs/ports; hibernate + resume by id. (Ships today; already
  well-articulated — keep + sharpen.)
- **Actor** = "a process that survives" — a named, durable, single-writer entity
  that wakes on events, serializes input through an inbox, checkpoints, hibernates,
  addressable anywhere. (Platform direction — exists today only as a hand-built
  pattern, NOT a shipped Console feature or API.)

Body vs brain: the platform is the durable BODY; any harness (Claude Code, Codex,
Claude Agent SDK, AI SDK, your own loop, …) is the interchangeable BRAIN.

This file lists Console changes that are **HIGH-risk** (product naming, primary nav
labels, top-level IA, dashboard hero) and were therefore **NOT applied live**. The
LOW/MED-risk copy edits that ship alongside this are listed at the bottom for context.

---

## 1. Meta title / product surface name — `src/app/layout.tsx`

The browser tab title and OpenGraph/Twitter titles are the product's name in
search results and link unfurls. Naming is high-risk; proposing for review only.

**Current**

```ts
title: {
  default: "Superserve Console",
  template: "%s | Superserve",
},
// openGraph.title / twitter.title: "Superserve Console"
```

**Proposed (Option A — minimal, recommended)** — keep the name, no change. The
positioning shift is carried entirely by the meta `description` (already updated
live, see bottom). Lowest risk; "Console" stays the surface name.

**Proposed (Option B — positioning in the unfurl title only)**

```ts
default: "Superserve Console — Open agent infrastructure",
// openGraph.title / twitter.title: "Superserve Console — Open agent infrastructure"
```

Rationale: surfaces the new tagline where it has the most reach (social/search)
without renaming the in-app product. Tab title gets longer; verify truncation.

Recommendation: ship Option A now; revisit Option B when the public website hero
locks the exact tagline so wording stays consistent across surfaces.

---

## 2. Sidebar primary nav — introduce "Actors" (IA change) — `src/components/sidebar/nav-config.ts`

Current main nav:
`Sandboxes · Templates · Secrets · Audit Logs · API Keys · Plan & Usage · Settings`
(`Snapshots` is present but commented out: "re-enable when Snapshots ships".)

The repositioning makes **Actor** a first-class primitive alongside **Sandbox**.
The natural IA expression is a top-level **Actors** nav entry. However:

- There is **no Actors backend, page, or API in the Console today** — Actor is
  currently a hand-built pattern, not a shipped surface.
- Adding a nav item that routes nowhere (or to a stub) is a broken-IA / build risk
  and would over-claim a feature that does not exist.

**Proposal: do NOT add an Actors nav item yet.** Instead:

1. **Group the existing items under a "Sandboxes" / "Compute" heading** so the IA is
   ready to gain an "Actors" sibling later. (Requires a grouped-nav variant in
   `SidebarNav`; not currently supported — see note below.)
2. When the Actors surface ships, add:
   ```ts
   { label: "Actors", href: "/actors", icon: LightningIcon },
   ```
   positioned directly under `Sandboxes` (the two primitives sit together).

Decision needed from human: do we want a placeholder/"coming soon" Actors nav entry
now (forward-looking, but routes nowhere), or hold until the surface is real?
Default recommendation: **hold** — keep nav honest to what ships.

Note: `SidebarNav` currently renders a flat `NavItem[]` with no section headers.
Introducing primitive groupings ("Compute / Sandboxes", "Durable / Actors") is a
component change, not just copy — out of scope for a copy pass; flagged here.

---

## 3. Dashboard landing redirect — `src/app/(dashboard)/page.tsx`

**Current:** `/` redirects to `/sandboxes`.

No change proposed. Once an Actors or unified overview surface exists, reconsider the
default landing route. Listed only so the IA decision is captured in one place.

---

## 4. Sandboxes empty-state TITLE — `src/app/(dashboard)/sandboxes/page.tsx`

The empty-state **title** ("No Sandboxes") is the closest thing the Console has to a
hero for the core primitive. Title left unchanged (it is accurate and neutral). The
**secondary description** beneath it WAS updated live (LOW/MED-risk) to carry the
"a computer that remembers" framing — see bottom. Flagging the title here only so a
reviewer can decide whether a more evocative title (e.g. "No sandboxes yet") is
wanted; not changed to avoid touching hero-adjacent copy unilaterally.

---

## LOW/MED-risk edits already applied live (for reviewer context)

| File                                       | Before → After (summary)                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`                       | Meta + OG + Twitter `description`: "Deploy and manage cloud sandboxes…" → "Open agent infrastructure from Superserve. Run any harness on persistent, versioned sandboxes — a computer that remembers, with hibernate and resume by id." |
| `src/app/(dashboard)/sandboxes/page.tsx`   | Empty-state description → "A sandbox is a computer that remembers: compute plus a persistent, versioned filesystem you can hibernate and resume by id. Create one to run any harness or your own code."                                 |
| `src/app/(dashboard)/templates/page.tsx`   | Empty-state description → "…start from a curated base or bring your own OCI image. Create one to reuse the same environment across sandboxes."                                                                                          |
| `src/app/(dashboard)/get-started/page.tsx` | Intro subtitle → "Install the SDK and spin up your first persistent sandbox"                                                                                                                                                            |
| `README.md`                                | Lead sentence → "…console for Superserve's open agent infrastructure — manage persistent sandboxes, templates, secrets, and API keys."                                                                                                  |

All applied edits keep concrete API claims accurate to what ships today
(pause/resume = hibernate/resume, templates, custom OCI base images, exec). No Actor
API surface or unbuilt feature is implied in shipped copy. "Run any harness" is used
as positioning, not as a named API.
