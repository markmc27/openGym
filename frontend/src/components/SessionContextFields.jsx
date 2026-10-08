export default function SessionContextFields({value={},onChange}) {
  const patch=(key,v)=>{const next={...value};if(v==='')delete next[key];else next[key]=v;onChange(next)}
  const numeric=(key,label,min,max)=><label>{label}<input className="input" type="number" min={min} max={max} step={1} value={value[key] ?? ''} onChange={e=>{const v=e.target.value;if(v==='')patch(key,'');else if(Number.isInteger(+v)&&+v>=min&&+v<=max)patch(key,+v)}} /></label>
  return <div className="sect-b">
    <p className="small muted">Optional check-in. Leave anything blank.</p>
    {numeric('available_minutes','Time available (minutes)',1,1440)}
    {numeric('energy','Energy (1–5)',1,5)}
    {numeric('soreness','Soreness (0–10)',0,10)}
    <label>Discomfort location<input className="input" maxLength={100} value={value.discomfort_location || ''} onChange={e=>patch('discomfort_location',e.target.value)} /></label>
    {numeric('discomfort_intensity','Discomfort (0–10)',0,10)}
    <label>Context<textarea className="input" rows={2} maxLength={1000} value={value.context || ''} onChange={e=>patch('context',e.target.value)} /></label>
  </div>
}
