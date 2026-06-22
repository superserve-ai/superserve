# Agent-Framework Integrations — Market Research Brief

**Date:** 2026-06-16
**Question:** Which integrations should Superserve add to make its sandbox more popular with AI builders? Starting points named by the team: _OpenAI Agents, OpenClaw, Hermes, Flue._
**Companion to:** [`2026-06-16-cloud-coding-agents-market-research.md`](./2026-06-16-cloud-coding-agents-market-research.md). That brief covers the **trigger-surface** play (spawn-a-cloud-agent + summon from GitHub/Linear/Slack). This brief covers the **framework-provider** play — being the sandbox _listed inside_ other people's agent frameworks — which that brief flagged (§2–3) as the bigger near-term infra prize.

> **Confidence note.** The core finding (every modern agent harness has a pluggable sandbox slot; the build is a per-framework provider adapter; being _listed_ is the adoption driver) is corroborated across multiple sources and aligns with Superserve's own SDK surface (`commands.run` + `files`). The OpenAI Agents SDK provider list was **adversarially verified (3 independent votes)**. The four named-tool identifications were verified by direct source fetch (DigitalOcean, Analytics Vidhya, Composio, Better Stack / withastro/flue). **Caveat:** the underlying deep-research run hit a billing cap mid-verification, so ~20 supporting claims are well-sourced (primary/secondary with quotes) but _not_ adversarially verified — treat as directional-but-solid. Several items (Flue, OpenClaw virality, the Apr-2026 Agents SDK sandbox update, the May-2026 Hermes guide) are **post-knowledge-cutoff (Jan 2026)** — re-verify star counts and dates before any external use.

---

## 1. The one-sentence finding

**Every framework you named has converged on the same architecture — an agent loop + a _pluggable sandbox backend_ — so the integration to build is a "Superserve sandbox provider" adapter that conforms to each framework's backend interface (usually just `execute(command) → output`, with the filesystem layered on top). Build the core once (you already have it), ship a thin adapter per framework, and — the part that actually drives adoption — get listed in each framework's provider registry. Builders pick their sandbox from that list; if you're not on it, you're not in the consideration set.**

Your four examples are not random — they are four of the hottest agent harnesses, and **three of your direct competitors (E2B, Daytona, Modal) are already wired into them while Superserve is absent.** That gap _is_ the opportunity.

## 2. The four named tools, resolved

| You said          | It is                                                                                                                                                                                                                                                                                                    | Code exec?           | Sandbox slot                                         | How to reach it                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Agents** | **OpenAI Agents SDK** — OpenAI's production agent framework. Native, pluggable sandbox execution. Built-in providers: **Blaxel, Cloudflare, Daytona, E2B, Modal, Runloop, Vercel** + bring-your-own via `SandboxRunConfig` / a sandbox-client interface (e.g. `UnixLocalSandboxClient`).                 | Yes — first-party    | **Open, documented**                                 | Provider adapter implementing the sandbox-client interface; PR/listing into the provider set                              |
| **Flue**          | **`withastro/flue`** — "the sandbox agent framework" from the Astro team. A headless, programmable **TypeScript agent harness** whose _entire thesis_ is _harness + secure isolated sandbox_. Abstracts the execution environment behind a `sandbox` parameter (lightweight VMs **or** full containers). | Yes — core design    | **Open, by design**                                  | Backend implementing Flue's `sandbox` contract; deployable to Node or Cloudflare Workers                                  |
| **OpenClaw**      | Viral **open-source personal-agent runtime** ("self-hosted agent runtime + message router"). Runs shell, browser, local files; has a sandboxed mode; 100+ community **AgentSkills**. Reported ~60k GitHub stars in 72h — one of the fastest-growing OSS projects.                                        | Yes                  | Has sandboxed mode; backend-pluggability less formal | Ship an **AgentSkill** that targets Superserve; or be its remote sandbox backend                                          |
| **Hermes**        | **Nous Research's open-source agent runtime** — CLI + API server + messaging gateway. Has an `execute_code` tool, Docker-based sandboxing, an **MCP server**, and a Python SDK.                                                                                                                          | Yes — `execute_code` | Docker today; MCP-extensible                         | Already reachable via **Composio's E2B MCP toolkit (27 sandbox tools)** — match that pattern with a Superserve MCP server |

