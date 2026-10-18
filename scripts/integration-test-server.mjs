// Starts only the synthetic, RAM-backed test API. No production accounts or data are read.
import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {hashPassword} from '../api/password.js'
import {applyPrescription} from '../frontend/src/lib/session-prescription.js'
import {buildCompletedWorkout} from '../frontend/src/lib/finish-workout.js'
if(process.env.OPENGYM_INTEGRATION_TEST!=='1' || process.env.DATA_DIR!=='/test-data') throw Error('Test-only startup refused')
const data='/test-data'
if(fs.existsSync(data+'/db.json')) throw Error('Test startup requires an empty RAM filesystem')
const password=crypto.randomBytes(32).toString('base64url')
const uid='upstream-integration-a'
const created=new Date().toISOString()
fs.writeFileSync(data+'/db.json',JSON.stringify({users:[{id:uid,name:'Synthetic Integration',created,pw:{h:await hashPassword(password),set:created}}],creds:[],subs:[],invites:[]}),{mode:0o600})
const original={unit:'kg',routines:[{id:'master',name:'Untouched synthetic master',ex:[{id:'0289',sets:3,reps:10,weight:20}]}],workouts:[],week:{},customEx:[],dbLoad:{'0289':{mode:'each',_ts:1}},dumbbells:{kg:{weights:[10,12,14],_ts:1}}}
fs.writeFileSync(`${data}/state-${uid}.json`,JSON.stringify(original),{mode:0o600})
await import('../api/server.js')
const origin='http://localhost:8091', resource=origin+'/mcp', checks=[]
async function request(route, options={}) {
  return fetch('http://web:8080'+route,{...options,redirect:'manual',headers:{Host:'localhost:8091',Origin:origin,...options.headers}})
}
async function json(route,body,cookie){
  const r=await request(route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)})
  assert.equal(r.status,200,`${route}: ${r.status}`)
  return r
}
async function smoke(){
  for(let i=0;i<90;i++){
    try{if((await request('/api/health')).status===200)break}catch{}
    if(i===89)throw Error('Test web proxy did not become ready')
    await new Promise(r=>setTimeout(r,1000))
  }
  assert.equal((await request('/')).status,200);checks.push('web and API health through nginx')
  assert.equal((await request('/exercise-media/still/0289.webp')).status,200);checks.push('bundled exercise media')
  assert.equal((await request('/mcp',{method:'POST'})).status,401)
  for(const route of ['/api/register/password','/api/register/options'])assert.equal((await request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Denied signup'})})).status,403)
  checks.push('anonymous MCP and both uninvited signup methods refused')
  const login=await json('/api/login/password',{name:'Synthetic Integration',password})
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const reg=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Isolated smoke test',redirect_uris:[origin+'/test-callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})})
  assert.equal(reg.status,201);const client=await reg.json()
  const verifier=crypto.randomBytes(32).toString('base64url')
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url')
  const auth=await request('/authorize?'+new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:origin+'/test-callback',code_challenge:challenge,code_challenge_method:'S256',resource,scope:'training:read sessions:write',state:'synthetic-test'}))
  assert.equal(auth.status,302);const consent=new URL(auth.headers.get('location'),origin)
  const page=await request(consent.pathname+consent.search,{headers:{Cookie:cookie}})
  assert.equal(page.status,200);const html=await page.text();const csrf=/name="csrf" value="([^"]+)"/.exec(html)?.[1];assert.ok(csrf)
  const accepted=await request('/mcp/consent',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:consent.searchParams.get('ticket'),csrf,decision:'allow'})})
  assert.equal(accepted.status,302);const callback=new URL(accepted.headers.get('location'))
  const token=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:origin+'/test-callback',resource})})
  assert.equal(token.status,200);const tokens=await token.json();checks.push('password login and OAuth PKCE/consent through nginx')
  async function mcp(method,params){
    const r=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
    assert.equal(r.status,200);const value=await r.json();assert.ok(!value.error);return value.result
  }
  async function call(name,args={}){const r=await mcp('tools/call',{name,arguments:args});assert.ok(!r.isError,`${name} returned an error`);return r.structuredContent}
  await mcp('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'merge-smoke',version:'1'}})
  const list=await mcp('tools/list',{});assert.equal(list.tools.length,20)
  assert.equal(list.tools.find(t=>t.name==='get_training_context').annotations.readOnlyHint,true)
  assert.equal(list.tools.find(t=>t.name==='create_session_prescription').annotations.readOnlyHint,false)
  assert.equal((await call('get_profile')).name,'Synthetic Integration')
  const context=await call('get_training_context',{exercise_ids:['0289']})
  assert.equal(context.exercises[0].load_convention,'per_dumbbell');checks.push('20 annotated tools and unified dumbbell context')
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const p=await call('create_session_prescription',{session_id:'isolated-strength',title:'Synthetic strength',date,unit:'kg',exercises:[{position:1,exercise_id:'0289',mode:'reps',sets:[{load:12,reps:8,rir:2},{load:12,reps:8,rir:2}]}]})
  await json('/api/session-prescriptions/start',{session_id:p.id,revision:p.revision},cookie)
  const state=await (await request('/api/data',{headers:{Cookie:cookie}})).json()
  const entries=applyPrescription([{id:'0289',target:{dbLoad:'total'},sets:[]}],p,'kg')
  entries[0].sets[0]={...entries[0].sets[0],w:10,r:7,rir:3,done:true}
  const w=buildCompletedWorkout({id:'synthetic-completed',d:date,start:Date.now()-60000,session_id:p.id,prescription:p,entries})
  const saved=await request('/api/data',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({state:{...state.state,workouts:[w]},baseRev:state.rev})})
  assert.equal(saved.status,200)
  const reviewed=await call('get_session',{session_id:p.id})
  assert.equal(reviewed.status,'completed')
  const summary=await call('get_training_summary',{from:date,to:date})
  assert.ok(JSON.stringify(summary).includes('isolated-strength'))
  const final=await (await request('/api/data',{headers:{Cookie:cookie}})).json()
  assert.deepEqual(final.state.routines,original.routines)
  assert.equal(final.state.workouts[0].entries[0].target.dbLoad,'each')
  checks.push('prescribe → start → changed/partially skipped completion → sync → MCP review; master routine unchanged')
  fs.writeFileSync('/tmp/integration-result.json',JSON.stringify({ok:true,checks,completed:new Date().toISOString()}))
  console.log('[integration] PASS: '+checks.join('; '))
}
void smoke().catch(e=>{fs.writeFileSync('/tmp/integration-result.json',JSON.stringify({ok:false,error:e.message,checks}));console.error('[integration] FAIL: '+e.message)})
