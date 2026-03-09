/**
 * Minimal chatbot built with LangChain deployed on Superserve.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
import { createInterface } from "readline"

const llm = new ChatOpenAI({ model: "gpt-4o" })
const system = new SystemMessage("You are a helpful assistant.")

const rl = createInterface({ input: process.stdin })
rl.on("line", async (line) => {
  const response = await llm.invoke([system, new HumanMessage(line)])
  console.log(response.content)
})
