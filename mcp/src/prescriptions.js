import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { atomicWrite } from '../../api/durable.js'
import { modeOf, isPerSide } from '../../frontend/src/lib/history.js'

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
const notes = z.string().max(2000)
const set = z.object({
  reps: z.number().int().min(1).max(1000), load: z.number().finite().min(0).max(2000),
  rir: z.number().min(0).max(10).optional(), rpe: z.number().min(1).max(10).optional(),
  notes: notes.optional(),
}).strict().refine(s => s.rir == null || s.rpe == null, 'use either RIR or RPE, not both')
export const prescriptionSchema = z.object({
  session_id: id.describe('Stable caller-generated ID; reuse only to retry the identical prescription.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const d = new Date(v + 'T12:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'invalid calendar date'),
  routine_id: id, unit: z.enum(['kg', 'lb']), notes: notes.optional(),
  exercises: z.array(z.object({ position: z.number().int().min(1).max(100), exercise_id: id,
    sets: z.array(set).min(1).max(30), notes: notes.optional() }).strict()).min(1).max(100),
}).strict()

export function readPrescriptions(data, uid) {
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error('invalid profile')
  try { return JSON.parse(fs.readFileSync(path.join(data, `prescriptions-${uid}.json`), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return { version: 0, sessions: [] }; throw new Error('prescription storage unreadable') }
}

export function createPrescription(data, uid, S, input) {
  const p = prescriptionSchema.parse(input)
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const file = path.join(data, `prescriptions-${uid}.json`)
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error('invalid profile')
  // Cross-process exclusion for stdio and HTTP. Fail closed on a stale lock; never break it.
  let lock
  try { lock = fs.openSync(file + '.lock', 'wx', 0o600) }
  catch { throw new Error('prescription storage busy; retry later (operator must inspect any stale lock)') }
  try {
    const store = readPrescriptions(data, uid)
    const previous = store.sessions.find(s => s.id === p.session_id)
    const request = JSON.stringify(p)
    if (previous) {
      if (previous.requestHash !== crypto.createHash('sha256').update(request).digest('hex')) throw new Error('session_id already exists with a different prescription; existing prescriptions are immutable')
      return previous
    }
    if (p.date < today) throw new Error('only an upcoming session can be prescribed')
    const horizon = new Date(now); horizon.setDate(horizon.getDate() + 60)
    if (p.date > `${horizon.getFullYear()}-${String(horizon.getMonth()+1).padStart(2,'0')}-${String(horizon.getDate()).padStart(2,'0')}`) throw new Error('session must be within the next 60 days')
    if (!S) throw new Error('sign in and sync your programme first')
    if (p.unit !== (S.unit || 'kg')) throw new Error('unit must match the profile; read the routine first')
    const routine = (S.routines || []).find(r => r.id === p.routine_id)
    if (!routine) throw new Error('routine not found')
    if (p.exercises.length !== routine.ex.length) throw new Error('prescribe every exercise in the routine in order')
    if (new Set(p.exercises.map(e => e.exercise_id)).size !== p.exercises.length) throw new Error('v1 requires unique exercises within a routine')
    p.exercises.forEach((e, i) => {
      const cfg = routine.ex[i]
      if (e.position !== i+1 || e.exercise_id !== cfg.id) throw new Error('exercise position/id must match the routine')
      if (modeOf({ ...cfg, id: cfg.id }) !== 'reps' || isPerSide(cfg) || cfg.intensifier || cfg.warmupSets > 0) throw new Error('v1 prescriptions support straight bilateral rep sets without warm-ups or intensifiers only')
    })
    if (store.sessions.some(s => s.date === p.date && !(S.workouts || []).some(w => w.session_id === s.id))) throw new Error('an unfinished prescription already exists for this date')
    if (store.sessions.filter(s => !(S.workouts || []).some(w => w.session_id === s.id)).length >= 20) throw new Error('at most 20 unfinished prescriptions')
    const { session_id, ...rest } = p
    const saved = { ...rest, id: session_id, created_at: new Date().toISOString(), requestHash: crypto.createHash('sha256').update(request).digest('hex') }
    store.sessions.push(saved); store.version++
    atomicWrite(file, JSON.stringify(store), 0o600)
    return saved
  } finally { fs.closeSync(lock); fs.unlinkSync(file + '.lock') }
}
