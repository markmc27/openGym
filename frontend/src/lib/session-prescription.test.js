import { copyRowAt } from './history.js'
import { it, expect } from 'vitest'
import { applyPrescription, prescriptionFor, sessionComparison, prescriptionStatus } from './session-prescription.js'
import { buildCompletedWorkout } from './finish-workout.js'
const p = { id:'session-1', date:'2026-10-11', routine_id:'lower', unit:'kg', exercises:[{position:1,exercise_id:'hack',notes:'Controlled eccentric',sets:[{load:50,reps:7,rir:2},{load:50,reps:7}]}] }
it('selects only the dated single routine and does not reuse a completed prescription',()=>{
  const S={sessionPrescriptions:[p],workouts:[]}
  expect(prescriptionFor(S,p.date,['lower'])).toBe(p)
  expect(prescriptionFor(S,'2026-10-12',['lower'])).toBeNull()
  expect(prescriptionFor(S,p.date,['lower','core'])).toBeNull()
  expect(prescriptionFor({...S,workouts:[{session_id:p.id}]},p.date,['lower'])).toBeNull()
})
it('leaves the master target and original prescription untouched, and converts load units',()=>{
  const entries=[{id:'hack',target:{sets:4,reps:8,weight:20},planned:{sets:4,reps:8},sets:[]}]
  const original=structuredClone(entries)
  const built=applyPrescription(entries,p,'lb')
  expect(built[0].sets[0].w).toBeCloseTo(110.23113)
  expect(built[0].sets[0].r).toBe(7)
  expect(built[0].sets[0].rir).toBeUndefined()
  expect(built[0].sets[0].targetRir).toBe(2)
  expect(entries).toEqual(original)
  expect(p.exercises[0].sets[0].load).toBe(50)
})
it('retains the immutable prescription when skipped work disappears from completed entries',()=>{
  const entries=applyPrescription([{id:'hack',rid:'lower',sets:[]}],p,'kg')
  const w=buildCompletedWorkout({id:p.id,session_id:p.id,prescription:p,d:p.date,start:1,entries,routineIds:['lower']})
  expect(w.entries).toEqual([])
  expect(sessionComparison(p,w).exercises[0].skipped_exercise).toBe(true)
  expect(w.prescription).toEqual(p)
})

it('copied rows are extra sets, not another claimant to the prescribed set',()=>{
  const entry=applyPrescription([{id:'hack',rid:'lower',sets:[]}],p,'kg')[0]
  entry.sets=copyRowAt(entry.sets,0)
  entry.sets[1].done=true
  expect(entry.sets[1].prescriptionSet).toBeUndefined()
  expect(entry.sets[1].actualSetId).not.toBe(entry.sets[0].actualSetId)
  const c=sessionComparison(p,{d:p.date,entries:[entry]})
  expect(c.exercises[0].extra_sets).toHaveLength(1)
  expect(c.exercises[0].extra_sets[0].done).toBe(true)
})
it('revalidates modes, sides, warm-ups and intensifiers after a routine edit',()=>{
  for(const target of [{mode:'time'},{side:true},{warmupSets:2},{intensifier:'drop'}]) {
    expect(()=>applyPrescription([{id:'hack',target,sets:[]}],{...p,exercises:[p.exercises[0]]},'kg')).toThrow(/bilateral/)
  }
})
it('cancelled sessions are not selected and expired sessions remain queryable for backfill',()=>{
  expect(prescriptionFor({sessionPrescriptions:[{...p,cancelled_at:'now'}]},p.date,['lower'])).toBeNull()
  expect(prescriptionStatus(p,null,'2026-10-12')).toBe('expired')
  expect(prescriptionStatus({...p,cancelled_at:'now'},null,p.date)).toBe('cancelled')
  expect(prescriptionStatus(p,{d:p.date},p.date)).toBe('completed')
  expect(prescriptionFor({sessionPrescriptions:[p]},p.date,['lower'])).toEqual(p)
})
