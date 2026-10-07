// A dated prescription belongs to one session, never to its master routine.
export function prescriptionFor(S, date, routineIds) {
  const ids = [].concat(routineIds || [])
  return (S.sessionPrescriptions || []).find(p => p.date === date
    && ids.length === 1 && p.routine_id === ids[0]
    && !(S.workouts || []).some(w => w.session_id === p.id)) || null
}

export function applyPrescription(entries, prescription, unit) {
  if (!prescription) return entries
  if (entries.length !== prescription.exercises.length || entries.some((e, i) => prescription.exercises[i].position !== i+1 || prescription.exercises[i].exercise_id !== e.id)) throw new Error('Routine changed after this session was prescribed')
  const factor = prescription.unit === unit ? 1 : unit === 'lb' ? 2.2046226218 : 1 / 2.2046226218
  return entries.map((entry, position) => {
    const prescribed = prescription.exercises.find(e => e.position === position + 1 && e.exercise_id === entry.id)
    if (!prescribed) return entry
    return {
      ...entry,
      // Do not invent a progression rule for a coach's explicit one-session decision.
      plan: null,
      coachingNotes: prescribed.notes || '',
      sets: prescribed.sets.map((s, i) => ({
        w: s.load * factor, r: s.reps, done: false,
        prescriptionSet: i + 1, targetRir: s.rir ?? null, targetRpe: s.rpe ?? null,
        coachingNotes: s.notes || '',
      })),
      target: { ...entry.target, sets: prescribed.sets.length, reps: prescribed.sets[0].reps, weight: prescribed.sets[0].load * factor },
    }
  })
}

export function sessionComparison(prescription, workout, actualUnit = prescription.unit) {
  return {
    session_id: prescription.id,
    planned_date: prescription.date,
    completed_date: workout?.d || null,
    status: workout ? 'completed' : 'planned',
    prescribed: prescription,
    completed_unit: actualUnit,
    // Preserve raw rows including RPE/RIR, unilateral sides, warm-ups and drop sets.
    completed: workout || null,
    exercises: prescription.exercises.map(p => {
      const actual = (workout?.entries || []).find(e => e.rid === prescription.routine_id && e.id === p.exercise_id)
      return { position: p.position, exercise_id: p.exercise_id, prescribed_sets: p.sets,
        actual_sets: actual?.sets || [], skipped_exercise: !!workout && !actual, note: actual?.note || null,
        comparison: p.sets.map((planned, i) => {
          const row = actual?.sets?.find(s => s.prescriptionSet === i + 1)
          const factor = actualUnit === prescription.unit ? 1 : actualUnit === 'lb' ? 1 / 2.2046226218 : 2.2046226218
          return { set: i + 1, status: !workout ? 'planned' : !row || !row.done ? 'skipped' : 'completed',
            actual_load_in_prescribed_unit: row?.done ? row.w * factor : null,
            load_difference: row?.done ? row.w * factor - planned.load : null,
            reps_difference: row?.done ? row.r - planned.reps : null,
            rir: row?.rir ?? null, rpe: row?.rpe ?? null }
        }) }

    }),
  }
}
