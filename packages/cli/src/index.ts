#!/usr/bin/env node
import { installPipeGuard, run } from "./cli"

installPipeGuard()
process.exitCode = await run(process.argv.slice(2))
