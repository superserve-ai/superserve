import { accordionMeta } from "../examples/accordion"
import { alertMeta } from "../examples/alert"
import { avatarMeta } from "../examples/avatar"
import { badgeMeta } from "../examples/badge"
import { breadcrumbsMeta } from "../examples/breadcrumbs"
import { buttonMeta } from "../examples/button"
import { cardMeta } from "../examples/card"
import { checkboxMeta } from "../examples/checkbox"
import { confirmDialogMeta } from "../examples/confirm-dialog"
import { dialogMeta } from "../examples/dialog"
import { dropdownMenuMeta } from "../examples/dropdown-menu"
import { formFieldMeta } from "../examples/form-field"
import { inputMeta } from "../examples/input"
import { kbdMeta } from "../examples/kbd"
import { popoverMeta } from "../examples/popover"
import { progressMeta } from "../examples/progress"
import { radioGroupMeta } from "../examples/radio-group"
import { selectMeta } from "../examples/select"
import { separatorMeta } from "../examples/separator"
import { skeletonMeta } from "../examples/skeleton"
import { switchMeta } from "../examples/switch"
import { tableMeta } from "../examples/table"
import { tabsMeta } from "../examples/tabs"
import { textareaMeta } from "../examples/textarea"
import { toastMeta } from "../examples/toast"
import { tooltipMeta } from "../examples/tooltip"
import type { Category, ComponentMeta } from "./types"

export const registry: ComponentMeta[] = [
  buttonMeta,
  inputMeta,
  textareaMeta,
  checkboxMeta,
  radioGroupMeta,
  switchMeta,
  selectMeta,
  formFieldMeta,
  badgeMeta,
  alertMeta,
  progressMeta,
  toastMeta,
  tooltipMeta,
  avatarMeta,
  cardMeta,
  tableMeta,
  tabsMeta,
  accordionMeta,
  breadcrumbsMeta,
  kbdMeta,
  skeletonMeta,
  dialogMeta,
  confirmDialogMeta,
  dropdownMenuMeta,
  popoverMeta,
  separatorMeta,
]

export const categories: Category[] = [
  "Inputs",
  "Feedback",
  "Data Display",
  "Overlays",
  "Layout",
]

export function getByCategory(category: Category): ComponentMeta[] {
  return registry.filter((c) => c.category === category)
}

export function getBySlug(slug: string): ComponentMeta | undefined {
  return registry.find((c) => c.slug === slug)
}
