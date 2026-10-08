import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { prescriptionStatus } from '../lib/session-prescription.js'
import { prescriptionRoutineId } from '../lib/session-plan.js'
import { startFlow, confirmSheet } from '../sheets.jsx'
import SessionComparisonPanel from './SessionComparisonPanel.jsx'
import SessionContextFields from './SessionContextFields.jsx'
import { Button } from './ui.jsx'

function storeFields(fields,owner) {
  if (useStore.getState().user?.id !== owner) return false
  const {sessionPrescriptions,sessionPrescriptionsVersion}=fields
  useStore.setState(s=>({S:{...s.S,sessionPrescriptions,sessionPrescriptionsVersion}}))
  return true
}
function StartSession({p,close}) {
  const [readiness,setReadiness]=useState({})
  const [owner]=useState(()=>useStore.getState().user?.id)
  return <><h3>{p.title || 'Start session'}</h3><SessionContextFields value={readiness} onChange={setReadiness} /><Button variant="primary" onClick={()=>{if(useStore.getState().user?.id!==owner)return;close();startFlow([prescriptionRoutineId(p)],{readiness})}}>Start workout</Button></>
}
function Postpone({p,close}) {
  const [owner]=useState(()=>useStore.getState().user?.id)
  const [date,setDate]=useState(p.date),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const save=async()=>{
    if(useStore.getState().user?.id!==owner)return
    setBusy(true);setError('')
    try {const fields=await api('/api/session-prescriptions/postpone',{method:'POST',body:JSON.stringify({session_id:p.id,revision:p.revision || 1,date})});if(storeFields(fields,owner))close()}
    catch(e){setError(e.message);setBusy(false)}
  }
  return <><h3>Postpone session</h3><p className="small">Keeps this session ID and archives the previous date and prescription. Started sessions cannot be moved.</p><label>New date<input className="input" type="date" min={todayISO()} value={date} onChange={e=>setDate(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<Button disabled={busy || !date || date===p.date} onClick={save}>Save new date</Button></>
}
export default function SessionInbox() {
  const S=useStore(s=>s.S),sync=useStore(s=>s.sync),user=useStore(s=>s.user),nav=useNavigate()
  const [filter,setFilter]=useState('upcoming'),[limit,setLimit]=useState(20)
  const records=(S.sessionPrescriptions || []).map(p=>({p,w:S.workouts.find(w=>w.session_id===p.id)}))
    .map(x=>({...x,status:prescriptionStatus(x.p,x.w)})).filter(x=>filter==='all' || (filter==='upcoming'?['planned','in_progress','expired'].includes(x.status):x.status===filter))
    .sort((a,b)=>filter==='upcoming'?a.p.date.localeCompare(b.p.date):b.p.date.localeCompare(a.p.date))
  return <>
    <p role="status" className="small muted">{!user?'Saved on this device. Sign in to share results with ChatGPT.':sync?.auth?'Sign in again to sync.':sync?.held?'Sync is paused. ChatGPT may see older results.':sync?.offline?'Offline. Device changes are waiting to sync.':sync?.lastError?'Sync failed. ChatGPT may see older results.':sync?.pending?'Device changes are waiting to sync. ChatGPT may see older results.':sync?.lastSynced?'Synced results are available through MCP.':'Connected. Results appear after a successful sync.'} Active workout sets stay on this device until you finish.</p>
    <label>Sessions<select className="input" value={filter} onChange={e=>{setFilter(e.target.value);setLimit(20)}}>{['upcoming','completed','abandoned','cancelled','all'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    {!records.length && <p className="muted">No sessions in this view.</p>}
    {records.slice(0,limit).map(({p,w,status})=><div className="card" key={p.id}>
      <strong>{p.title || w?.name || S.routines.find(r=>r.id===p.routine_id)?.name || p.id}</strong>
      <p className="small muted">{p.date} · {status.replaceAll('_',' ')} · revision {p.revision || 1}</p>
      <Button onClick={()=>useUI.getState().openSheet(close=><><SessionComparisonPanel prescription={p} workout={w} unit={S.unit} /><Button onClick={close}>Close</Button></>)}>View {w?'comparison':'prescription'}</Button>
      {S.active?.session_id===p.id ? <Button onClick={()=>nav('/workout')}>Resume on this device</Button>
        : status==='planned' && p.date===todayISO() && !S.active ? <Button variant="primary" onClick={()=>useUI.getState().openSheet(close=><StartSession p={p} close={close} />)}>Check-in &amp; start</Button> : null}
      {['planned','expired'].includes(status) && p.kind==='standalone' && <Button onClick={()=>useUI.getState().openSheet(close=><Postpone p={p} close={close} />)}>Postpone</Button>}
      {status==='in_progress' && S.active?.session_id!==p.id && <>
        <p className="small muted">Started on a device. Resume there to retain its actual sets.</p>
        <Button onClick={()=>confirmSheet({title:'Abandon started session?',message:'Sets on the original device remain there. This closes the prescription so a new session can be planned. No completed workout will be recorded.',confirmText:'Abandon',danger:true,onConfirm:async()=>{
          const owner=user?.id
          if(useStore.getState().user?.id!==owner)return
          try {const fields=await api('/api/session-prescriptions/abandon',{method:'POST',body:JSON.stringify({session_id:p.id,revision:p.revision || 1,reason:'Closed from session inbox; actual sets unavailable on this device',performed:[]})});storeFields(fields,owner)}
          catch(e){useUI.getState().toast(e.message)}
        }})}>Abandon session</Button>
      </>}
    </div>)}
    {records.length>limit && <Button onClick={()=>setLimit(n=>n+20)}>Show more</Button>}
  </>
}
