import type { Diagnosis, Guardrails, Mode } from "../domain/types";
import { evaluatePolicy, type PatchProposal } from "../policy/policy-guard";
export type NextAction="DIAGNOSE"|"PATCH"|"REQUEST_APPROVAL"|"DEPLOY"|"VERIFY"|"PERF_CHECK"|"REPORT"|"SELECT_ASSIGNEE"|"ESCALATE";
export function reviewDiagnosis(configuredMode:Mode, diagnosis:Diagnosis, guardrails:Guardrails, patch?:PatchProposal){
  if(diagnosis.evidence.length<2) return {effectiveMode:"INVESTIGATE_ONLY" as Mode,next:"ESCALATE" as NextAction,reasons:["insufficient_evidence"]};
  const policy=evaluatePolicy(configuredMode,diagnosis,patch,guardrails);
  const next:NextAction=policy.effectiveMode==="INVESTIGATE_ONLY"?"SELECT_ASSIGNEE":policy.effectiveMode==="PR_APPROVAL"?"PATCH":"PATCH";
  return {...policy,next};
}
export function shouldSpawnTemporarySpecialist(diagnosisAttempts:number, hasKnownSignature:boolean):boolean{return diagnosisAttempts===1&&!hasKnownSignature}
export function shouldSpawnReporter(verificationPassed:boolean,performanceVerdict:string):boolean{return verificationPassed&&["PASS","WAIVED"].includes(performanceVerdict)}
