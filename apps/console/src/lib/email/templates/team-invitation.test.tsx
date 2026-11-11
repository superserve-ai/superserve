import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TeamInvitationEmail } from "./team-invitation"

const props = {
  teamName: "Example team",
  inviterName: "A teammate",
  regionLabel: "US East",
  expiresOn: "Nov 14, 2026",
  inviteUrl: "https://console.example.com/invite/example",
}
describe("TeamInvitationEmail", () => {
  it.each([
    ["viewer", "Viewer"],
    ["team_admin", "Team admin"],
    ["team_owner", "Owner"],
  ])("describes %s access", (role, label) => {
    const html = renderToStaticMarkup(
      <TeamInvitationEmail {...props} role={role} />,
    )
    expect(html).toContain(`join Example team as ${label}`)
    if (role !== "team_owner") expect(html).not.toContain("as an Owner")
  })
  it("keeps legacy wording without a known role", () => {
    expect(renderToStaticMarkup(<TeamInvitationEmail {...props} />)).toContain(
      "as an Owner",
    )
  })
})
