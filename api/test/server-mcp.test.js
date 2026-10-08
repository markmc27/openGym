import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boundPort } from './helpers.mjs'

const API = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
test('MCP-enabled API isolates prescription files from whole-state sync and other profiles', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(),'gym-mcp-api-'))
  const secret = 'fixture-only-mcp-secret'
  const cookie = uid => {const p=`${uid}:${Date.now()+60000}:0`;return `gymsid=${p}.${crypto.createHmac('sha256',secret).update(p).digest('base64url')}`}
  fs.writeFileSync(path.join(data,'secret'),secret)
  fs.writeFileSync(path.join(data,'db.json'),JSON.stringify({users:[{id:'a',name:'A',admin:true},{id:'b',name:'B'}],creds:[],subs:[],invites:[]}))
  const state={workouts:[],routines:[],unit:'kg',_rev:1}
  fs.writeFileSync(path.join(data,'state-a.json'),JSON.stringify(state))
  const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  fs.writeFileSync(path.join(data,'prescriptions-a.json'),JSON.stringify({version:1,sessions:[{id:'session-a',date,routine_id:'lower',unit:'kg',notes:'Private A',exercises:[]}]}))
  const child=spawn(process.execPath,['server.js'],{cwd:API,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'0',DATA_DIR:data,ORIGIN:'http://localhost:8090',RP_ID:'localhost',MCP_ENABLED:'1'}})
  t.after(()=>{child.kill('SIGKILL');fs.rmSync(data,{recursive:true,force:true})})
  let log=''; child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d})
  const port=await boundPort(child,()=>log)
  const req=(url,method='GET',body=null,uid='a')=>new Promise((resolve,reject)=>{
    const r=http.request(`http://127.0.0.1:${port}${url}`,{method,headers:{host:'localhost',cookie:cookie(uid),origin:'http://localhost:8090','content-type':'application/json'}},res=>{
      let text='';res.on('data',d=>{text+=d});res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(text)}))
    });r.on('error',reject);r.end(body?JSON.stringify(body):undefined)
  })
  const got=await req('/api/data');assert.equal(got.status,200);assert.equal(got.json().state.sessionPrescriptions[0].notes,'Private A')
  const rev=await req('/api/data/rev');assert.equal(rev.json().sessionPrescriptionsVersion,1)
  const other=await req('/api/session-prescriptions','GET',null,'b');assert.equal(other.json().sessionPrescriptions.length,0)
  const startBody={session_id:'session-a',revision:1}
  assert.equal((await req('/api/session-prescriptions/start','POST',startBody,'b')).status,409)
  assert.equal((await req('/api/session-prescriptions/start','POST',startBody,'missing')).status,401)
  assert.equal((await req('/api/session-prescriptions/start','POST',{...startBody,revision:2})).status,409)
  assert.equal((await req('/api/session-prescriptions/start','POST',{...startBody,state:{}})).status,400)
  const started=await req('/api/session-prescriptions/start','POST',startBody)
  assert.equal(started.status,200)
  assert.ok(started.json().session.started_at)
  const again=await req('/api/session-prescriptions/start','POST',startBody)
  assert.equal(again.json().sessionPrescriptionsVersion,started.json().sessionPrescriptionsVersion)
  const abandon={session_id:'session-a',revision:1,reason:'Time constraint',performed:[{exercise_id:'0743',sets:[{load:45,reps:6,done:true}]}]}
  assert.equal((await req('/api/session-prescriptions/abandon','POST',abandon,'b')).status,409)
  assert.equal((await req('/api/session-prescriptions/abandon','POST',abandon,'missing')).status,401)
  assert.equal((await req('/api/session-prescriptions/abandon','POST',{...abandon,extra:1})).status,400)
  assert.equal((await req('/api/session-prescriptions/abandon','POST',{...abandon,revision:2})).status,409)
  const abandoned=await req('/api/session-prescriptions/abandon','POST',abandon)
  assert.equal(abandoned.status,200);assert.ok(abandoned.json().session.abandoned_at)
  assert.equal(abandoned.json().session.abandonment.performed[0].sets[0].reps,6)
  assert.equal((await req('/api/session-prescriptions/abandon','POST',abandon)).json().sessionPrescriptionsVersion,abandoned.json().sessionPrescriptionsVersion)
  assert.equal((await req('/api/session-prescriptions/start','POST',startBody)).status,409)
  const future=new Date(now);future.setDate(future.getDate()+1)
  const nextDate=`${future.getFullYear()}-${String(future.getMonth()+1).padStart(2,'0')}-${String(future.getDate()).padStart(2,'0')}`
  const store=JSON.parse(fs.readFileSync(path.join(data,'prescriptions-a.json')))
  store.sessions.push({id:'move-me',kind:'standalone',schema_version:2,revision:1,title:'Synthetic',date,unit:'kg',exercises:[{position:1,exercise_id:'0743',mode:'reps',sets:[{load:20,reps:8}]}]})
  fs.writeFileSync(path.join(data,'prescriptions-a.json'),JSON.stringify(store))
  const move={session_id:'move-me',revision:1,date:nextDate}
  assert.equal((await req('/api/session-prescriptions/postpone','POST',move,'b')).status,409)
  assert.equal((await req('/api/session-prescriptions/postpone','POST',{...move,date:'2026-02-30'})).status,400)
  const moved=await req('/api/session-prescriptions/postpone','POST',move)
  assert.equal(moved.status,200);assert.equal(moved.json().session.date,nextDate);assert.equal(moved.json().session.revision,2)
  assert.equal(moved.json().session.revisions[0].date,date)
  const p=await req('/api/data','PUT',{state:{...state,sessionPrescriptions:[{id:'forged'}],sessionPrescriptionsVersion:999},baseRev:1});assert.equal(p.status,200)
  const after=await req('/api/data');assert.equal(after.json().state.sessionPrescriptions[0].id,'session-a')
  const saved=JSON.parse(fs.readFileSync(path.join(data,'state-a.json')));assert.equal(saved.sessionPrescriptions,undefined)
  fs.writeFileSync(path.join(data,'prescriptions-b.json'),JSON.stringify({version:1,sessions:[{id:'private-b',notes:'B coaching notes'}]}))
  const deleted=await req('/api/admin/user/delete','POST',{id:'b'})
  assert.equal(deleted.status,200)
  assert.equal(fs.existsSync(path.join(data,'prescriptions-b.json')),false)
  assert.equal(fs.existsSync(path.join(data,'prescriptions-a.json')),true)
  const mcp=await req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(mcp.status,401,'ordinary app cookies must not authorize remote MCP')
})
