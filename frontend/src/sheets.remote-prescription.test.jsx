// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow, logPastWorkoutSheet } from './sheets.jsx'
import { todayISO } from './lib/format.js'

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
