import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStandalonePrescription, replacePrescription, startPrescription, publicPrescription } from '../src/session-builder.js'
import { readPrescriptions, cancelPrescription } from '../src/prescriptions.js'
import { invoke, tools } from '../src/service.js'
import { withProfile } from '../src/state.js'
import { effectiveRoutineIds, effectiveRoutines } from '../../frontend/src/lib/history.js'
import { buildCombinedEntries } from '../../frontend/src/lib/session-merge.js'
import { applyPrescription, sessionComparison } from '../../frontend/src/lib/session-prescription.js'
import { buildCompletedWorkout } from '../../frontend/src/lib/finish-workout.js'
import { toggleSide } from '../../frontend/src/lib/workout-model.js'
import { todayISO } from '../../frontend/src/lib/format.js'

let data, S
const input = () => ({session_id:'strength-1',title:'Synthetic strength',date:todayISO(),unit:'kg',notes:'Synthetic test only',exercises:[
  {position:1,exercise_id:'0743',mode:'reps',rest_sec:120,superset_group:'a',sets:[{phase:'warmup',load:20,reps:8},{load:50,reps:7,rir:2}]},
  {position:2,exercise_id:'0293',mode:'reps',unilateral:true,superset_group:'a',sets:[{load:12,reps:8,rpe:8}]},
  {position:3,exercise_id:'fixture-hold',mode:'time',notes:'Controlled breathing',sets:[{load:0,seconds:30}]},
]})
beforeEach(()=>{
  data=fs.mkdtempSync(path.join(os.tmpdir(),'gym-standalone-'))
  S={unit:'kg',routines:[],workouts:[],week:{},dayPlan:{},exWeights:{},customEx:[{id:'fixture-hold',n:'Fixture hold',bp:'waist',eq:'body weight'}]}
})
afterEach(()=>fs.rmSync(data,{recursive:true,force:true}))
const state = () => ({...S,sessionPrescriptions:readPrescriptions(data,'a').sessions})

it('creates a full standalone workout without routines and preserves dated IDs and snapshots',()=>{
  const original=structuredClone(S)
  const p=createStandalonePrescription(data,'a',S,input())
  expect(p).toMatchObject({id:'strength-1',revision:1,kind:'standalone'})
  expect(p.exercises[0].exercise.n).toBeTruthy()
  expect(createStandalonePrescription(data,'a',S,input())).toEqual(p)
  expect(S).toEqual(original)
  const st=state(), ids=effectiveRoutineIds(st,todayISO())
  expect(ids).toEqual(['session:strength-1'])
  expect(effectiveRoutines(st,todayISO())[0].name).toBe('Synthetic strength')
  const built=buildCombinedEntries(st,ids)
  const entries=applyPrescription(built.entries,p,'kg')
  expect(entries[0].sets[0]).toMatchObject({phase:'warmup',w:20,r:8,done:false})
  expect(entries[0].sets[1]).toMatchObject({w:50,r:7,targetRir:2})
  expect(entries[0].sg).toBe('a')
  expect(entries[1].sets[0].sides).toMatchObject({L:{w:12,r:8,done:false},R:{w:12,r:8,done:false}})
  expect(entries[2].sets[0]).toMatchObject({sec:30,mode:'time',done:false})
  expect(st.routines).toEqual([])
})

