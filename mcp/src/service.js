import { TOOLS, SESSION_TOOLS } from './tools.js'
import { z } from 'zod'

// All transports use this validated service boundary. Tools have no transport/auth knowledge.
export const tools = [...TOOLS, ...SESSION_TOOLS]
export async function invoke(tool, params) {
  const input = z.object(tool.schema).strict().parse(params || {})
  return await tool.handler(input)
}