**Pattern:** all four = agent harness that writes-and-runs code and needs an isolated workspace. That is precisely Superserve's product slotted into their architecture.

## 3. Priority-ranked integration targets

Ranked by _adoption leverage ÷ build cost_.

### Tier 1 — build now

1. **OpenAI Agents SDK provider adapter.** _Highest leverage, table-stakes._ E2B, Daytona, and Modal (your named competitors) are already built-in providers; Superserve is conspicuously absent. In any eval or "which sandbox should I use" comparison done from inside the SDK, absence is a silent disqualifier. Concrete form: a provider adapter implementing the SDK's sandbox-client interface, passed via `SandboxRunConfig`. _(This is the one claim that was adversarially verified, 3-0.)_

2. **A Superserve MCP server.** _Highest reach-per-unit-effort._ One build reaches **every MCP-capable client** — Claude, Cursor, VS Code, Windsurf — **plus Hermes** (via the Composio pattern) and **OpenClaw** skills. It also rides the strongest current tailwind: the industry shift from direct tool-calling to _agents write-and-run code_ (Anthropic's "Code Execution with MCP," Cloudflare's "Code Mode"). Concrete form: `@superserve/mcp` exposing create / exec / read / write / pause / resume / kill as MCP tools. Comparable: SandboxAPI already ships an MCP server ("execute code in 8 languages, safely").

### Tier 2 — fast follow

3. **Flue backend** (`withastro/flue`). Near-perfect fit: Flue's whole design is the swappable sandbox slot, Astro-team pedigree pulls a serious TS/web-builder audience, and implementing its `sandbox` contract is cheap.

4. **LangChain DeepAgents backend.** Pluggable backend where the _only_ required method is `execute()` (a shell command → output); all filesystem ops are layered on top by a `BaseSandbox`. DeepAgents already ships E2B / Modal / Daytona / Runloop / Vercel backends **and documents a "Contributing a sandbox integration" path** — they explicitly _want_ third-party providers. Lowest-friction official listing available.

5. **Vercel AI SDK tool/adapter.** ~25k-star TS framework from the Next.js team. Its agent pattern backs a shell tool with a cloud sandbox (`getSandbox()` / `sandbox.runCommand()`) and exposes a `ToolLoopAgent` `tools` map — a clean slot for a Superserve-backed executor. Huge Next.js builder base.

### Tier 3 — ride the virality (cheap once MCP exists)

6. **OpenClaw AgentSkill** — ship a Superserve skill into its 100+-skill ecosystem to capture the 60k-star wave.
7. **Hermes via Composio** — once the MCP server exists, mirror the E2B/Composio toolkit so Hermes can pick Superserve.

## 4. What an integration concretely _is_ (four shapes — build all over time)

1. **Framework backend adapter** _(the workhorse)._ A small per-framework package implementing that framework's sandbox interface (`execute()` / `runCommand()` + filesystem), wrapping Superserve's existing `commands.run` and `files.*`. One core capability, many thin adapters. e.g. `superserve-openai-agents`, `@superserve/deepagents`, `@superserve/flue-sandbox`, `@superserve/ai-sdk`.
2. **MCP server** _(the distribution multiplier)._ `@superserve/mcp` — one build, every MCP client.
3. **Templates / quickstarts** _(the marketing surface)._ "Run the OpenAI Agents SDK on Superserve in 5 lines," etc. Doubles as docs and as proof-of-low-friction.
4. **Registry listings / PRs** _(the actual adoption driver)._ Land Superserve in each framework's provider list and docs (Agents SDK provider set, DeepAgents sandboxes doc, Composio toolkit catalog). **The listing — not the code — is what puts you in builders' consideration set.**

