import { isSideSet, isWarmupRow, modeForSet } from './workout-model.js'
import { sessionComparison } from './session-prescription.js'

// One unilateral pair is one set; a completed limb is half a set. Effort is never inferred.
export function completedWorkSets(entry, pick) {
  return (entry.sets || []).reduce((n,s)=>{
    if (isWarmupRow(s) || modeForSet(s,entry.target)==='cardio') return n
    const credit = isSideSet(s) ? ['L','R'].reduce((v,key)=>v+(s.sides[key].done && (!pick || pick(s.sides[key])) ? 0.5 : 0),0)
      : s.done && (!pick || pick(s)) ? s.side ? 0.5 : 1 : 0
    return n+credit
  },0)
}
export function effortCounts(workouts) {
  let rated=0,unrated=0
  for (const w of workouts) for (const e of w.entries || []) {
    rated+=completedWorkSets(e,s=>s.rir!=null || s.rpe!=null)
    unrated+=completedWorkSets(e,s=>s.rir==null && s.rpe==null)
  }
  return {rated_work_sets:rated,unrated_work_sets:unrated}
}
export function compactSession(p,w,unit) {
  const c=sessionComparison(p,w,unit),planned=c.prescribed
  return {session_id:p.id,title:planned.title || w?.name || p.routine_id,date:p.date,completed_date:w?.d || null,
    status:c.status,revision:c.revision,current_revision:c.current_revision,
    readiness:w?.readiness || p.abandonment?.readiness || null,deviation_reason:w?.deviationReason || null,note:w?.note || null,
    abandonment:p.abandonment ? {reason:p.abandonment.reason,completed_rows:p.abandonment.performed.reduce((n,e)=>n+e.sets.filter(s=>s.done).length,0)} : null,
    prescribed_work_sets:planned.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.phase!=='warmup').length,0),
    completed_work_sets:(w?.entries || []).reduce((n,e)=>n+completedWorkSets(e),0),
    ...effortCounts(w?[w]:[]),
    exercises:c.exercises.map(e=>({position:e.position,exercise_id:e.exercise_id,
      name:planned.exercises.find(x=>x.position===e.position)?.exercise?.n || e.exercise_id,
      skipped:e.skipped_exercise,substitutions:e.substitutions,note:e.note,
      sets:e.comparison.map(s=>({set:s.set,phase:s.phase,status:s.status,load_difference:s.load_difference,
        reps_difference:s.reps_difference,seconds_difference:s.seconds_difference,sides:s.sides,rir:s.rir,rpe:s.rpe}))}))}
}
