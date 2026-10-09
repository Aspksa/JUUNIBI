import type { DecisionRecord } from "./decision-memory";
export interface RankingOption { id: string; baseScore: number; feasible: boolean }
export interface RankedOption extends RankingOption { adjustedScore: number; evidenceCount: number; adjustment: number }
/** Conservative, reversible ranking hint. Uses only owner-attested outcomes, never overrides feasibility. */
export function rankWithExperience(options: RankingOption[], history: DecisionRecord[], enabled = true): RankedOption[] {
  if (!Array.isArray(options) || options.length > 20 || options.some(o=>!o || typeof o.id!=="string" || !o.id ||
    typeof o.baseScore!=="number" || !Number.isFinite(o.baseScore) || typeof o.feasible!=="boolean"))
    throw Object.assign(new Error("Некорректные варианты"),{status:400});
  const safeHistory=Array.isArray(history)?history.slice(-100):[];
  return options.map(o=>{
    const sample=safeHistory.filter(r=>r.chosen===o.id && (r.observed==="success" || r.observed==="failure"));
    const successes=sample.filter(r=>r.observed==="success").length;
    // Require at least 3 owner confirmations; maximum +/- 5 points, no unchecked reinforcement.
    const adjustment=enabled && sample.length>=3 ? Math.round(5*(successes-sample.length/2)/(sample.length/2)) : 0;
    return {...o,adjustedScore:o.baseScore+(o.feasible?adjustment:0),adjustment:o.feasible?adjustment:0,evidenceCount:sample.length};
  }).sort((a,b)=>Number(b.feasible)-Number(a.feasible) || b.adjustedScore-a.adjustedScore || a.id.localeCompare(b.id));
}
