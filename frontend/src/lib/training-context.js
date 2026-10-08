import { CATALOGUE } from './exercises.js'
import { weightIncrement } from './progression.js'
export const LOAD_CONVENTIONS = {
  unspecified:'Not specified',per_dumbbell:'Per dumbbell',total:'Total load',
  added_load:'Added load only',assistance:'Assistance (less means harder)',bodyweight:'Bodyweight',
}
const knownEquipment = new Set(CATALOGUE.map(e=>e.eq).filter(Boolean))
export function equipmentContext(S) {
  const profiles=(S.equipProfiles || []).map(p=>({id:p.id,name:p.name,equipment:[...(p.equipment || [])]}))
  const selected=profiles.find(p=>p.id===S.activeEquipId) || null
  return {equipment_profiles:profiles,selected_equipment_profile:selected,equipment_filter_enabled:!!S.equipFilterOn}
}
export function exerciseAvailable(S,ex) {
  const p=(S.equipProfiles || []).find(p=>p.id===S.activeEquipId)
  return !S.equipFilterOn || !p || !ex.eq || ex.eq==='body weight' || !knownEquipment.has(ex.eq) || p.equipment.includes(ex.eq)
}
export function exerciseContext(S,ex,cfg={}) {
  const own=S.exerciseContexts?.[ex.id] || {}
  const convention=Object.hasOwn(LOAD_CONVENTIONS,own.load_convention)?own.load_convention:'unspecified'
  return {unit:S.unit || 'kg',exercise_id:ex.id,name:ex.n,equipment:ex.eq || null,available:exerciseAvailable(S,ex),
    load_convention:convention,load_convention_label:LOAD_CONVENTIONS[convention],machine:own.machine || null,
    aliases:Array.isArray(own.aliases)?own.aliases.slice(0,5):[],setup_notes:S.exNotes?.[ex.id] || null,
    increment:cfg.inc>0 ? cfg.inc : weightIncrement({id:ex.id},S.unit || 'kg'),increment_source:cfg.inc>0?'routine':'app_default',
    bar_weight:S.barWeights?.[ex.id] ?? null,plate_loading:S.loadKind?.[ex.id]?.kind ?? null,
    favourite:(S.favEx || []).includes(ex.id),last_used:(S.workouts || []).filter(w=>w.entries?.some(e=>e.id===ex.id)).map(w=>w.d).sort().at(-1) || null}
}
