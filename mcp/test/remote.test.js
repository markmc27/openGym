import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createHttpHandler } from '../src/http.js'
import { createPrescription, readPrescriptions } from '../src/prescriptions.js'
import { applyPrescription, sessionComparison } from '../../frontend/src/lib/session-prescription.js'
import { buildCompletedWorkout } from '../../frontend/src/lib/finish-workout.js'

let data, server, base, S
const origin = 'https://gym.example.org'
const resource = origin + '/mcp'
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect'
const user = { id: 'user-a', name: 'Athlete' }
const date = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const input = () => ({ session_id: 'sunday-1', date: date(), routine_id: 'lower', unit: 'kg', notes: 'Controlled eccentric', exercises: [{ position: 1, exercise_id: '0043', sets: [{ reps: 7, load: 50, rir: 2 }, { reps: 7, load: 50 }] }] })
beforeEach(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-test-'))
  S = { unit: 'kg', workouts: [], routines: [{ id: 'lower', name: 'Lower', ex: [{ id: '0043', sets: 4, reps: 8, weight: 20 }] }], week: {}, dayPlan: {}, bodyweight: [], exWeights: {} }
  const app = createHttpHandler({ origin, data, redirectUris: [redirect], readSession: req => req.headers.cookie === 'test=a' ? user : null,
    userById: id => id === user.id ? user : null, readState: id => { const p = readPrescriptions(data,id); return { ...S, sessionPrescriptions:p.sessions } } })
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(data,{ recursive:true, force:true }) })
const request = (p, opts = {}) => new Promise((resolve, reject) => {
  const req = http.request(base+p, { method:opts.method || 'GET', headers:{ Host:'gym.example.org', ...opts.headers } }, res => {
    let text=''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk });
    res.on('end', () => resolve({ status:res.statusCode, headers:{ get:name=>res.headers[name.toLowerCase()] }, text:async()=>text, json:async()=>JSON.parse(text) }))
  })
  req.on('error',reject); req.end(opts.body?.toString())
})
async function grant(scope = 'training:read sessions:write') {
  const r = await request('/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ client_name:'Test client', redirect_uris:[redirect], token_endpoint_auth_method:'none' }) })
  expect(r.status).toBe(201)
  const client = await r.json()
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const auth = new URLSearchParams({ client_id:client.client_id, response_type:'code', redirect_uri:redirect, code_challenge:challenge, code_challenge_method:'S256', resource, scope, state:'state-1' })
  const a = await request('/authorize?'+auth)
  expect(a.status).toBe(302)
  const consent = new URL(a.headers.get('location'))
  const page = await request(consent.pathname+consent.search, { headers:{ Cookie:'test=a' } })
  expect(page.status).toBe(200)
  const html = await page.text()
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1]
  const ticket = consent.searchParams.get('ticket')
  const accepted = await request('/mcp/consent', { method:'POST', headers:{ Cookie:'test=a', Origin:origin, 'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ticket,csrf,decision:'allow'}) })
  expect(accepted.status).toBe(302)
  const callback = new URL(accepted.headers.get('location'))
  expect(callback.searchParams.get('state')).toBe('state-1')
  expect(callback.searchParams.get('iss')).toBe(origin+'/')
  const body = new URLSearchParams({grant_type:'authorization_code', client_id:client.client_id, code:callback.searchParams.get('code'), code_verifier:verifier, redirect_uri:redirect, resource })
  const token = await request('/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body})
  expect(token.status).toBe(200)
  return { tokens:await token.json(), client, body }
}
async function mcp(token, method, params) {
  const r = await request('/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  expect(r.status).toBe(200)
  return r.json()
}
describe('remote MCP authorization',()=>{
  it('rejects anonymous, hostile origins, and forged hosts',async()=>{
    expect((await request('/mcp',{method:'POST'})).status).toBe(401)
    expect((await request('/mcp',{method:'POST',headers:{Origin:'https://evil.example'}})).status).toBe(403)
    expect((await request('/mcp',{method:'POST',headers:{Host:'evil.example'}})).status).toBe(403)
    const metadata = await (await request('/.well-known/oauth-protected-resource/mcp')).json()
    expect(metadata.resource).toBe(resource)
  })
  it('completes PKCE and consent, exposes annotated tools, writes only a prescription',async()=>{
    const {tokens,body}=await grant()
    const init=await mcp(tokens.access_token,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})
    expect(init.result.serverInfo.name).toBe('opengym')
    const list=await mcp(tokens.access_token,'tools/list',{})
    expect(list.result.tools.find(t=>t.name==='get_workout').annotations.readOnlyHint).toBe(true)
    expect(list.result.tools.find(t=>t.name==='set_next_session').annotations.readOnlyHint).toBe(false)
    const original=JSON.stringify(S)
    const written=await mcp(tokens.access_token,'tools/call',{name:'set_next_session',arguments:input()})
    expect(written.result.isError).not.toBe(true)
    expect(written.result.structuredContent.id).toBe('sunday-1')
    expect(JSON.stringify(S)).toBe(original)
    const preview=await mcp(tokens.access_token,'tools/call',{name:'preview_session',arguments:{routine_id:'lower',date:date()}})
    expect(preview.result.structuredContent.session_id).toBe('sunday-1')
    expect(preview.result.structuredContent.exercises[0].opening_sets[0]).toMatchObject({w:50,r:7,target_rir:2})
    const retry=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body})
    expect(retry.status).toBe(400)
  })
  it('enforces read-only scope and audience; rotates refresh tokens and revokes family',async()=>{
    const {tokens,client}=await grant('training:read')
    const denied=await mcp(tokens.access_token,'tools/call',{name:'set_next_session',arguments:input()})
    expect(denied.result.isError).toBe(true)
    const refresh = new URLSearchParams({ grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource })
    const wrong = new URLSearchParams(refresh); wrong.set('resource','https://other.example/mcp')
    expect((await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:wrong})).status).toBe(400)
    const r=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:refresh})
    expect(r.status).toBe(200)
    const next=await r.json()
    expect((await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:refresh})).status).toBe(400)
    const revoke=await request('/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,token:next.refresh_token})})
    expect(revoke.status).toBe(200)
    expect((await request('/mcp',{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`}})).status).toBe(401)
  })
  it('requires login and operator-approved redirect URIs',async()=>{
    const r=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://evil.example/callback'],token_endpoint_auth_method:'none'})})
    expect(r.status).toBe(400)
  })
})
describe('prescription lifecycle',()=>{
  it('is immutable and idempotent and preserves actuals separately',()=>{
    const original=structuredClone(S.routines)
    const p=createPrescription(data,user.id,S,input())
    expect(createPrescription(data,user.id,S,input())).toEqual(p)
    expect(()=>createPrescription(data,user.id,S,{...input(),notes:'different'})).toThrow(/different/)
    const entries=applyPrescription([{id:'0043',rid:'lower',planned:{sets:4,reps:8},target:{sets:4,reps:8},sets:[]}],p,'kg')
    expect(entries[0].sets[0]).toMatchObject({w:50,r:7,targetRir:2,done:false})
    entries[0].sets[0]={...entries[0].sets[0],done:true,w:45,r:6,rir:3}
    const w=buildCompletedWorkout({id:p.id,session_id:p.id,prescription:p,d:p.date,start:1,routineIds:['lower'],entries,note:'Foot discomfort'})
    const c=sessionComparison(p,w)
    expect(c.completed.entries[0].sets[0]).toMatchObject({w:45,r:6,rir:3})
    expect(c.prescribed.exercises[0].sets[0]).toMatchObject({load:50,reps:7,rir:2})
    expect(c.completed.note).toBe('Foot discomfort')
    expect(S.routines).toEqual(original)
  })
  it('rejects invalid calendar, arbitrary fields, wrong exercise and concurrent date',()=>{
    expect(()=>createPrescription(data,user.id,S,{...input(),date:'2026-02-30'})).toThrow()
    expect(()=>createPrescription(data,user.id,S,{...input(),workouts:[]})).toThrow()
    expect(()=>createPrescription(data,user.id,S,{...input(),exercises:[{...input().exercises[0],exercise_id:'wrong'}]})).toThrow()
    createPrescription(data,user.id,S,input())
    expect(()=>createPrescription(data,user.id,S,{...input(),session_id:'other'})).toThrow(/unfinished/)
    expect(readPrescriptions(data,'user-b').sessions).toEqual([])
  })
})
