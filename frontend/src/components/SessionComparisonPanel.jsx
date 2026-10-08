import { hasCompletedWork } from '../lib/workout-model.js'
import { exOr } from '../lib/exercises.js'
import { sessionComparison } from '../lib/session-prescription.js'
import { compactSession } from '../lib/session-review.js'
import { setLabel } from '../lib/history.js'
import { LOAD_CONVENTIONS } from '../lib/training-context.js'

const target = (s, e, unit) => `${s.load} ${unit} × ${s.reps != null ? `${s.reps} reps${e.unilateral ? ' per side' : ''}` : `${s.seconds}s`}${s.rir != null ? ` · RIR ${s.rir}` : s.rpe != null ? ` · RPE ${s.rpe}` : ''}`
export default function SessionComparisonPanel({prescription:p,workout:w,unit='kg'}) {
  const c=sessionComparison(p,w,unit),summary=compactSession(p,w,unit),planned=c.prescribed
  return <div>
    <h3>{planned.title || w?.name || 'Prescribed session'}</h3>
    <p className="small muted">{planned.date} · {c.status.replaceAll('_',' ')} · revision {c.revision}</p>
    <p className="small">{planned.notes}</p>
    {w && <p>{summary.completed_work_sets} work sets completed / {summary.prescribed_work_sets} prescribed. {summary.rated_work_sets} rated; {summary.unrated_work_sets} without effort ratings.</p>}
    {summary.readiness && <div className="card"><strong>Check-in</strong>{Object.entries(summary.readiness).map(([k,v])=><div key={k}>{k.replaceAll('_',' ')}: {v}</div>)}</div>}
    {(w?.deviationReason || w?.note) && <p>{w.deviationReason}{w.note ? ` · ${w.note}` : ''}</p>}
    {p.abandoned_at && <div className="card"><strong>Abandoned</strong><p>{p.abandonment?.reason}</p><p className="small muted">Partial results are retained. This prescription remains closed; ask the coach for a new dated session.</p>{p.abandonment?.performed?.map((e,i)=><details key={i}><summary>{exOr(e.exercise_id).n || e.exercise_id}: {e.sets.filter(s=>s.done).length} completed rows</summary><p>{e.note}</p>{e.substitution && <p>Replacement for {exOr(e.substitution.prescribed_exercise_id).n}: {e.substitution.reason}</p>}{e.sets.map((s,j)=><p className="small" key={j}>{s.side ? `${s.side}: ` : ''}{s.load} {p.abandonment.unit || p.unit} × {s.reps != null ? `${s.reps} reps` : s.seconds != null ? `${s.seconds}s` : `${s.minutes || 0} min`} · {s.done?'completed':'unchecked'}{s.rir != null ? ` · RIR ${s.rir}` : s.rpe != null ? ` · RPE ${s.rpe}` : ''}</p>)}</details>)}</div>}
    {c.exercises.map(e=>{
      const ex=planned.exercises.find(x=>x.position===e.position)
      return <div className="card" key={e.position}>
        <strong>{ex.exercise?.n || ex.exercise_id}</strong>
        {ex.context && <div className="small muted">Load: {LOAD_CONVENTIONS[ex.context.load_convention] || 'Not specified'}{ex.context.machine ? ` · ${ex.context.machine}` : ''}</div>}
        {ex.context?.setup_notes && <p className="small">Setup: {ex.context.setup_notes}</p>}
        {ex.notes && <p className="small">{ex.notes}</p>}
        {ex.sets.map((s,i)=>{
          const result=e.comparison[i],row=e.actual_sets.find(r=>r.prescriptionSet===i+1)
          return <div key={i} style={{padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
            <div className="small">{s.phase==='warmup'?'Warm-up':'Set'} {i+1}: {target(s,ex,planned.unit)}</div>
            {w && <div className="small muted">Actual: {row && hasCompletedWork(row) ? setLabel(ex.exercise_id,row,{mode:ex.mode,side:ex.unilateral}) : '–'} · {result.status.replaceAll('_',' ')}</div>}
            {s.notes && <div className="small">{s.notes}</div>}
          </div>
        })}
        {!!e.extra_sets.filter(hasCompletedWork).length && <p className="small">Additional sets: {e.extra_sets.filter(hasCompletedWork).map(s=>setLabel(ex.exercise_id,s,{mode:ex.mode,side:ex.unilateral})).join(' · ')}</p>}
        {e.substitutions.map((sub,i)=><p className="small" key={i}>Replacement: {sub.exercise?.n || sub.exercise_id} · {sub.reason || 'No reason recorded'}<br />{sub.actual_sets.filter(hasCompletedWork).map(s=>setLabel(sub.exercise_id,s)).join(' · ')}</p>)}
        {e.note && <p className="small">{e.note}</p>}
      </div>
    })}
  </div>
}
