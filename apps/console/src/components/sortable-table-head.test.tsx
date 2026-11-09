import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { SortDirection } from "@/lib/api/types"

import { SortableTableHead } from "./sortable-table-head"

function renderHead(activeSort: string, order: SortDirection = "asc") {
  const onSort = vi.fn()
  render(
    <table>
      <thead>
        <tr>
          <SortableTableHead
            column="name"
            label="Name"
            activeSort={activeSort}
            order={order}
            onSort={onSort}
          />
        </tr>
      </thead>
    </table>,
  )
  return { onSort, header: screen.getByRole("columnheader") }
}

describe("SortableTableHead", () => {
  it.each([
    ["asc", "ascending"],
    ["desc", "descending"],
  ] as const)(
    "marks the active column %s with aria-sort",
    (order, ariaSort) => {
      const { header } = renderHead("name", order)
      expect(header).toHaveAttribute("aria-sort", ariaSort)
    },
  )

  it("leaves aria-sort off columns that are not sorted", () => {
    const { header } = renderHead("created_at")
    expect(header).not.toHaveAttribute("aria-sort")
  })

  it("shows the idle sort icon at rest", () => {
    const { header } = renderHead("created_at")
    const icon = header.querySelector("svg")
    expect(icon).not.toBeNull()
    expect(icon).not.toHaveClass("opacity-0")
  })

  it("highlights the sort direction icon on the active column", () => {
    const { header } = renderHead("name", "desc")
    expect(header.querySelector("svg")).toHaveClass("text-brand")
  })

  it("sorts by its column on click", () => {
    const { onSort } = renderHead("created_at")
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }))
    expect(onSort).toHaveBeenCalledWith("name")
  })
})
