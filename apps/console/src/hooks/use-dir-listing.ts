"use client"

import { useQuery } from "@tanstack/react-query"

import {
  FileListingUnavailableError,
  listDir,
  type DirEntry,
} from "@/lib/api/files"
import { fileKeys } from "@/lib/api/query-keys"
import type { SandboxResponse } from "@/lib/api/types"

/**
 * Lazily list one directory of a sandbox. Keyed by (sandboxId, path) so each
 * folder is cached and invalidated independently — never recursive. Only runs
 * for an active sandbox; the access token (rotated on resume) is read fresh from
 * the sandbox prop on each fetch.
 */
export function useDirListing(sandbox: SandboxResponse, path: string) {
  return useQuery<DirEntry[]>({
    queryKey: fileKeys.listing(sandbox.id, path),
    queryFn: ({ signal }) => listDir(sandbox, path, signal),
    enabled: sandbox.status === "active",
    staleTime: 10_000,
    // Listing-unavailable (old data plane) and not-found are deterministic —
    // don't hammer the data plane retrying them; allow one retry for blips.
    retry: (count, error) =>
      !(error instanceof FileListingUnavailableError) && count < 1,
  })
}
