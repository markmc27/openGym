import { it,expect } from 'vitest'
import { completedWorkSets,effortCounts,compactSession } from './session-review.js'
import { loadOfTrainingWeek,loadOfWorkouts } from './muscles.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { swapActiveExercise } from './active-exercise-swap.js'
import { sessionComparison } from './session-prescription.js'
import { mergeStates } from './sync-merge.js'
import { equipmentContext,exerciseContext,exerciseAvailable } from './training-context.js'
const p={id:'p',kind:'standalone',date:'2026-10-08',unit:'kg',title:'Strength',revision:1,exercises:[{position:1,exercise_id:'0289',mode:'reps',exercise:{id:'0289',n:'DB press',tg:'pectorals'},sets:[{load:12,reps:8},{load:12,reps:8},{load:12,reps:8}]}]}
it('counts half a unilateral pair, ignores warm-ups/cardio, and treats missing effort as unknown',()=>{
  const e={id:'0289',sets:[{done:true,phase:'warmup'},{done:false,sides:{L:{done:true,rir:2},R:{done:false}}},{done:true},{done:true,mode:'cardio',min:10}]}
  expect(completedWorkSets(e)).toBe(1.5)
  expect(effortCounts([{entries:[e]}])).toEqual({rated_work_sets:.5,unrated_work_sets:1})
  expect(loadOfWorkouts([{entries:[e]}]).chest).toBe(1.5)
})
it('replaces the recurring target with a dated prescription and uses the revision actually completed',()=>{
  const S={routines:[{id:'r',ex:[{id:'0289',sets:5}]}],week:{4:'r'},sessionPrescriptions:[p],workouts:[]}
  expect(loadOfTrainingWeek(S,'2026-10-05').chest).toBe(3)
  S.workouts=[{session_id:'p',prescription:p}];S.sessionPrescriptions=[{...p,exercises:[{...p.exercises[0],sets:[{load:12,reps:8}]}]}]
  expect(loadOfTrainingWeek(S,'2026-10-05').chest).toBe(3)
  S.sessionPrescriptions=[{...p,abandoned_at:'now'}];S.workouts=[]
  expect(loadOfTrainingWeek(S,'2026-10-05').chest).toBe(5)
  expect(loadOfTrainingWeek(S,'2026-10-05',{includeRecurring:false})).toEqual({})
})
it('retains the actual replacement, reason and check-in at finish and does not compare different lifts numerically',()=>{
  const active={id:'p',session_id:'p',prescription:p,d:p.date,start:1,readiness:{energy:2},deviationReason:'Busy gym',entries:[{id:'0289',rid:'session:p',exercise:p.exercises[0].exercise,sets:[{w:12,r:8,done:false}]}]}
  swapActiveExercise(active,0,{id:'0405',exercise:{id:'0405',n:'Shoulder press'},sets:[{w:15,r:6,done:true}]},{reason:'Bench occupied'})
  const w=buildCompletedWorkout(active)
  expect(w.entries[0].exercise.id).toBe('0405')
  expect(w.readiness.energy).toBe(2)
  expect(w.deviationReason).toBe('Busy gym')
  const c=sessionComparison(p,w)
  expect(c.exercises[0].substitutions[0].reason).toBe('Bench occupied')
  expect(c.exercises[0].comparison[0].status).toBe('substituted')
  expect(c.exercises[0].comparison[0].load_difference).toBeNull()
  expect(compactSession(p,w).exercises[0].substitutions).toHaveLength(1)
})
it('exposes explicit equipment conventions and merges independent context edits across devices',()=>{
  const S={unit:'kg',activeEquipId:'home',equipFilterOn:true,equipProfiles:[{id:'home',name:'Home',equipment:['dumbbell']}],exerciseContexts:{'0289':{load_convention:'per_dumbbell',machine:'Home DBs',_ts:5}},exNotes:{'0289':'Neutral grip'}}
  expect(equipmentContext(S).selected_equipment_profile.name).toBe('Home')
  const ex={id:'0289',n:'DB press',eq:'dumbbell'}
  expect(exerciseContext(S,ex).load_convention_label).toBe('Per dumbbell')
  expect(exerciseAvailable(S,{eq:'barbell'})).toBe(false)
  expect(exerciseAvailable(S,{eq:'body weight'})).toBe(true)
  const merged=mergeStates({...S,_ts:10},{...S,_ts:9,exerciseContexts:{'0289':{load_convention:'total',_ts:6},'0743':{load_convention:'added_load',_ts:8}}})
  expect(merged.exerciseContexts['0289'].load_convention).toBe('total')
  expect(merged.exerciseContexts['0743'].load_convention).toBe('added_load')
})

it('retains a reason for an entirely skipped exercise without adding it to completed progression history',()=>{
  const active={id:'p',session_id:'p',prescription:p,d:p.date,start:1,entries:[{id:'0289',rid:'session:p',note:'Bench unavailable',sets:[{w:12,r:8,done:false,prescriptionSet:1}]}]}
  const w=buildCompletedWorkout(active)
  expect(w.entries).toHaveLength(0)
  expect(w.skippedExercises[0].note).toBe('Bench unavailable')
  const c=sessionComparison(p,w)
  expect(c.exercises[0].skipped_exercise).toBe(true)
  expect(c.exercises[0].note).toBe('Bench unavailable')
})

it('counts every completed prescription on one date and replaces the recurring target only once',()=>{
  const second={...p,id:'second',exercises:[{...p.exercises[0],sets:p.exercises[0].sets.slice(0,2)}]}
  const S={routines:[{id:'r',ex:[{id:'0289',sets:5}]}],week:{4:'r'},sessionPrescriptions:[p,second],workouts:[{session_id:p.id,prescription:p},{session_id:second.id,prescription:second}]}
  expect(loadOfTrainingWeek(S,'2026-10-05').chest).toBe(5)
  expect(loadOfTrainingWeek(S,'2026-10-05',{includeRecurring:false}).chest).toBe(5)
})
