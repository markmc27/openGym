import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { tools, invoke } from './service.js'

export function createServer({ remote = false, scopes = [] } = {}) {
  const server = new McpServer({ name: 'opengym', version: '0.2.0' })
  for (const tool of tools) {
    const scope = tool.write ? 'sessions:write' : 'training:read'
    server.registerTool(tool.name, {
      description: tool.description, inputSchema: z.object(tool.schema).strict(),
      annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      ...(remote ? { securitySchemes: [{ type: 'oauth2', scopes: [scope] }], _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] } } : {}),
    }, async params => {
      if (remote && !scopes.includes(scope)) return { isError: true, content: [{ type: 'text', text: 'Insufficient OAuth scope' }],
        _meta: { 'mcp/www_authenticate': [`Bearer error="insufficient_scope", scope="${scope}"`] } }
      console.error(`[mcp] ${tool.name} called`)
      try {
        const result = await invoke(tool, params)
        if (tool.write) console.error(`[mcp] ${tool.name} succeeded`)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result }
      } catch (e) {
        console.error(`[mcp] ${tool.name} failed: ${e.code || e.name || 'ERROR'}`)
        return { isError: true, content: [{ type: 'text', text: `${e.code || 'ERROR'}: ${e.message}` }] }
      }
    })
  }
  return server
}
