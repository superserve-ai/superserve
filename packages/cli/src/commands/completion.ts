import { Argument, type Command } from "commander"

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const
type Shell = (typeof SHELLS)[number]

interface Word {
  name: string
  description: string
}

/** One command in the tree, keyed by its space-joined canonical path. */
interface Node {
  path: string
  commands: Word[]
  options: Word[]
}

/** `parentPath:word` → child path, so aliases resolve to the canonical name. */
type Children = [string, string][]

function firstLine(s: string): string {
  return s.split("\n")[0].trim()
}

/** Walk the live program so the script always matches the registered commands. */
function collect(root: Command): { nodes: Node[]; children: Children } {
  const nodes: Node[] = []
  const children: Children = []
  const help = root.createHelp()
  // Root options like --json are accepted after any subcommand too.
  const global = help
    .visibleOptions(root)
    .filter((o) => o.long && o.long !== "--help" && o.long !== "--version")

  const walk = (cmd: Command, path: string) => {
    const commands: Word[] = []
    for (const sub of help.visibleCommands(cmd)) {
      const childPath = path ? `${path} ${sub.name()}` : sub.name()
      const description = firstLine(help.subcommandDescription(sub))
      for (const name of [sub.name(), ...sub.aliases()]) {
        commands.push({ name, description })
        children.push([`${path}:${name}`, childPath])
      }
      walk(sub, childPath)
    }
    for (const arg of cmd.registeredArguments) {
      for (const name of arg.argChoices ?? []) {
        commands.push({ name, description: firstLine(arg.description) })
      }
    }
    const options = [
      ...help.visibleOptions(cmd),
      ...(cmd === root ? [] : global),
    ]
      .filter((o) => o.long)
      .map((o) => ({
        name: o.long as string,
        description: firstLine(help.optionDescription(o)),
      }))
    nodes.push({ path, commands, options })
  }
  walk(root, "")
  return { nodes, children }
}

const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
const fq = (s: string) =>
  `'${s.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
const pq = (s: string) => `'${s.replaceAll("'", "''")}'`

function caseArms(children: Children): string {
  return children
    .map(([key, path]) => `      ${sq(key)}) next=${sq(path)} ;;`)
    .join("\n")
}

function bash(nodes: Node[], children: Children): string {
  const arms = nodes
    .map((n) => {
      const cmds = n.commands.map((w) => w.name).join(" ")
      const opts = n.options.map((w) => w.name).join(" ")
      return `    ${sq(n.path)}) cmds=${sq(cmds)}; opts=${sq(opts)} ;;`
    })
    .join("\n")
  return `# superserve bash completion
_superserve() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" cmdpath="" next="" cmds="" opts="" i
  for ((i = 1; i < COMP_CWORD; i++)); do
    next=""
    case "$cmdpath:\${COMP_WORDS[i]}" in
${caseArms(children)}
    esac
    [[ -n $next ]] && cmdpath=$next
  done
  case "$cmdpath" in
${arms}
  esac
  if [[ $cur == -* ]]; then
    COMPREPLY=($(compgen -W "$opts" -- "$cur"))
  else
    COMPREPLY=($(compgen -W "$cmds" -- "$cur"))
  fi
}
complete -o default -F _superserve superserve
`
}

function zsh(nodes: Node[], children: Children): string {
  const list = (words: Word[]) =>
    words
      .map((w) => sq(`${w.name.replaceAll(":", "\\:")}:${w.description}`))
      .join(" ")
  const arms = nodes
    .map(
      (n) =>
        `    ${sq(n.path)}) cmds=(${list(n.commands)}); opts=(${list(n.options)}) ;;`,
    )
    .join("\n")
  return `#compdef superserve
# superserve zsh completion
_superserve() {
  local cmdpath="" next="" i
  local -a cmds opts
  for ((i = 2; i < CURRENT; i++)); do
    next=""
    case "$cmdpath:\${words[i]}" in
${caseArms(children)}
    esac
    [[ -n $next ]] && cmdpath=$next
  done
  case "$cmdpath" in
${arms}
  esac
  if [[ $PREFIX == -* ]]; then
    _describe -t options option opts
  elif (( \${#cmds} )); then
    _describe -t commands command cmds
  else
    _files
  fi
}
if [[ "\${funcstack[1]}" == _superserve ]]; then
  _superserve "$@"
else
  compdef _superserve superserve
fi
`
}

function fish(nodes: Node[], children: Children): string {
  const arms = children
    .map(
      ([key, path]) =>
        `            case ${fq(key)}\n                set cmdpath ${fq(path)}`,
    )
    .join("\n")
  const lines: string[] = []
  for (const n of nodes) {
    const cond = `-n ${fq(`__superserve_at ${fq(n.path)}`)}`
    for (const w of n.commands) {
      lines.push(
        `complete -c superserve ${cond} -f -a ${fq(w.name)} -d ${fq(w.description)}`,
      )
    }
    for (const w of n.options) {
      lines.push(
        `complete -c superserve ${cond} -l ${fq(w.name.slice(2))} -d ${fq(w.description)}`,
      )
    }
  }
  return `# superserve fish completion
function __superserve_at
    set -l tokens (commandline -opc)
    set -e tokens[1]
    set -l cmdpath ''
    for t in $tokens
        switch "$cmdpath:$t"
${arms}
        end
    end
    test "$cmdpath" = "$argv[1]"
end
${lines.join("\n")}
`
}

function powershell(nodes: Node[], children: Children): string {
  const map = children.map(([k, v]) => `    ${pq(k)} = ${pq(v)}`).join("\n")
  const entry = (w: Word) =>
    `@{ n = ${pq(w.name)}; d = ${pq(w.description || w.name)} }`
  const words = nodes
    .map(
      (n) =>
        `    ${pq(n.path)} = @(${[...n.commands, ...n.options].map(entry).join(", ")})`,
    )
    .join("\n")
  return `# superserve PowerShell completion
Register-ArgumentCompleter -Native -CommandName superserve -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $children = @{
${map}
  }
  $words = @{
${words}
  }
  $cmdpath = ''
  foreach ($e in $commandAst.CommandElements | Select-Object -Skip 1) {
    if ($e.Extent.EndOffset -ge $cursorPosition) { break }
    $next = $children["$($cmdpath):$($e.ToString())"]
    if ($next) { $cmdpath = $next }
  }
  $words[$cmdpath] | Where-Object { $_.n -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_.n, $_.n, 'ParameterValue', $_.d)
  }
}
`
}

const GENERATORS: Record<Shell, (nodes: Node[], children: Children) => string> =
  { bash, zsh, fish, powershell }

export function register(program: Command): void {
  program
    .command("completion")
    .description("Print a shell completion script")
    .addArgument(new Argument("<shell>", "Target shell").choices(SHELLS))
    .addHelpText(
      "after",
      `
Install:
  bash        echo 'eval "$(superserve completion bash)"' >> ~/.bashrc
  zsh         echo 'eval "$(superserve completion zsh)"' >> ~/.zshrc
              (after compinit; or save the output as _superserve on your $fpath)
  fish        superserve completion fish > ~/.config/fish/completions/superserve.fish
  powershell  Add-Content $PROFILE 'superserve completion powershell | Out-String | Invoke-Expression'

Then open a new shell.`,
    )
    .action((shell: Shell, _opts: unknown, cmd: Command) => {
      let root = cmd
      while (root.parent) root = root.parent
      const { nodes, children } = collect(root)
      process.stdout.write(GENERATORS[shell](nodes, children))
    })
}
