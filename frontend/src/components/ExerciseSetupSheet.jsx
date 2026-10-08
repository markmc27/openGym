import {useState} from 'react'
import {useStore} from '../store/useStore.js'
import {LOAD_CONVENTIONS} from '../lib/training-context.js'
import {Button} from './ui.jsx'
export default function ExerciseSetupSheet({ex,close}) {
  const S=useStore(s=>s.S),update=useStore(s=>s.update)
  const [owner]=useState(()=>useStore.getState().user?.id)
  const [convention,setConvention]=useState(S.exerciseContexts?.[ex.id]?.load_convention || 'unspecified')
  const [machine,setMachine]=useState(S.exerciseContexts?.[ex.id]?.machine || '')
  const [aliases,setAliases]=useState((S.exerciseContexts?.[ex.id]?.aliases || []).join(', '))
  const [notes,setNotes]=useState(S.exNotes?.[ex.id] || '')
  const save=()=>{
    if(useStore.getState().user?.id!==owner)return
    update(s=>{
      s.exerciseContexts=s.exerciseContexts || {}
      s.exerciseContexts[ex.id]={load_convention:convention,machine:machine.trim().slice(0,200),aliases:aliases.split(',').map(v=>v.trim().slice(0,100)).filter(Boolean).slice(0,5),_ts:Date.now()}
      s.exNotes=s.exNotes || {}
      if(notes.trim())s.exNotes[ex.id]=notes.trim().slice(0,2000);else delete s.exNotes[ex.id]
    });close()
  }
  return <><h3>{ex.n} · setup</h3><p className="small muted">Used by your coach for future prescriptions. Existing prescription snapshots keep their original context. Use different custom exercise IDs for machines whose loads are not interchangeable.</p>
    <label>Logged load means<select className="input" value={convention} onChange={e=>setConvention(e.target.value)}>{Object.entries(LOAD_CONVENTIONS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
    <label>Gym / machine<input className="input" maxLength={200} value={machine} onChange={e=>setMachine(e.target.value)} /></label>
    <label>Familiar names (comma separated)<input className="input" maxLength={500} value={aliases} onChange={e=>setAliases(e.target.value)} /></label>
    <label>Standing setup notes<textarea className="input" rows={3} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} /></label>
    <Button variant="primary" onClick={save}>Save setup</Button></>
}
