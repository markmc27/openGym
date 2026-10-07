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
  fs.writeFileSync(path.join(data,'db.json'),JSON.stringify({users:[{id:'a',name:'A'},{id:'b',name:'B'}],creds:[],subs:[],invites:[]}))
  const state={workouts:[],routines:[],unit:'kg',_rev:1}
  fs.writeFileSync(path.join(data,'state-a.json'),JSON.stringify(state))
  fs.writeFileSync(path.join(data,'prescriptions-a.json'),JSON.stringify({version:1,sessions:[{id:'session-a',date:'2026-10-11',routine_id:'lower',unit:'kg',notes:'Private A',exercises:[]}]}))
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
  const p=await req('/api/data','PUT',{state:{...state,sessionPrescriptions:[{id:'forged'}],sessionPrescriptionsVersion:999},baseRev:1});assert.equal(p.status,200)
  const after=await req('/api/data');assert.equal(after.json().state.sessionPrescriptions[0].id,'session-a')
  const saved=JSON.parse(fs.readFileSync(path.join(data,'state-a.json')));assert.equal(saved.sessionPrescriptions,undefined)
  const mcp=await req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(mcp.status,401,'ordinary app cookies must not authorize remote MCP')
})