## 5. Why this drives adoption (the "why")

- **Structural tailwind.** Agents are moving from emitting tool-calls to _writing and running code_ (Anthropic "Code Execution with MCP"; Cloudflare "Code Mode"; the rationale being LLMs are better at writing code than native tool-calling). More code execution per agent run ⇒ more sandbox demand. Superserve sells exactly this primitive.
- **Distribution / consideration-set economics.** Builders choose a sandbox from the supported list _inside the framework they already use_. Being listed is the cheapest, highest-intent acquisition channel; being absent is invisible. Competitors are already on the lists.
- **Low marginal cost.** The interfaces converge on `execute()` + filesystem — which Superserve already exposes (`commands.run`, `files.read/write`). One core, many adapters means each new framework is days, not quarters. Superserve's differentiators (native pause/resume, sub-second boot, per-sandbox network isolation, harness-agnostic) become per-adapter selling points.

## 6. How this connects to the other brief

The two briefs are two halves of the same go-to-market:

- **This brief (framework-provider play):** get builders who _already_ use an agent framework to select Superserve as the sandbox underneath. Lowest-conflict, fastest, ride existing distribution.
- **Companion brief (trigger-surface play):** offer the _spawn-a-cloud-agent_ primitive + GitHub/Linear/Slack summon adapters that no infra vendor owns yet.

Sequencing: the framework adapters (this brief) are the lower-risk, faster-payback wedge and should likely lead; the summon primitive is the more differentiated, higher-ceiling follow-on.

## 7. One thing the research explicitly knocked down

The tidy "there are **exactly two** patterns — Agent-IN-sandbox vs. Sandbox-as-tool" framing was **refuted (0-3)** as an oversimplification. It's still a useful mental model for the two adapter shapes (agent runs _inside_ a Superserve VM, vs. agent runs elsewhere and calls Superserve as a remote tool) — just don't treat it as an exhaustive taxonomy.

---

## Sources (selected; post-cutoff claims flagged in the confidence note)

- **OpenAI Agents SDK sandbox providers (verified 3-0):** openai.com/index/the-next-evolution-of-the-agents-sdk · helpnetsecurity.com/2026/04/16/openai-agents-sdk-harness-and-sandbox-update · techcrunch.com/2026/04/15 · e2b.dev/blog/e2b-is-now-in-agents-sdk
- **LangChain DeepAgents backends + "contributing a sandbox" path:** langchain.com/blog/the-two-patterns-by-which-agents-connect-sandboxes · docs.langchain.com/oss/python/deepagents/sandboxes
- **Flue (withastro/flue):** github.com/withastro/flue · flueframework.com · betterstack.com/community/guides/ai/flue-framework
- **OpenClaw:** digitalocean.com/resources/articles/what-is-openclaw
- **Hermes (Nous Research) + Composio E2B MCP toolkit:** analyticsvidhya.com/blog/2026/05/hermes-agent-guide · composio.dev/toolkits/e2b/framework/hermes-agent
- **MCP / Code-Mode tailwind:** blog.cloudflare.com/code-mode · infoq.com/news/2026/04/cloudflare-code-mode-mcp-server · simonwillison.net/2025/Nov/4/code-execution-with-mcp · marktechpost.com/2025/11/08 (Anthropic Code Execution with MCP) · glama.ai/mcp/servers/sandboxapi
- **Vercel AI SDK:** github.com/vercel/ai · daytona.io/docs/en/guides/vercel-ai-sdk
- **Competitive landscape:** modal.com/resources/best-code-execution-sandboxes-coding-agents · startuphub.ai (Daytona vs E2B vs Modal vs Vercel Sandbox 2026) · softwareseni.com (E2B/Daytona/Modal/Sprites) · dev.to/thedailyagent/top-5-code-sandboxes-for-ai-agents-in-2026
