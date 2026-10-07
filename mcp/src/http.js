import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { createServer } from './server.js'
import { withProfile } from './state.js'
import { createOAuthProvider } from './oauth.js'

export function createHttpHandler({ origin, data, readSession, userById, readState, redirectUris, trustProxy = false }) {
  const issuer = new URL(origin)
  if (issuer.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(issuer.hostname)) throw new Error('Remote MCP requires HTTPS')
  const resource = new URL('/mcp', issuer)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy ? 1 : false)
  app.use((req, res, next) => {
    if (req.headers.origin && req.headers.origin !== issuer.origin) return res.status(403).send('Invalid origin')
    // The bundled nginx overwrites Host. Reject other hosts, including DNS rebinding.
    const hostname = (req.headers.host || '').split(':')[0]
    if (hostname !== issuer.hostname) return res.status(403).send('Invalid host')
    res.set('Cache-Control', 'no-store')
    next()
  })
  const provider = createOAuthProvider({ data, issuer, resource, readSession, userById, redirectUris })
  app.get('/.well-known/oauth-authorization-server', (req, res) => res.json({
    ...createOAuthMetadata({ provider, issuerUrl: issuer, scopesSupported: ['training:read', 'sessions:write'] }),
    authorization_response_iss_parameter_supported: true, token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
  }))
  app.use((req, res, next) => {
    const redirect = res.redirect.bind(res)
    res.redirect = url => {
      const target = new URL(url, issuer)
      if (target.origin !== issuer.origin) target.searchParams.set('iss', issuer.href)
      return redirect(target.href)
    }
    next()
  })
  app.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: resource,
    scopesSupported: ['training:read', 'sessions:write'], resourceName: 'openGym' }))
  app.get('/mcp/consent', (req, res) => provider.consentPage(req, res))
  app.post('/mcp/consent', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => provider.consent(req, res))
  app.use('/mcp', requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) }))
  app.post('/mcp', express.json({ limit: '128kb' }), async (req, res) => {
    const user = userById(req.auth.extra.uid)
    if (!user) return res.status(401).send('Profile unavailable')
    const server = createServer({ remote: true, scopes: req.auth.scopes })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await withProfile({ data, user: { id: user.id, name: user.name, created: user.created }, readState: () => readState(user.id) }, () => transport.handleRequest(req, res, req.body))
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' })
    }
  })
  app.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').send('Use POST'))
  return app
}
