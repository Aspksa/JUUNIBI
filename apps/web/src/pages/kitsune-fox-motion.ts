/** Fifty bounded fox motion presets: 10 move families × 5 distinct amplitudes/speeds.
 * Only apply after a verified numeric change, never for an unavailable source. */
export type FoxMotion={family:string;variant:string;className:string};
export function foxMotion(index:number):FoxMotion {
 const safe=Number.isInteger(index)?Math.max(0,Math.min(99,index)):0;
 const family=Math.floor((safe%50)/5),variant=safe%5;
 return {family:"kt-fox-motion-"+family,variant:"kt-fox-variant-"+variant,
  className:"kt-fox-changed kt-fox-motion-"+family+" kt-fox-variant-"+variant};
}
export function foxChangedMetrics(
 previous:ReadonlyMap<string,number>,
 latest:readonly {id:string;value:number|null}[]
):Set<string>{
 const changed=new Set<string>();
 for(const m of latest)
  if(m.value!==null&&previous.has(m.id)&&previous.get(m.id)!==m.value)changed.add(m.id);
 return changed;
}
export function foxVerifiedReadings(metrics:readonly {id:string;value:number|null}[]):Map<string,number>{
 return new Map(metrics.filter((m):m is {id:string;value:number}=>m.value!==null&&Number.isFinite(m.value))
 .map(m=>[m.id,m.value]));
}
