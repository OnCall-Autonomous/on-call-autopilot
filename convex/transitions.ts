import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertCanResolve, assertTransition } from "../src/orchestrator/state-machine";
export const move=mutation({args:{incidentId:v.id("incidents"),to:v.any(),metadata:v.optional(v.any())},handler:async(ctx,args)=>{
 const incident=await ctx.db.get(args.incidentId); if(!incident)throw new Error("INCIDENT_NOT_FOUND"); assertTransition(incident.status,args.to);
 const metadata=args.metadata&&typeof args.metadata==="object"?args.metadata as Record<string,unknown>:{};
 if(args.to==="RESOLVED"){
  const verification=await ctx.db.query("verifications").withIndex("by_incident",q=>q.eq("incidentId",args.incidentId)).order("desc").first();
  const perf=await ctx.db.query("performance").withIndex("by_incident",q=>q.eq("incidentId",args.incidentId)).order("desc").first();
  assertCanResolve({verification:verification?{passed:verification.passed,status:verification.responseStatus,latencyMs:verification.latencyMs,assertions:verification.assertions,freshLogsClean:verification.freshLogsClean}:undefined,performance:perf?{verdict:perf.verdict,baselineP95Ms:perf.baselineP95Ms,postFixP50Ms:perf.postFixP50Ms,postFixP95Ms:perf.postFixP95Ms,successRate:perf.successRate,samples:perf.samples}:undefined});
 }
 const patch:{status:string;resolvedAt?:number;awaitingApproval:boolean;rootCause?:string;confidence?:number;resolutionSummary?:string}={status:args.to,awaitingApproval:args.to==="AWAITING_APPROVAL"};
 if(args.to==="RESOLVED")patch.resolvedAt=Date.now();
 if(typeof metadata.rootCause==="string"&&metadata.rootCause.trim())patch.rootCause=metadata.rootCause;
 if(typeof metadata.resolutionSummary==="string"&&metadata.resolutionSummary.trim())patch.resolutionSummary=metadata.resolutionSummary;
 if(typeof metadata.confidence==="number"&&Number.isFinite(metadata.confidence))patch.confidence=Math.max(0,Math.min(1,metadata.confidence));
 const now=Date.now(); await ctx.db.patch(args.incidentId,patch);
 await ctx.db.insert("events",{incidentId:args.incidentId,type:"STATE_TRANSITION",status:args.to,timestamp:now,metadata:{from:incident.status,...args.metadata}});
}});
