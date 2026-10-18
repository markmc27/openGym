import { exAvailable, profileEquipment } from './equipment.js'
import { weightIncrement } from './progression.js'
import { isBellEx, dbLoadFor, dbLoadOf, withDbLoad, ownedWeightsFor } from './dumbbells.js'
export const LOAD_CONVENTIONS = {
  unspecified:'Not specified',per_dumbbell:'Per dumbbell',total:'Total load',
  added_load:'Added load only',assistance:'Assistance (less means harder)',bodyweight:'Bodyweight',
}
// A single interpretation feeds native calculations and the MCP snapshot. Explicit upstream
// routine/exercise settings win over legacy coaching metadata; old histories stay unchanged.
export function loadConventionFor(S,ex,cfg={}) {
  const own=S.exerciseContexts?.[ex.id]?.load_convention
  if (isBellEx(ex) && (dbLoadOf(cfg.dbLoad) || Object.hasOwn(S.dbLoad || {},ex.id))) {
    return {each:'per_dumbbell',total:'total',as:'unspecified'}[dbLoadFor(S,{...cfg,id:ex.id})]
  }
  return Object.hasOwn(LOAD_CONVENTIONS,own)?own:'unspecified'
}
export function saveLoadConvention(S,ex,convention,now=Date.now()) {
  if(isBellEx(ex)) S.dbLoad=withDbLoad(S.dbLoad,ex.id,{per_dumbbell:'each',total:'total'}[convention] || 'as',now)
}
export function equipmentContext(S) {
  const profiles=(S.equipProfiles || []).map(p=>({id:p.id,name:p.name,equipment:profileEquipment(p)}))
  const selected=profiles.find(p=>p.id===S.activeEquipId) || null
  return {equipment_profiles:profiles,selected_equipment_profile:selected,equipment_filter_enabled:!!S.equipFilterOn}
}
export function exerciseAvailable(S,ex) { return exAvailable(S,ex) }
export function exerciseContext(S,ex,cfg={}) {
  const own=S.exerciseContexts?.[ex.id] || {}
  const convention=loadConventionFor(S,ex,cfg)
  return {unit:S.unit || 'kg',exercise_id:ex.id,name:ex.n,equipment:ex.eq || null,available:exerciseAvailable(S,ex),
    load_convention:convention,load_convention_label:LOAD_CONVENTIONS[convention],
    ...(isBellEx(ex) ? {app_load_meaning:dbLoadFor(S,{...cfg,id:ex.id}),owned_weights:ownedWeightsFor(S,{...cfg,id:ex.id}) || null} : {}),machine:own.machine || null,
    aliases:Array.isArray(own.aliases)?own.aliases.slice(0,5):[],setup_notes:S.exNotes?.[ex.id] || null,
    increment:cfg.inc>0 ? cfg.inc : weightIncrement({id:ex.id},S.unit || 'kg'),increment_source:cfg.inc>0?'routine':'app_default',
    bar_weight:S.barWeights?.[ex.id] ?? null,plate_loading:S.loadKind?.[ex.id]?.kind ?? null,
    favourite:(S.favEx || []).includes(ex.id),last_used:(S.workouts || []).filter(w=>w.entries?.some(e=>e.id===ex.id)).map(w=>w.d).sort().at(-1) || null}
}
