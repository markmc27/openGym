#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'
import { init, getUser } from './state.js'
try {
  init()
  const u = getUser()
  console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`)
} catch (e) { console.error(`[opengym-mcp] ${e.message}`) }
await createServer().connect(new StdioServerTransport())
