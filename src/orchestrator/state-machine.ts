import type { IncidentStatus, Mode, PerformanceResult, VerificationResult } from "../domain/types";

const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  DETECTED:["PLANNING","DIAGNOSING"], PLANNING:["DIAGNOSING","ESCALATED"],
  DIAGNOSING:["DIAGNOSIS_REVIEW","RETRYING","ESCALATED"], DIAGNOSIS_REVIEW:["PATCHING","ASSIGNEE_SELECTION","ESCALATED"],
  PATCHING:["PATCH_REVIEW","PR_READY","RETRYING","ESCALATED"], PATCH_REVIEW:["DEPLOYING","PR_READY","ESCALATED"],
  PR_READY:["AWAITING_APPROVAL"], AWAITING_APPROVAL:["DEPLOYING","ESCALATED"],
  DEPLOYING:["VERIFYING","ROLLING_BACK","ESCALATED"], VERIFYING:["PERF_CHECK","RETRYING","ROLLING_BACK","ESCALATED"],
  PERF_CHECK:["RESOLVED","ROLLING_BACK","ESCALATED"], ASSIGNEE_SELECTION:["HANDOFF_READY"], HANDOFF_READY:["ESCALATED"],
  RETRYING:["DIAGNOSING","PATCHING","VERIFYING","ESCALATED"], ROLLING_BACK:["ESCALATED"], RESOLVED:[], ESCALATED:[]
};
export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!transitions[from].includes(to)) throw new Error(`ILLEGAL_TRANSITION:${from}->${to}`);
}
export function assertCanResolve(input:{verification?:VerificationResult; performance?:PerformanceResult}):void {
  if (!input.verification?.passed || !input.verification.freshLogsClean) throw new Error("RESOLUTION_REQUIRES_PASSING_INDEPENDENT_VERIFICATION");
  if (!input.performance || !["PASS","WAIVED"].includes(input.performance.verdict)) throw new Error("RESOLUTION_REQUIRES_ACCEPTABLE_PERFORMANCE");
}
export function expectedPath(mode:Mode):IncidentStatus[]{
  if(mode==="INVESTIGATE_ONLY") return ["DETECTED","DIAGNOSING","DIAGNOSIS_REVIEW","ASSIGNEE_SELECTION","HANDOFF_READY","ESCALATED"];
  if(mode==="PR_APPROVAL") return ["DETECTED","DIAGNOSING","DIAGNOSIS_REVIEW","PATCHING","PR_READY","AWAITING_APPROVAL","DEPLOYING","VERIFYING","PERF_CHECK","RESOLVED"];
  return ["DETECTED","DIAGNOSING","DIAGNOSIS_REVIEW","PATCHING","PATCH_REVIEW","DEPLOYING","VERIFYING","PERF_CHECK","RESOLVED"];
}
