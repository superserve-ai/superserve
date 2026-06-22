# Backward-compatible sandbox directory listing

Date: 2026-06-20
Status: Approved (design) — implementing
Repos: `sandbox` (kathmandu, Go backend) + `superserve` (palenque, console)

## Problem

The console file browser lists a directory by calling the data-plane
`GET /files?path=…&format=json` on boxd. `format=json` is a **new** boxd handler
(`cmd/boxd/main.go:866`). boxd is baked into a sandbox's snapshot at creation
time, so **every sandbox created before the boxd rollout returns the legacy
`400 {"error":"use FilesystemService.ListDir for directories"}`** (`main.go:872`),
which the console surfaces as "Directory listing isn't available for this sandbox
yet" (`apps/console/src/lib/api/files.ts:170`). Re-running the deploy workflows
updates template snapshots, not existing sandboxes — so live users with existing
sandboxes cannot use the feature. That is the blocker this design removes.

## Key insight

boxd's `FilesystemService.ListDir` gRPC method (`cmd/boxd/main.go:750`) **already
exists on every deployed sandbox** — the legacy 400 literally names it. It applies
the same `safePath` blocklist as `/files` (`main.go:751`), so there is no security
regression. The backend already states the intended split
(`internal/vm/manager.go:1228`): _"File operations (Connect RPC for metadata only;
byte transfer lives on the edge proxy's /files endpoint)."_ Listing is metadata,
so it belongs on the Connect-RPC path — the same channel `Manager.DeleteFile`
(`manager.go:1233`) already uses.

We therefore list via the control plane and stop using data-plane `format=json`.
Because old boxd already answers `ListDir`, **the core feature works on existing
sandboxes with no boxd change, no template reseed, and no new infrastructure.**

## Architecture

```
Browser (file browser)
  → /api/sandboxes/:id/files?path=…          Next API proxy (Supabase auth → server X-API-Key), same-origin
  → GET /sandboxes/:id/files   [platform API]   loadActiveOrResumeSandbox + vmdForHost
  → vmd ListDir RPC            [vmdpb, NEW]      API → vmd (gRPC)
  → Manager.ListDir → boxd FilesystemService.ListDir  [Connect RPC, EXISTS everywhere]
```

Read/write/upload/download stay on the data plane (`filesUrl`); only listing moves.
Paused sandboxes auto-resume via the existing `loadActiveOrResumeSandbox`, exactly
like exec.

## Components (build order)

All layers mirror the existing `ExecCommand` path, which already spans the same
proto → adapter → manager → client → API chain.

1. **`proto/vmd.proto`** — add `rpc ListDir(ListDirRequest) returns (ListDirResponse)`
   with `ListDirRequest{ string vm_id; string path; }`,
   `ListDirResponse{ repeated ListDirEntry entries; }`,
   `ListDirEntry{ string name; bool is_dir; int64 size; int64 modified_unix; }`.
   Regenerate with `make generate-proto` (pin protoc-gen-go / protoc-gen-go-grpc
   to the versions in the existing `.pb.go` headers to avoid a noisy diff).
2. **`internal/vm/grpc_adapter.go`** — implement `ListDir` → `Manager.ListDir`,
   mapping boxd `FileEntry` → `ListDirEntry`.
3. **`internal/vm/manager.go`** — `ListDir(ctx, vmID, path)`; mirror `DeleteFile`
   (`getRunningVMIP` + `boxdFilesystemClient(vmIP).ListDir`).
4. **`internal/vmdclient/`** — `Client.ListDir(...)` wrapping the unary RPC.
5. **`internal/api/handlers.go` + `router.go`** — `GET /sandboxes/:sandbox_id/files?path=…`
   → `200 {"entries":[{name,is_dir,size,modified_unix}]}`. Auth + load via existing
   middleware/`loadActiveOrResumeSandbox`.
6. **Console** — `apps/console/src/lib/api/files.ts` `listDir()` calls
   `/api/sandboxes/:id/files`; delete `FileListingUnavailableError` and the
   data-plane `format=json` path. `DirEntry` shape is unchanged, so `file-row.tsx`
   / `file-browser.tsx` are untouched. Update `files.test.ts`.

## Modified time (decision: B-1)

boxd's gRPC `FileEntry` carries only name/is_dir/size — no mtime — and the row
renders a date (`file-row.tsx:92`). Adding a proto field only populates on new
boxd, so existing sandboxes cannot get mtime via this path.

**B-1 (chosen):** add `int64 modified_unix = 4` to boxd's `FileEntry`
(`proto/boxd.proto`) and populate it in `serveDir`/`ListDir` (`os.FileInfo.ModTime`).
New sandboxes show dates once boxd ships through the normal VMD + template reseed;
existing sandboxes return `0` and the console renders "—" when `modified_unix === 0`.
Browsing (name/size/type/navigation) works on every sandbox immediately. Wire
compatibility holds: a new Manager reading an old boxd's response leaves the absent
field `0`.

Rejected: per-entry `Stat` enrichment (N round-trips per listing).

## Error handling

- Folder not found → boxd `CodeNotFound` → API `404` → existing "Folder not found".
- Path is a file, not a directory → `os.ReadDir` error → API `400 "not a directory"`.
- VM gone → reuse `isVMDNotFound`/`ErrSandboxGone` → `410`.
- Path validation → require absolute, reject `..` at the API edge; boxd `safePath`
  re-gates regardless.
- Empty dir → `{"entries":[]}`.

## Rollout

- **Core (existing sandboxes list correctly):** Deploy API + Deploy VMD only.
  No Seed Templates, no proxy change, no new infra.
- **mtime nicety (dates on new sandboxes):** the boxd `FileEntry` field rides the
  normal Deploy VMD + Seed Templates pipeline; non-blocking for the core feature.

## Testing

- boxd (`go test -race`): `ListDir` populates `modified_unix`; existing cases hold.
- vmd/api (`go test -race`): adapter + handler — found dir, empty, not-found,
  file-not-dir (400), traversal rejected, VM-gone (410). Mirror exec handler tests.
- console (Vitest): `listDir()` hits `/api/...`; drop the legacy-400 mapping test,
  add the new endpoint-shape test; date hidden when `modified_unix === 0`.
- Staging manual: an existing **pre-reseed** sandbox must list correctly — the
  whole point.

## Out of scope

- SDK `files.list` (TS/Python) — natural follow-up once the API endpoint exists.
- Removing boxd's now-unused `serveDirAsJSON` / `format=json` — leave in place; dead.
- Directory download (`format=zip`) backward compat — same root cause, separate ship.
