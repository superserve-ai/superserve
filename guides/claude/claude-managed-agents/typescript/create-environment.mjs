import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

const environment = await client.beta.environments.create({
  name: "superserve",
  config: { type: "self_hosted" },
})

console.log(`created environment ${environment.id}`)
console.log()
console.log("next steps:")
console.log(`  1. open https://platform.claude.com/workspaces/default/environments/${environment.id}`)
console.log("  2. click 'Generate environment key'")
console.log("  3. add both values to .env:")
console.log(`     ANTHROPIC_ENVIRONMENT_ID=${environment.id}`)
console.log("     ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...")
