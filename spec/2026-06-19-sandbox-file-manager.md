# Sandbox File Manager — navigable browsing + drag-drop upload

**Date:** 2026-06-19
**Status:** Approved, in implementation
**Repos:** `palenque` (console) + `kathmandu` (boxd)

## Problem

The Files section on `/sandboxes/<id>` is path-typing only: to upload or download
you type an absolute path into a text field. There is no way to see what is in a
sandbox, and uploading requires knowing the destination path up front. We want a
native file-manager experience: browse folders, and drag an OS file onto a folder
to upload it there.

The blocker is listing. The data plane exposes only `/files` (GET=download a file
or zip a dir, POST=upload), `/terminal`, and `/exec*`. boxd already implements a
full `FilesystemService` (`ListDir`, `Stat`, `MakeDir`, `Remove`, `Move`) over
connect-rpc, but the edge proxy 404s every connect-rpc route as strictly internal,
so **no directory listing reaches the browser today.**

## Approach (decision: B)

Surface boxd's existing `os.ReadDir` listing over the **existing `/files` plumbing**
as a JSON response, gated by a new `?format=json` flag — symmetric with the
`?format=zip` directory-download flag already in place.

**This is a boxd-only backend change.** The proxy's `/files` reverse-proxy
preserves the query string untouched (it only inspects `path` for the `..` check
and the access token); that is exactly why today's `?format=zip` reaches boxd with
no proxy code. `?format=json` flows through the same allow-listed path. No proxy
change, no proxy deploy.

Rejected alternatives:

- **Exec-based listing** (`find`/`ls` over `/exec`, parse output) — ships with zero
  backend change but is image-dependent (busybox `find` lacks `-printf`), requires
  parsing hostile filenames, and puts a sandbox-controlled path into command
  construction. Less robust steady-state.
- **New `/files/list` path or proxied connect-rpc** — both need a proxy allow-list
  change and more surface for no benefit over overloading `?format=json`.

## Backend contract (kathmandu / boxd)

`GET /files?path=<abs>&format=json`

- `path` is a **directory** → `200 application/json`:
  ```json
  {
    "entries": [
      {
        "name": "src",
        "is_dir": true,
        "size": 4096,
        "modified_unix": 1718800000
      }
    ]
  }
  ```
  `entries` is always an array (empty dir → `{ "entries": [] }`, never `null`).
  Entries are returned in `os.ReadDir` order (sorted by name); the console applies
  its own dirs-first ordering.
- `path` is **not a directory** → unchanged file-serving behavior (a file is
  returned as-is, matching how `format=zip` treats a file). The console only sends
  `format=json` for directories it knows from navigation.
- Missing/blocklisted/`..` path → existing `safePath` / proxy rejections (400),
  unchanged.

Implementation: a `serveDirAsJSON(w, path)` mirroring `serveDirAsZip`'s call site,
dispatched from `handleFileDownload`'s `info.IsDir()` branch via a `switch` on
`format` (`zip` → zip, `json` → json, default → existing 400). Listing reads only
names/sizes/mtimes (`os.ReadDir` + `DirEntry.Info`); it does not open or stream file
contents and does not need the zip path's symlink/TOCTOU hardening — a symlinked dir
is followed like `ls` does, and the only thing exposed is entry names/sizes the
sandbox occupant can already read via `/exec`. The access token already scopes the
request to this one sandbox.

Fields kept deliberately minimal (`name`, `is_dir`, `size`, `modified_unix`) — no
mode/permissions.

## Console (palenque)

- **`listDir(sandbox, path)`** — a data-plane `fetch(filesUrl(id, path, {format:"json"}))`
  with `X-Access-Token`, mirroring the existing upload/download calls in
  `files-section.tsx`. Returns typed `DirEntry[]`. Tolerates the deploy gap: a 400
  "directories" response on an un-updated sandbox surfaces as "listing not available
  yet" rather than a hard error.
- **`useDirListing(sandbox, path)`** — React Query hook keyed
  `["sandbox-files", sandboxId, path]`, **lazy per-directory** (never recursive — a
  `node_modules` would be brutal). Dirs-first then alpha sort. Query key registered
  in `src/lib/api/query-keys.ts`.
- **Navigable browser** — the Files section becomes: a breadcrumb of the current
  path, folder rows (click to descend), file rows (download via the existing GET).
  Follows the console design language: dashed borders, `font-mono uppercase text-xs`
  headers, Phosphor icons `weight="light"`, sharp corners, mint for active state.
  Replaces the blind path-typing inputs.
- **Drag-drop upload** — dropping an OS file onto a folder row (or the current
  directory surface) uploads to `<that folder>/<filename>` via the existing
  `POST /files`, then invalidates the listing query so the new file appears. The
  drop target highlights (mint border) on drag-over. This reuses the upload
  mechanism already in `UploadPanel`; only the destination derivation and drop
  targeting are new.

Listing/navigation is gated on `status === "active"` exactly like today's panels
(paused/resuming/other show the existing empty state).

## Scope

**In:** boxd `format=json` listing; console navigable browser (breadcrumb, folder
descend, file download); drag-a-file-onto-a-folder upload with query invalidation.

**Out (follow-up):** in-UI mutations (delete / rename / mkdir — boxd already has
`Remove`/`Move`/`MakeDir`, not yet proxied); multi-file / folder upload; an SDK
`files.list()` (the console calls the endpoint directly, as it already does for
upload/download).

## Testing

- **boxd:** extend `cmd/boxd/files_test.go` (drives `handleFiles` directly) — JSON
  listing of a populated dir (names/is_dir/size present), empty dir → `{"entries":[]}`,
  file+json unchanged, blocklisted path still 400.
- **console:** vitest for `listDir` (URL/headers, JSON parse, error/deploy-gap
  mapping), the hook (sort order, keying), and the browser (descend, breadcrumb,
  drop-to-folder upload target + invalidation). Update `files-section.test.tsx`.
- Per repo rule: no console dev server / production build run here; rely on
  `turbo typecheck`, oxlint/oxfmt, and unit tests.

## Rollout

boxd ships ahead of universal sandbox refresh. On a sandbox still running old boxd,
`format=json` falls through to the legacy 400 directory message; the console maps
that to "listing not available yet," so the console can merge independently — same
graceful-degradation pattern as the directory-download feature (`fb7f2fe`).
