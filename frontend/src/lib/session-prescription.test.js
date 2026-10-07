import { it, expect } from 'vitest'
import { applyPrescription, prescriptionFor, sessionComparison } from './session-prescription.js'
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
