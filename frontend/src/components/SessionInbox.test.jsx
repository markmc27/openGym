import ExerciseSetupSheet from './ExerciseSetupSheet.jsx'
import {exerciseContext} from '../lib/training-context.js'
// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi,afterEach,beforeEach} from 'vitest'
import SessionInbox from './SessionInbox.jsx'
import SessionComparisonPanel from './SessionComparisonPanel.jsx'
const mocks=vi.hoisted(()=>({state:null,openSheet:vi.fn(),nav:vi.fn()}))
vi.mock('../store/useStore.js',()=>{const useStore=sel=>sel(mocks.state);useStore.getState=()=>mocks.state;useStore.setState=vi.fn();return{useStore}})
vi.mock('../store/useUI.js',()=>{const useUI=()=>({});useUI.getState=()=>({openSheet:mocks.openSheet});return{useUI}})
vi.mock('react-router-dom',()=>({useNavigate:()=>mocks.nav}))
vi.mock('../sheets.jsx',()=>({startFlow:vi.fn(),confirmSheet:vi.fn()}))
const prescription={id:'p',kind:'standalone',title:'Strength',date:'2026-10-08',revision:1,unit:'kg',exercises:[{position:1,exercise_id:'0289',exercise:{n:'DB press'},mode:'reps',unilateral:true,context:{load_convention:'per_dumbbell'},sets:[{load:12,reps:8,rir:2}]}]}
let host,root
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);mocks.state={user:{id:'test'},update:fn=>fn(mocks.state.S),sync:{pending:true},S:{unit:'kg',routines:[],workouts:[],sessionPrescriptions:[prescription]}};vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-08T12:00:00'))})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers()})
it('shows pending sync honestly and provides an optional check-in before starting today',()=>{
  act(()=>root.render(<SessionInbox/>))
  expect(host.textContent).toContain('waiting to sync')
  expect(host.textContent).toContain('until you finish')
  const start=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Check-in'))
  expect(start).toBeTruthy();act(()=>start.click());expect(mocks.openSheet).toHaveBeenCalled()
})
it('shows a completed unilateral comparison with the prescribed unit convention and recorded context',()=>{
  const workout={d:prescription.date,prescription,readiness:{energy:2},deviationReason:'Bench occupied',entries:[{id:'0289',rid:'session:p',sets:[{prescriptionSet:1,w:12,r:16,done:false,sides:{L:{w:12,r:8,done:true,rir:3},R:{w:12,r:8,done:false}}}]}]}
  act(()=>root.render(<SessionComparisonPanel prescription={prescription} workout={workout}/>))
  expect(host.textContent).toContain('0.5 work sets completed')
  expect(host.textContent).toContain('partially completed')
  expect(host.textContent).toContain('Per dumbbell')
  expect(host.textContent).toContain('energy: 2')
  expect(host.textContent).toContain('Bench occupied')
})

it('allows load context to be saved before starting a workout and exposes it through the shared coaching read',()=>{
  const ex={id:'0289',n:'DB press',eq:'dumbbell'},close=vi.fn()
  act(()=>root.render(<ExerciseSetupSheet ex={ex} close={close}/>))
  const select=host.querySelector('select')
  act(()=>{select.value='per_dumbbell';select.dispatchEvent(new Event('change',{bubbles:true}))})
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Save setup').click())
  expect(exerciseContext(mocks.state.S,ex).load_convention).toBe('per_dumbbell')
  expect(close).toHaveBeenCalled()
})
it('does not save exercise context into another profile if the account changes while the sheet is open',()=>{
  const ex={id:'0289',n:'DB press'},close=vi.fn()
  act(()=>root.render(<ExerciseSetupSheet ex={ex} close={close}/>))
  mocks.state.user={id:'another'}
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Save setup').click())
  expect(mocks.state.S.exerciseContexts).toBeUndefined()
  expect(close).not.toHaveBeenCalled()
})

it('does not present an unchecked target as actual completed work',()=>{
  const workout={d:prescription.date,prescription,entries:[],skippedExercises:[{id:'0289',rid:'session:p',sets:[{prescriptionSet:1,w:12,r:8,done:false}]}]}
  act(()=>root.render(<SessionComparisonPanel prescription={prescription} workout={workout}/>))
  expect(host.textContent).toContain('Actual: – · skipped')
})
