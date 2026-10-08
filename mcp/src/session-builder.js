import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { atomicWrite } from '../../api/durable.js'
import { CATALOGUE } from '../../frontend/src/lib/exercises.js'
import { readPrescriptions } from './prescriptions.js'

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
const note = z.string().max(2000)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}, 'invalid calendar date')
const set = z.object({
  load: z.number().finite().min(0).max(2000),
  reps: z.number().int().min(1).max(1000).optional(),
  seconds: z.number().int().min(1).max(3600).optional(),
  phase: z.enum(['warmup', 'work']).optional(),
  rir: z.number().finite().min(0).max(10).optional(),
  rpe: z.number().finite().min(1).max(10).optional(), notes: note.optional(),
}).strict().refine(s => (s.reps != null) !== (s.seconds != null), 'use reps or seconds, not both')
  .refine(s => s.rir == null || s.rpe == null, 'use RIR or RPE, not both')
const exercise = z.object({
  position: z.number().int().min(1).max(100), exercise_id: id,
  mode: z.enum(['reps', 'time']), unilateral: z.boolean().optional()
    .describe('Reps mode only: each set specifies reps and load for EACH side; both sides are logged separately.'),
  rest_sec: z.number().int().min(0).max(3600).optional(),
  superset_group: id.optional(), notes: note.optional(),
  sets: z.array(set).min(1).max(30),
}).strict().superRefine((e, ctx) => {
  if (e.unilateral && e.mode !== 'reps') ctx.addIssue({code:'custom',path:['unilateral'],message:'unilateral prescriptions currently require reps mode'})
  let work = false
  e.sets.forEach((s, i) => {
    if ((e.mode === 'reps') !== (s.reps != null)) ctx.addIssue({code:'custom',path:['sets',i],message:'set must match exercise mode'})
    if (s.phase === 'warmup' && work) ctx.addIssue({code:'custom',path:['sets',i],message:'warm-ups must precede work sets'})
    if (s.phase !== 'warmup') work = true
  })
  if (!work) ctx.addIssue({code:'custom',path:['sets'],message:'at least one work set is required'})
})
export const standaloneSchema = z.object({
  session_id: id, title: z.string().trim().min(1).max(120), date,
  unit: z.enum(['kg','lb']), base_routine_id: id.optional(), notes: note.optional(),
  exercises: z.array(exercise).min(1).max(100),
}).strict()
export const replacementSchema = z.object({
  session_id: id, expected_revision: z.number().int().min(1).max(20),
  prescription: standaloneSchema.omit({session_id:true}),
}).strict()

export function publicPrescription(p) {
  const { requestHash, revisions, ...safe } = p
  return { ...safe, ...(revisions ? { revisions: revisions.map(publicPrescription) } : {}) }
}

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const hash = p => crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex')

function mutate(data, uid, fn) {
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error('invalid profile')
  const file = path.join(data, `prescriptions-${uid}.json`)
  let lock
  try { lock = fs.openSync(file+'.lock', 'wx', 0o600) }
  catch { throw new Error('prescription storage busy; retry later') }
  try {
    const store = readPrescriptions(data, uid)
    const result = fn(store)
    if (result.changed) {
      store.version = (store.version || 0) + 1
      atomicWrite(file, JSON.stringify(store), 0o600)
    }
    return result.session
  } finally { fs.closeSync(lock); fs.unlinkSync(file+'.lock') }
}

