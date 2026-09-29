export const syntheticAuth = {
  userId: "ui-fixture-user",
  email: "fixture@example.test",
}

export const syntheticRegionalState = {
  use: { owner: "ui-fixture-user", teams: [] as string[] },
  usw: { owner: "ui-fixture-user", teams: [] as string[] },
}

export function resetSyntheticState() {
  syntheticRegionalState.use.teams = []
  syntheticRegionalState.usw.teams = []
}
