import { todayISO } from './format.js'
import { modeOf, isPerSide } from './history.js'
import { prescriptionRoutineId } from './session-plan.js'
import { makeSideSet, hasCompletedWork, isSideSet } from './workout-model.js'

export function prescriptionStatus(p, workout, today = todayISO()) {
  if (workout) return 'completed'
  if (p.abandoned_at) return 'abandoned'
  if (p.cancelled_at) return 'cancelled'
  if (p.started_at) return 'in_progress'
  return p.date < today ? 'expired' : 'planned'
}

export function assertPrescriptionCompatible(cfg) {
  if (modeOf(cfg) !== 'reps' || isPerSide(cfg) || cfg?.intensifier || cfg?.warmupSets > 0) {
    throw new Error('Session prescription requires straight bilateral rep sets without warm-ups or intensifiers')
  }
}

// A dated prescription belongs to one session, never to its master routine.
export function prescriptionFor(S, date, routineIds) {
  const ids = [].concat(routineIds || [])
  return (S.sessionPrescriptions || []).find(p => !p.cancelled_at && !p.abandoned_at && p.date === date
    && ids.length === 1 && prescriptionRoutineId(p) === ids[0]
    && !(S.workouts || []).some(w => w.session_id === p.id)) || null
}

export function applyPrescription(entries, prescription, unit) {
  if (!prescription) return entries
  if (entries.length !== prescription.exercises.length || entries.some((e, i) => prescription.exercises[i].position !== i+1 || prescription.exercises[i].exercise_id !== e.id)) throw new Error('Routine changed after this session was prescribed')
  if (prescription.kind !== 'standalone') entries.forEach(e => assertPrescriptionCompatible({ ...e.target, id: e.id }))
  const factor = prescription.unit === unit ? 1 : unit === 'lb' ? 2.2046226218 : 1 / 2.2046226218
  return entries.map((entry, position) => {
    const prescribed = prescription.exercises.find(e => e.position === position + 1 && e.exercise_id === entry.id)
    if (!prescribed) return entry
    return {
      ...entry,
      // Do not invent a progression rule for a coach's explicit one-session decision.
      plan: null,
      ...(prescribed.exercise ? { exercise: structuredClone(prescribed.exercise) } : {}),
      coachingNotes: prescribed.notes || '',
      ...(prescribed.context ? { setupContext:structuredClone(prescribed.context), loadConvention:prescribed.context.load_convention_label } : {}),
      sets: prescribed.sets.map((s, i) => {
        const row = {
          w:s.load * factor, r:(s.reps || 0) * (prescribed.unilateral ? 2 : 1), done:false,
          ...(s.seconds != null ? {sec:s.seconds,mode:'time'} : {}),
          ...(s.phase ? {phase:s.phase} : {}),
          actualSetId:`${prescription.id}:${prescription.revision || 1}:${position+1}:${i+1}`,
          prescriptionSet:i+1, targetRir:s.rir ?? null, targetRpe:s.rpe ?? null, coachingNotes:s.notes || '',
        }
        return prescribed.unilateral ? makeSideSet(row) : row
      }),
      target: { ...entry.target, sets:prescribed.sets.filter(s => s.phase !== 'warmup').length,
        reps:(prescribed.sets.find(s => s.phase !== 'warmup') || prescribed.sets[0]).reps * (prescribed.unilateral ? 2 : 1) || 0,
        weight:(prescribed.sets.find(s => s.phase !== 'warmup') || prescribed.sets[0]).load * factor },
    }
  })
}

export function sessionComparison(prescription, workout, actualUnit = prescription.unit) {
  // Compare completion against the revision actually opened, even after a stale/offline client.
  const currentRevision = prescription.revision || 1
  prescription = workout?.prescription || prescription
  return {
    session_id: prescription.id,
    planned_date: prescription.date,
    completed_date: workout?.d || null,
    status: prescriptionStatus(prescription, workout),
    prescribed: prescription,
    revision: prescription.revision || 1, current_revision: currentRevision,
    completed_unit: actualUnit,
    // Preserve raw rows including RPE/RIR, unilateral sides, warm-ups and drop sets.
    completed: workout || null,
    exercises: prescription.exercises.map(p => {
      const recorded = [...(workout?.entries || []),...(workout?.skippedExercises || [])]
      const actual = recorded.find(e => e.rid === prescriptionRoutineId(prescription) && e.id === p.exercise_id)
      const substitutes = recorded.filter(e => e.substitution?.position === p.position && e.substitution?.prescribed_exercise_id === p.exercise_id)
      return { position: p.position, exercise_id: p.exercise_id, prescribed_sets: p.sets,
        substitutions: substitutes.map(e => ({ exercise_id:e.id, exercise:e.exercise || null, reason:e.substitution.reason || e.note || null, actual_sets:e.sets })),
        actual_sets: actual?.sets || [], extra_sets: (actual?.sets || []).filter(s => s.prescriptionSet == null), skipped_exercise: !!workout && !(actual?.sets || []).some(hasCompletedWork) && !substitutes.length, note: actual?.note || null,
        comparison: p.sets.map((planned, i) => {
          const row = actual?.sets?.find(s => s.prescriptionSet === i + 1)
          const factor = actualUnit === prescription.unit ? 1 : actualUnit === 'lb' ? 1 / 2.2046226218 : 2.2046226218
          const side = value => ({status:value?.done ? 'completed' : 'skipped',
            load_difference:value?.done ? value.w * factor - planned.load : null,
            reps_difference:value?.done ? value.r - planned.reps : null,
            rir:value?.rir ?? null,rpe:value?.rpe ?? null})
          const unilateral = isSideSet(row)
          return { set: i + 1, phase:planned.phase || 'work', status: !workout ? 'planned' : !row || !hasCompletedWork(row) ? substitutes.length ? 'substituted' : 'skipped' : row.done ? 'completed' : 'partially_completed',
            ...(unilateral ? {sides:{L:side(row.sides.L),R:side(row.sides.R)}} : {}),
            actual_load_in_prescribed_unit: row?.done ? row.w * factor : null,
            load_difference: row?.done && !unilateral ? row.w * factor - planned.load : null,
            reps_difference: row?.done && !unilateral && planned.reps != null ? row.r - planned.reps : null,
            seconds_difference: row?.done && planned.seconds != null ? row.sec - planned.seconds : null,
            rir: row?.rir ?? null, rpe: row?.rpe ?? null }
        }) }

    }),
  }
}
