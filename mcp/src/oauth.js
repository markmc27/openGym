import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWrite } from '../../api/durable.js'
import { InvalidClientError, InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js'

const random = () => crypto.randomBytes(32).toString('base64url')
const hash = t => crypto.createHash('sha256').update(t).digest('hex')
const seconds = () => Math.floor(Date.now() / 1000)
const SCOPES = ['training:read', 'sessions:write']
export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

// Only opaque token hashes persist. Grants are per profile and checked against live accounts.
export function createOAuthProvider({ data, issuer, resource, readSession, userById, redirectUris }) {
  const file = path.join(data, 'mcp-oauth.json')
  let db
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('MCP OAuth storage unreadable'); db = { clients: {}, tokens: {} } }
  const pending = new Map(), codes = new Map()
  const sweep = () => {
    for (const [k,v] of pending) if (v.expires <= seconds()) pending.delete(k)
    for (const [k,v] of codes) if (v.expires <= seconds()) codes.delete(k)
    for (const [k,v] of Object.entries(db.tokens)) if (v.expires <= seconds()) delete db.tokens[k]
  }
  const save = () => { sweep(); atomicWrite(file, JSON.stringify(db), 0o600) }
  const target = r => { if (!r || r.href !== resource.href) throw new InvalidTargetError('resource must exactly match this MCP endpoint') }
  const scopesOf = scopes => {
    const result = scopes?.length ? [...new Set(scopes)] : SCOPES
    if (result.some(s => !SCOPES.includes(s))) throw new InvalidScopeError('unsupported scope')
    return result
  }
  const record = (collection, key, client) => {
    const v = collection instanceof Map ? collection.get(hash(key)) : collection[hash(key)]
    if (!v || v.clientId !== client.client_id || v.expires <= seconds() || !userById(v.uid)) throw new InvalidGrantError('invalid or expired grant')
    return v
  }
  const mint = grant => {
    const access = random(), refresh = random(), family = grant.family || random()
    db.tokens[hash(access)] = { ...grant, family, kind: 'access', expires: seconds() + 3600 }
    db.tokens[hash(refresh)] = { ...grant, family, kind: 'refresh', expires: seconds() + 30 * 86400 }
    save()
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: grant.scopes.join(' ') }
  }
  const provider = {
    clientsStore: {
      getClient: id => db.clients[id],
      registerClient: client => {
        sweep()
        if (Object.keys(db.clients).length >= 100) throw new InvalidClientError('client limit reached')
        if (!client.redirect_uris?.length || client.redirect_uris.some(u => !redirectUris.includes(u))) throw new InvalidClientError('redirect URI is not on the operator allowlist')
        if (client.token_endpoint_auth_method !== 'none') throw new InvalidClientError('only public PKCE clients supported')
        const registered = { ...client, client_id: random(), client_id_issued_at: seconds(), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }
        delete registered.client_secret; delete registered.client_secret_expires_at
        db.clients[registered.client_id] = registered; save(); return registered
      },
    },
    async authorize(client, params, res) {
      sweep(); target(params.resource)
      const scopes = scopesOf(params.scopes)
      if (pending.size >= 100) throw new InvalidGrantError('too many pending requests')
      const ticket = random()
      pending.set(hash(ticket), { clientId: client.client_id, params, scopes, expires: seconds() + 600 })
      res.redirect(`/mcp/consent?ticket=${encodeURIComponent(ticket)}`)
    },
    consentPage(req, res) {
      sweep()
      const ticket = req.query.ticket
      const p = typeof ticket === 'string' && pending.get(hash(ticket))
      if (!p) return res.status(400).send('Authorization expired. Reconnect from ChatGPT.')
      const user = readSession(req)
      res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' })
      if (!user) return res.status(401).type('html').send(`<!doctype html><title>Connect openGym</title><h1>Sign into openGym first</h1><p><a href="/" target="_blank" rel="noopener">Open openGym</a>, sign in, then reload this page.</p>`)
      p.uid = user.id
      p.csrf = random()
      const client = db.clients[p.clientId]
      res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Connect openGym</title><h1>Connect openGym</h1><p>Profile: ${escapeHtml(user.name)}</p><p>Client: ${escapeHtml(client.client_name || 'MCP client')}</p><p>Callback: ${escapeHtml(p.params.redirectUri)}</p><p>Permissions: ${escapeHtml(p.scopes.join(', '))}. Read training history${p.scopes.includes('sessions:write') ? ' and prescribe individual upcoming sessions' : ''}.</p><p>Master routines cannot be changed through this connection.</p><form method="post" action="/mcp/consent"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}"><input type="hidden" name="csrf" value="${p.csrf}"><button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button></form>`)
    },
    consent(req, res) {
      const p = typeof req.body.ticket === 'string' && pending.get(hash(req.body.ticket))
      const user = readSession(req)
      if (!p || p.expires <= seconds() || !user || user.id !== p.uid || p.csrf !== req.body.csrf || req.headers.origin !== issuer.origin) return res.status(403).send('Authorization refused')
      pending.delete(hash(req.body.ticket))
      const callback = new URL(p.params.redirectUri)
      if (p.params.state) callback.searchParams.set('state', p.params.state)
      if (req.body.decision !== 'allow') callback.searchParams.set('error', 'access_denied')
      else {
        const code = random()
        codes.set(hash(code), { uid: user.id, clientId: p.clientId, scopes: p.scopes, challenge: p.params.codeChallenge, redirectUri: p.params.redirectUri, resource: p.params.resource.href, expires: seconds() + 120 })
        callback.searchParams.set('code', code)
      }
      res.redirect(callback.href)
    },
    async challengeForAuthorizationCode(client, code) { return record(codes, code, client).challenge },
    async exchangeAuthorizationCode(client, code, verifier, redirectUri, requestedResource) {
      target(requestedResource)
      const grant = record(codes, code, client)
      if (redirectUri !== grant.redirectUri) throw new InvalidGrantError('redirect mismatch')
      codes.delete(hash(code))
      return mint({ uid: grant.uid, clientId: grant.clientId, scopes: grant.scopes, resource: grant.resource })
    },
    async exchangeRefreshToken(client, token, scopes, requestedResource) {
      target(requestedResource)
      const grant = record(db.tokens, token, client)
      if (grant.kind !== 'refresh') throw new InvalidGrantError('not a refresh token')
      const narrowed = scopes?.length ? scopesOf(scopes) : grant.scopes
      if (narrowed.some(s => !grant.scopes.includes(s))) throw new InvalidScopeError('cannot expand scope during refresh')
      delete db.tokens[hash(token)]
      return mint({ uid: grant.uid, clientId: grant.clientId, scopes: narrowed, resource: grant.resource, family: grant.family })
    },
    async verifyAccessToken(token) {
      const grant = db.tokens[hash(token)]
      if (!grant || grant.kind !== 'access' || grant.expires <= seconds() || grant.resource !== resource.href || !userById(grant.uid)) throw new InvalidTokenError('invalid or expired access token')
      return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: grant.expires, resource, extra: { uid: grant.uid } }
    },
    async revokeToken(client, { token }) {
      const grant = db.tokens[hash(token)]
      if (grant?.clientId === client.client_id) {
        for (const [key, value] of Object.entries(db.tokens)) if (value.family === grant.family) delete db.tokens[key]
        save()
      }
    },
  }
  return provider
}
