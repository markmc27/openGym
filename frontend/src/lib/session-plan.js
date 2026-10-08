// Session-only routines are projections, never entries in the permanent programme.
export const prescriptionRoutineId = p => p.kind === 'standalone' ? `session:${p.id}` : p.routine_id

export function sessionRoutine(p) {
  if (p.kind !== 'standalone') return null
  return {
    id: prescriptionRoutineId(p), name: p.title, prog: 'off', session_id: p.id,
    ex: p.exercises.map(e => {
      const work = e.sets.filter(s => s.phase !== 'warmup')
      const first = work[0] || e.sets[0]
      return {
        id: e.exercise_id, mode: e.mode || 'reps', sets: work.length,
        reps: first.reps == null ? 0 : first.reps * (e.unilateral ? 2 : 1),
        sec: first.seconds || 0, weight: first.load, side: !!e.unilateral,
        sg: e.superset_group, restSec: e.rest_sec, prescribedRestSec:e.rest_sec, prog: 'off',
      }
    }),
  }
}

export function routinesWithSessions(S) {
  return [...(S.routines || []), ...(S.sessionPrescriptions || [])
    .filter(p => p.kind === 'standalone' && !p.cancelled_at)
    .map(sessionRoutine)]
}