function prepare(S, input) {
  if (!S) throw new Error('sign in and sync your profile first')
  if (input.unit !== (S.unit || 'kg')) throw new Error('unit must match the profile')
  if (input.date < isoToday()) throw new Error('only an upcoming session can be prescribed')
  const horizon = new Date(isoToday()+'T12:00:00'); horizon.setDate(horizon.getDate()+60)
  const last = `${horizon.getFullYear()}-${String(horizon.getMonth()+1).padStart(2,'0')}-${String(horizon.getDate()).padStart(2,'0')}`
  if (input.date > last) throw new Error('session must be within the next 60 days')
  if (input.base_routine_id && !(S.routines || []).some(r => r.id === input.base_routine_id)) throw new Error('base routine not found')
  if (new Set(input.exercises.map(e => e.exercise_id)).size !== input.exercises.length) throw new Error('exercise IDs must be unique within a session')
  if (input.exercises.reduce((n,e)=>n+e.sets.length,0) > 300) throw new Error('at most 300 sets per session')
  const groups = new Map()
  const exercises = input.exercises.map((e, i) => {
    if (e.position !== i+1) throw new Error('exercise positions must be consecutive and in order')
    const ex = (S.customEx || []).find(x => x.id === e.exercise_id) || CATALOGUE.find(x => x.id === e.exercise_id)
    if (!ex) throw new Error(`unknown exercise: ${e.exercise_id}; use search_exercises first`)
    if (ex.bp === 'cardio') throw new Error('cardio prescriptions are not supported yet')
    if (e.superset_group) {
      const positions = groups.get(e.superset_group) || []
      positions.push(i); groups.set(e.superset_group, positions)
    }
    const snapshot = {id:e.exercise_id}
    for (const key of ['n','bp','eq','tg','img','gif']) {
      if (typeof ex[key] === 'string') snapshot[key] = ex[key].slice(0, key === 'img' || key === 'gif' ? 2048 : 200)
    }
    for (const key of ['sm','primaries','secondaries','muscleGroups']) {
      if (Array.isArray(ex[key])) snapshot[key] = ex[key].filter(v => typeof v === 'string').slice(0,30).map(v => v.slice(0,200))
    }
    return { ...e, exercise: snapshot }
  })
  for (const positions of groups.values()) {
    if (positions.length < 2 || positions.at(-1)-positions[0]+1 !== positions.length) throw new Error('a superset must contain at least two adjacent exercises')
  }
  const { session_id, ...rest } = input
  return { ...rest, id: session_id, kind:'standalone', schema_version:2, exercises }
}

function checkDateCapacity(store, S, p, exceptId) {
  const pending = store.sessions.filter(s => s.id !== exceptId && !s.cancelled_at && !(S.workouts || []).some(w => w.session_id === s.id))
  if (pending.some(s => s.date === p.date)) throw new Error('an unfinished prescription already exists for this date')
  if (pending.filter(s => s.date >= isoToday()).length >= 20) throw new Error('at most 20 unfinished prescriptions')
}

export function createStandalonePrescription(data, uid, S, input) {
  const parsed = standaloneSchema.parse(input)
  const requestHash = hash(parsed)
  return mutate(data, uid, store => {
    const previous = store.sessions.find(s => s.id === parsed.session_id)
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error('session_id already exists with a different prescription')
      return {session:previous, changed:false}
    }
    const p = prepare(S, parsed)
    checkDateCapacity(store, S, p)
    const saved = {...p, revision:1, created_at:new Date().toISOString(), requestHash}
    store.sessions.push(saved)
    return {session:saved, changed:true}
  })
}

export function replacePrescription(data, uid, S, input) {
  const parsed = replacementSchema.parse(input)
  const request = {session_id:parsed.session_id, ...parsed.prescription}
  const requestHash = hash(request)
  return mutate(data, uid, store => {
    const index = store.sessions.findIndex(s => s.id === parsed.session_id)
    const previous = store.sessions[index]
    if (!previous) throw new Error('session not found')
    const revision = previous.revision || 1
    // A lost response can be retried without making another revision.
    if (revision === parsed.expected_revision+1 && previous.requestHash === requestHash) return {session:previous,changed:false}
    if (revision !== parsed.expected_revision) throw new Error('revision conflict; read get_session before retrying')
    if (previous.started_at || previous.cancelled_at || (S?.workouts || []).some(w => w.session_id === previous.id)) throw new Error('only an unstarted, uncancelled session can be replaced')
    if (previous.schema_version !== 2 && previous.date <= isoToday()) throw new Error('legacy sessions on or before today cannot be replaced safely')
    if (revision >= 20) throw new Error('at most 20 revisions per session')
    const p = prepare(S, request)
    checkDateCapacity(store, S, p, previous.id)
    const {revisions, ...archived} = previous
    const saved = {...p, revision:revision+1, created_at:previous.created_at, updated_at:new Date().toISOString(), revisions:[...(revisions || []),archived], requestHash}
    store.sessions[index] = saved
    return {session:saved,changed:true}
  })
}

// The app claims a revision before opening it. Claim and replacement use the same lock.
export function startPrescription(data, uid, S, sessionId, expectedRevision) {
  id.parse(sessionId); z.number().int().min(1).max(20).parse(expectedRevision)
  return mutate(data, uid, store => {
    const p = store.sessions.find(s => s.id === sessionId)
    if (!p) throw new Error('session not found')
    if ((p.revision || 1) !== expectedRevision) throw new Error('revision conflict; refresh the session')
    if (p.cancelled_at || (S?.workouts || []).some(w => w.session_id === p.id)) throw new Error('session is cancelled or completed')
    if (p.date > isoToday()) throw new Error('cannot start a future session')
    if (p.started_at) return {session:p,changed:false}
    p.started_at = new Date().toISOString()
    return {session:p,changed:true}
  })
}
