import type { SnapshotSizeRange } from "@/lib/api/types"

/** The `sandbox_snapshot` columns the size ranges are derived from. */
export interface SnapshotSizeRow {
  vcpu_count: number
  vcpu_max: number | null
  /** Whether the source's template lets sandboxes choose a vCPU count. */
  vcpu_selectable: boolean
  fixed_cpu_image_vcpus: number | null
  fixed_cpu_image_min_vcpus: number | null
  memory_mib: number
  memory_max_mib: number | null
  memory_shrink_after_seconds: number | null
  fixed_memory_image_boot_mib: number | null
  fixed_memory_image_max_mib: number | null
}

/**
 * The `vcpu` / `memory_mib` a sandbox created from the snapshot may choose,
 * derived exactly as the API's snapshot response does, so the console offers
 * only sizes the create accepts.
 */
export function snapshotSizeRanges(s: SnapshotSizeRow): {
  vcpu_range?: SnapshotSizeRange
  memory_range_mib?: SnapshotSizeRange
} {
  const out: {
    vcpu_range?: SnapshotSizeRange
    memory_range_mib?: SnapshotSizeRange
  } = {}

  if (s.vcpu_max != null && s.vcpu_count > 0 && s.vcpu_selectable) {
    out.vcpu_range = { min: s.vcpu_count, max: s.vcpu_max }
  } else if (
    s.fixed_cpu_image_min_vcpus != null &&
    s.fixed_cpu_image_min_vcpus > 0 &&
    s.fixed_cpu_image_vcpus != null
  ) {
    out.vcpu_range = {
      min: s.fixed_cpu_image_min_vcpus,
      max: s.fixed_cpu_image_vcpus,
    }
  }

  // Only a fixed RAM grant on a consistent memory image: the image uses
  // 128 MiB slots and a 2 MiB block, and the grant sits within it.
  const boot = s.fixed_memory_image_boot_mib
  const max = s.fixed_memory_image_max_mib
  const grant = s.memory_mib
  if (
    boot != null &&
    max != null &&
    boot > 0 &&
    max > boot &&
    grant > 0 &&
    s.memory_max_mib == null &&
    s.memory_shrink_after_seconds == null &&
    (max - boot) % 128 === 0 &&
    grant >= boot &&
    grant - boot <= max - boot &&
    (grant - boot) % 2 === 0
  ) {
    out.memory_range_mib = { min: boot, max }
  }
  return out
}
