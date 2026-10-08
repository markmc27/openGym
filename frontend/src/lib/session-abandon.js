import { isSideSet, isWarmupRow } from './workout-model.js'
export function abandonmentRequest(active, reason = '', unit = active.prescription?.unit || 'kg') {
  const row = (s, side) => ({load:s.w || 0,done:!!s.done,
    ...Object.fromEntries([['reps',s.r],['seconds',s.sec],['minutes',s.min],['speed',s.speed],['rir',s.rir],['rpe',s.rpe]].filter(([,v])=>v!=null)),
    ...(side ? {side} : s.side ? {side:s.side} : {}),phase:isWarmupRow(s)?'warmup':'work'})
  return {session_id:active.session_id,revision:active.prescription?.revision || 1,unit,...(active.readiness?{readiness:active.readiness}:{}),reason:reason.trim().slice(0,2000),
    performed:active.entries.map(e=>({exercise_id:e.id,...(e.substitution?{substitution:e.substitution}:{}),...(e.note ? {note:e.note.slice(0,2000)} : {}),
      sets:e.sets.flatMap(s=>isSideSet(s)?['L','R'].map(side=>row({...s.sides[side],phase:isWarmupRow(s)?'warmup':'work'},side)):[row(s)])}))}
}
