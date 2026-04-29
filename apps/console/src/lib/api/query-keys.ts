export const sandboxKeys = {
  all: ["sandboxes"] as const,
  lists: () => [...sandboxKeys.all, "list"] as const,
  list: (filters: { status?: string; search?: string }) =>
    [...sandboxKeys.lists(), filters] as const,
  details: () => [...sandboxKeys.all, "detail"] as const,
  detail: (id: string) => [...sandboxKeys.details(), id] as const,
}

export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...apiKeyKeys.lists(), filters] as const,
}

export const snapshotKeys = {
  all: ["snapshots"] as const,
  lists: () => [...snapshotKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...snapshotKeys.lists(), filters] as const,
  bySandbox: (sandboxId: string) =>
    [...snapshotKeys.all, "sandbox", sandboxId] as const,
}

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditLogKeys.all, "list"] as const,
  list: (filters?: { action?: string; search?: string }) =>
    [...auditLogKeys.lists(), filters] as const,
  bySandbox: (sandboxId: string) =>
    [...auditLogKeys.all, "sandbox", sandboxId] as const,
}

export const templateKeys = {
  all: ["templates"] as const,
  lists: () => [...templateKeys.all, "list"] as const,
  list: (filters?: { alias_prefix?: string }) =>
    [...templateKeys.lists(), filters ?? {}] as const,
  details: () => [...templateKeys.all, "detail"] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
  builds: (templateId: string) =>
    [...templateKeys.detail(templateId), "builds"] as const,
  build: (templateId: string, buildId: string) =>
    [...templateKeys.builds(templateId), buildId] as const,
}
