"use client"

import { useQuery } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"
import { listDir, type DirEntry } from "@/lib/api/files"
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
    queryFn: () => listDir(sandbox, path),
    enabled: sandbox.status === "active",
    staleTime: 10_000,
    // 400 (bad path) and 404 (not found) are deterministic — don't retry them;
    // allow one retry for 5xx / network blips.
    retry: (count, error) => {
      const status = error instanceof ApiError ? error.status : 0
      return status !== 400 && status !== 404 && count < 1
    },
  })
}
