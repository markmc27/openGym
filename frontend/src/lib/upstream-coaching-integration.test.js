import {describe,it,expect} from 'vitest'
import {EXIDX} from './exercises.js'
import {exerciseContext,loadConventionFor,saveLoadConvention} from './training-context.js'
import {applyPrescription} from './session-prescription.js'
import {mergeStates,stampChange,STAMPED_MAPS} from './sync-merge.js'
import {effortCounts} from './session-review.js'
import {workoutVolume} from './history.js'
const ex=EXIDX['0289']
describe('upstream 1.4 plus remote coaching',()=>{
  it('uses the app load meaning in MCP context, with routine overrides and owned dumbbells',()=>{
    const S={unit:'kg',dbLoad:{[ex.id]:{mode:'each',_ts:2}},exerciseContexts:{[ex.id]:{load_convention:'total',_ts:1}},dumbbells:{kg:{weights:[10,12,14],_ts:2}}}
    expect(exerciseContext(S,ex)).toMatchObject({load_convention:'per_dumbbell',app_load_meaning:'each',owned_weights:[10,12,14]})
    expect(exerciseContext(S,ex,{dbLoad:'total'}).load_convention).toBe('total')
    expect(loadConventionFor({...S,dbLoad:{}},ex)).toBe('total')
    expect(loadConventionFor({...S,dbLoad:{[ex.id]:{mode:null,_ts:3}}},ex)).toBe('unspecified')
  })
  it('saving coaching setup also changes the app default without rewriting completed rows',()=>{
    const w={entries:[{id:ex.id,target:{dbLoad:'each'},sets:[{w:12,r:8,done:true}]}]}
    const S={unit:'kg',workouts:[w]};const before=JSON.stringify(w)
    saveLoadConvention(S,ex,'total',123)
    expect(S.dbLoad[ex.id]).toEqual({mode:'total',_ts:123})
    expect(JSON.stringify(w)).toBe(before)
    expect(workoutVolume(w)).toBe(192)
  })
  it('prescribed loads and snapshotted meaning override automatic progression and new defaults',()=>{
    const p={id:'p',kind:'standalone',unit:'kg',exercises:[{position:1,exercise_id:ex.id,exercise:ex,context:{load_convention:'per_dumbbell',load_convention_label:'Per dumbbell'},sets:[{load:12,reps:8}]}]}
    const [e]=applyPrescription([{id:ex.id,target:{dbLoad:'total'},plan:{weight:100},sets:[{w:100,r:5}]}],p,'kg')
    expect(e.target.dbLoad).toBe('each');expect(e.plan).toBeNull();expect(e.sets[0]).toMatchObject({w:12,r:8,done:false})
    expect(workoutVolume({entries:[{...e,sets:e.sets.map(s=>({...s,done:true}))}]})).toBe(192)
  })
  it('syncs coaching setup alongside all new upstream stamped maps',()=>{
    expect(STAMPED_MAPS).toEqual(expect.arrayContaining(['exerciseContexts','dbLoad','dumbbells','dayNotes']))
    const a={_ts:1,exerciseContexts:{x:{machine:'A',_ts:2}},dbLoad:{x:{mode:'each',_ts:2}}}
    const b={_ts:2,exerciseContexts:{y:{machine:'B',_ts:3}},dayNotes:{'2026-10-18':{note:'Away',_ts:3}}}
    const m=mergeStates(a,b)
    expect(m.exerciseContexts.x.machine).toBe('A');expect(m.exerciseContexts.y.machine).toBe('B')
    expect(m.dbLoad.x.mode).toBe('each');expect(m.dayNotes['2026-10-18'].note).toBe('Away')
    const after=structuredClone(a);after.exerciseContexts.x.machine='C';after.exerciseContexts.x._ts=3;stampChange(a,after,100)
    expect(after.exerciseContexts.x._ts).toBe(100)
  })
  it('counts an explicitly failed set as known effort while unmarked rows stay unknown',()=>{
    expect(effortCounts([{entries:[{sets:[{done:true,failure:true},{done:true}]}]}])).toEqual({rated_work_sets:1,unrated_work_sets:1})
  })
})