it('archives versions, keeps the ID, handles retries and refuses stale or started replacement',()=>{
  const p=createStandalonePrescription(data,'a',S,input())
  const {session_id,...prescription}=input()
  const request={session_id,expected_revision:1,prescription:{...prescription,title:'Revised synthetic strength'}}
  const revised=replacePrescription(data,'a',S,request)
  expect(revised.id).toBe(p.id)
  expect(revised.revision).toBe(2)
  expect(revised.revisions[0].title).toBe(p.title)
  expect(replacePrescription(data,'a',S,request)).toEqual(revised)
  expect(()=>replacePrescription(data,'a',S,{...request,prescription:{...prescription,title:'Conflicting edit'}})).toThrow(/revision conflict/)
  expect(()=>startPrescription(data,'a',S,p.id,1)).toThrow(/revision conflict/)
  const started=startPrescription(data,'a',S,p.id,2)
  expect(started.started_at).toBeTruthy()
  expect(startPrescription(data,'a',S,p.id,2)).toEqual(started)
  expect(()=>replacePrescription(data,'a',S,{...request,expected_revision:2})).toThrow(/unstarted/)
  expect(()=>cancelPrescription(data,'a',S,p.id)).toThrow(/started/)
  expect(JSON.stringify(publicPrescription(started))).not.toContain('requestHash')
})

it('compares timed work and partially completed unilateral work against the opened revision',()=>{
  const p=createStandalonePrescription(data,'a',S,input())
  const st=state(), built=buildCombinedEntries(st,effectiveRoutineIds(st,todayISO()))
  const entries=applyPrescription(built.entries,p,'kg')
  entries[0].sets[1]={...entries[0].sets[1],done:true,w:45,r:6,rir:3}
  entries[1].sets[0]=toggleSide(entries[1].sets[0],'L')
  entries[2].sets[0]={...entries[2].sets[0],done:true,sec:25}
  const w=buildCompletedWorkout({id:p.id,session_id:p.id,prescription:p,d:p.date,start:1,routineIds:built.routineIds,entries})
  const result=sessionComparison({...p,revision:2},w)
  expect(result.revision).toBe(1)
  expect(result.current_revision).toBe(2)
  expect(result.exercises[0].comparison[0].status).toBe('skipped')
  expect(result.exercises[0].comparison[1].load_difference).toBe(-5)
  expect(result.exercises[1].comparison[0]).toMatchObject({status:'partially_completed',sides:{L:{status:'completed',reps_difference:0},R:{status:'skipped'}}})
  expect(result.exercises[2].comparison[0].seconds_difference).toBe(-5)
  expect(w.entries[2].exercise.n).toBe('Fixture hold')
})

it('validates catalogue membership, exact schemas, mode, order, groups, effort and date conflicts',()=>{
  for (const change of [
    {extra:'arbitrary state'},
    {exercises:[{...input().exercises[0],exercise_id:'unknown'}]},
    {exercises:[{...input().exercises[2],position:1,mode:'reps'}]},
    {exercises:[{...input().exercises[0],sets:[{load:20,reps:8,rir:2,rpe:8}]}]},
    {exercises:[{...input().exercises[2],position:1,unilateral:true}]},
    {exercises:[{...input().exercises[0],superset_group:'alone'}]},
    {date:'2026-02-30'},
  ]) expect(()=>createStandalonePrescription(data,'a',S,{...input(),...change})).toThrow()
  createStandalonePrescription(data,'a',S,input())
  expect(()=>createStandalonePrescription(data,'a',S,{...input(),session_id:'other'})).toThrow(/unfinished/)
  expect(()=>createStandalonePrescription(data,'b',{...S,customEx:[]},input())).toThrow(/unknown exercise/)
  expect(readPrescriptions(data,'b').sessions).toEqual([])
})

it('search is read-only and never leaks or registers another profile’s custom exercises',async()=>{
  const search=tools.find(t=>t.name==='search_exercises')
  const a=await withProfile({data,user:{id:'a',name:'A'},readState:state},()=>invoke(search,{query:'Fixture hold'}))
  expect(a.exercises.find(e=>e.id==='fixture-hold')).toMatchObject({custom:true})
  const b=await withProfile({data,user:{id:'b',name:'B'},readState:()=>({...S,customEx:[]})},()=>invoke(search,{query:'Fixture hold'}))
  expect(b.exercises.some(e=>e.id==='fixture-hold')).toBe(false)
  expect(S.routines).toEqual([])
})
