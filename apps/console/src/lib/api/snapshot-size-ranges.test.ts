import { describe, expect, it } from "vitest"

import {
  snapshotSizeRanges,
  type SnapshotSizeRow,
} from "./snapshot-size-ranges"

const row = (over: Partial<SnapshotSizeRow>): SnapshotSizeRow => ({
  vcpu_count: 2,
  vcpu_max: null,
  vcpu_selectable: true,
  fixed_cpu_image_vcpus: null,
  fixed_cpu_image_min_vcpus: null,
  memory_mib: 2048,
  memory_max_mib: null,
  memory_shrink_after_seconds: null,
  fixed_memory_image_boot_mib: null,
  fixed_memory_image_max_mib: null,
  ...over,
})

// Mirrors the API's cases: the ranges must be exactly what a copy may choose.
describe("snapshotSizeRanges", () => {
  it.each([
    [
      "growable source",
      row({
        vcpu_count: 1,
        vcpu_max: 4,
        memory_mib: 1024,
        memory_max_mib: 4096,
      }),
      { vcpu_range: { min: 1, max: 4 } },
    ],
    [
      "growable source whose template doesn't let sandboxes choose",
      row({ vcpu_count: 1, vcpu_max: 4, vcpu_selectable: false }),
      {},
    ],
    [
      "sized source",
      row({
        fixed_cpu_image_min_vcpus: 1,
        fixed_cpu_image_vcpus: 4,
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4096,
      }),
      {
        vcpu_range: { min: 1, max: 4 },
        memory_range_mib: { min: 1024, max: 4096 },
      },
    ],
    ["fixed-size template source", row({}), {}],
    [
      "older sized row without a recorded CPU minimum",
      row({ fixed_cpu_image_vcpus: 4 }),
      {},
    ],
    [
      "memory image on a growable row",
      row({
        memory_max_mib: 4096,
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4096,
      }),
      {},
    ],
    [
      "memory image with a shrink delay",
      row({
        memory_shrink_after_seconds: 300,
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4096,
      }),
      {},
    ],
    [
      "grant outside the memory image",
      row({
        memory_mib: 8192,
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4096,
      }),
      {},
    ],
    [
      "memory image off the 128 MiB slots",
      row({
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4000,
      }),
      {},
    ],
  ])("%s", (_name, input, want) => {
    expect(snapshotSizeRanges(input)).toEqual(want)
  })
})
