import type { Diagnosis, Guardrails, Mode } from "../domain/types";
export interface PatchProposal { repo:string; files:Array<{path:string;added:number;deleted:number}> }
export interface PolicyDecision { allowed:boolean; effectiveMode:Mode; reasons:string[] }
const rank:Record<Mode,number>={INVESTIGATE_ONLY:0,PR_APPROVAL:1,AUTO_RESOLVE:2};
function minMode(a:Mode,b:Mode):Mode{return rank[a]<=rank[b]?a:b}
function pathMatches(path:string,prefixes:string[]):boolean{return prefixes.some(p=>path===p||path.startsWith(p.endsWith("/")?p:`${p}/`))}
export function evaluatePolicy(configuredMode:Mode, diagnosis:Diagnosis, patch:PatchProposal|undefined, guardrails:Guardrails):PolicyDecision {
  const reasons:string[]=[]; let effectiveMode=configuredMode;
  if(diagnosis.confidence<guardrails.confidenceThreshold){effectiveMode="INVESTIGATE_ONLY";reasons.push("confidence_below_threshold")}
  if(diagnosis.migrationChange||diagnosis.dependencyChange||diagnosis.secretChange){effectiveMode="INVESTIGATE_ONLY";reasons.push("forbidden_change_class")}
  if(diagnosis.risk==="medium"){effectiveMode=minMode(effectiveMode,"PR_APPROVAL");reasons.push("medium_risk_requires_approval")}
  if(diagnosis.risk==="high"){effectiveMode="INVESTIGATE_ONLY";reasons.push("high_risk_investigate_only")}
  if(patch){
    if(!guardrails.allowedRepos.includes(patch.repo)){effectiveMode="INVESTIGATE_ONLY";reasons.push("repo_not_allowlisted")}
    if(patch.files.some(f=>!pathMatches(f.path,guardrails.allowedPaths))){effectiveMode="INVESTIGATE_ONLY";reasons.push("path_not_allowlisted")}
    if(patch.files.some(f=>pathMatches(f.path,guardrails.blockedPaths))){effectiveMode="INVESTIGATE_ONLY";reasons.push("blocked_path")}
    if(patch.files.length>guardrails.maxChangedFiles){effectiveMode="INVESTIGATE_ONLY";reasons.push("changed_file_limit")}
    if(patch.files.reduce((n,f)=>n+f.added+f.deleted,0)>guardrails.maxChangedLines){effectiveMode="INVESTIGATE_ONLY";reasons.push("changed_line_limit")}
  }
  return {allowed:effectiveMode!=="INVESTIGATE_ONLY"&&configuredMode!=="INVESTIGATE_ONLY",effectiveMode,reasons};
}
