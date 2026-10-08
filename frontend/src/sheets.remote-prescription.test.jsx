// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow, logPastWorkoutSheet } from './sheets.jsx'
import { todayISO } from './lib/format.js'
import { dayOverrideSheet } from './sheets.jsx'

beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  useUI.setState({sheets:[],toasts:[]})
  useStore.setState(s=>({user:{id:'fixture'},config:{mcp:true},S:{...s.S,active:null,workouts:[],weighIn:false,routines:[{id:'r',name:'Routine',ex:[{id:'0043',sets:3,reps:8,weight:20}]}],sessionPrescriptions:[]}}))
})
afterEach(()=>{vi.unstubAllGlobals();useStore.setState({user:null,config:null})})
it('starts an ordinary routine offline',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')))
  await act(async()=>{await startFlow(['r'])})
  expect(useStore.getState().S.active.routineIds).toEqual(['r'])
})
it('starts a cached prescribed session offline',async()=>{
  const p={id:'s',date:todayISO(),routine_id:'r',unit:'kg',exercises:[{position:1,exercise_id:'0043',sets:[{load:50,reps:7}]}]}
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')))
  await act(async()=>{await startFlow(['r'])})
  expect(useStore.getState().S.active.session_id).toBe('s')
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(50)
})
it('ignores a response after the profile changes and prevents duplicate starts',async()=>{
  let resolve
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{resolve=r})))
  const task=startFlow(['r'])
  expect(startFlow(['r'])).toBeUndefined()
  useStore.setState({user:{id:'other'}})
  await act(async()=>{resolve({ok:true,status:200,json:async()=>({sessionPrescriptions:[]})});await task})
  expect(useStore.getState().S.active).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not fall back to cached state after authentication failure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'not signed in'})}))
  await act(async()=>{await startFlow(['r'])})
  expect(useStore.getState().S.active).toBeNull()
})

it('logging a past prescribed workout keeps its ID, rows and original snapshot',()=>{
  const p={id:'past-session',date:'2026-10-01',routine_id:'r',unit:'kg',notes:'Slow eccentric',exercises:[{position:1,exercise_id:'0043',sets:[{load:50,reps:7,rir:2}]}]}
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  act(()=>logPastWorkoutSheet({iso:p.date,routineIds:['r']}))
  const host=document.createElement('div');document.body.appendChild(host)
  const root=createRoot(host),sheet=useUI.getState().sheets.at(-1)
  try {
    act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))))
    const button=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue')
    expect(button).toBeTruthy()
    act(()=>button.click())
    const active=useStore.getState().S.active
    expect(active.session_id).toBe(p.id)
    expect(active.d).toBe(p.date)
    expect(active.entries[0].sets[0]).toMatchObject({w:50,r:7,targetRir:2})
    expect(active.prescription).toEqual(p)
  } finally {act(()=>root.unmount());host.remove()}
})

const standalone = () => ({id:'standalone',kind:'standalone',schema_version:2,revision:1,date:todayISO(),title:'Main Gym Strength',unit:'kg',notes:'Synthetic session only',exercises:[
  {position:1,exercise_id:'0743',mode:'reps',exercise:{id:'0743',n:'Sled Hack Squat'},sets:[{load:20,reps:8,phase:'warmup'},{load:50,reps:7,rir:2}]},
  {position:2,exercise_id:'fixture-core',mode:'time',exercise:{id:'fixture-core',n:'Fixture Core Hold'},sets:[{load:0,seconds:30}]},
]})
it('claims and starts a standalone session without changing permanent routines',async()=>{
  const p=standalone(),started={...p,started_at:'now'},routines=structuredClone(useStore.getState().S.routines)
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  vi.stubGlobal('fetch',vi.fn(async(path,opts)=>({ok:true,status:200,json:async()=>opts?.method==='POST' ? {session:started,sessionPrescriptions:[started],sessionPrescriptionsVersion:2} : {sessionPrescriptions:[p],sessionPrescriptionsVersion:1}})))
  await act(async()=>{await startFlow(['session:standalone'])})
  const a=useStore.getState().S.active
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(a).toMatchObject({session_id:p.id,name:p.title,coachingNotes:p.notes})
  expect(a.prescription.started_at).toBe('now')
  expect(a.entries[0].sets[0]).toMatchObject({phase:'warmup',w:20,r:8})
  expect(a.entries[0].sets[1]).toMatchObject({targetRir:2,done:false})
  expect(a.entries[1].sets[0]).toMatchObject({sec:30,mode:'time',done:false})
  expect(useStore.getState().S.routines).toEqual(routines)
})
it('refuses to start an unclaimed standalone revision offline but allows its claimed snapshot',async()=>{
  const p=standalone()
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')))
  await act(async()=>{await startFlow(['session:standalone'])})
  expect(useStore.getState().S.active).toBeNull()
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[{...p,started_at:'now'}]}}))
  await act(async()=>{await startFlow(['session:standalone'])})
  expect(useStore.getState().S.active.session_id).toBe(p.id)
})
it('a concurrent prescription replacement prevents starting the stale revision',async()=>{
  const p=standalone()
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  vi.stubGlobal('fetch',vi.fn(async(path,opts)=>opts?.method==='POST'
    ? {ok:false,status:409,json:async()=>({error:'revision conflict; refresh the session'})}
    : {ok:true,status:200,json:async()=>({sessionPrescriptions:[p]})}))
  await act(async()=>{await startFlow(['session:standalone'])})
  expect(useStore.getState().S.active).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('the calendar displays the standalone title, complete exercise list and notes',()=>{
  const p=standalone()
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  act(()=>dayOverrideSheet(p.date))
  const host=document.createElement('div');document.body.appendChild(host)
  const root=createRoot(host),sheet=useUI.getState().sheets.at(-1)
  try {
    act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))))
    expect(host.textContent).toContain(p.title)
    expect(host.textContent).toContain('Sled Hack Squat')
    expect(host.textContent).toContain('Fixture Core Hold')
    expect(host.textContent).toContain('30s')
    expect(host.textContent).toContain(p.notes)
  } finally {act(()=>root.unmount());host.remove()}
})

it('claims a missed standalone session and keeps it selectable in the past-workout picker',async()=>{
  const p={...standalone(),date:'2026-10-01'},started={...p,started_at:'now'}
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions:[p]}}))
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({session:started,sessionPrescriptions:[started],sessionPrescriptionsVersion:2})}))
  act(()=>logPastWorkoutSheet({iso:p.date,routineIds:['session:standalone']}))
  const host=document.createElement('div');document.body.appendChild(host)
  const root=createRoot(host),sheet=useUI.getState().sheets.at(-1)
  try {
    act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))))
    expect(host.textContent).toContain(p.title)
    const button=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue')
    await act(async()=>{button.click();await new Promise(r=>setTimeout(r,0))})
    expect(useStore.getState().S.active).toMatchObject({session_id:p.id,d:p.date,name:p.title})
    expect(useStore.getState().S.active.prescription.started_at).toBe('now')
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {act(()=>root.unmount());host.remove()}
})
