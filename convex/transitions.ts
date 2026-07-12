import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertCanResolve, assertTransition } from "../src/orchestrator/state-machine";
export const move=mutation({args:{incidentId:v.id("incidents"),to:v.any(),metadata:v.optional(v.any())},handler:async(ctx,args)=>{
 const incident=await ctx.db.get(args.incidentId); if(!incident)throw new Error("INCIDENT_NOT_FOUND"); assertTransition(incident.status,args.to);
 if(args.to==="RESOLVED"){
  const verification=await ctx.db.query("verifications").withIndex("by_incident",q=>q.eq("incidentId",args.incidentId)).order("desc").first();
  const perf=await ctx.db.query("performance").withIndex("by_incident",q=>q.eq("incidentId",args.incidentId)).order("desc").first();
  assertCanResolve({verification:verification?{passed:verification.passed,status:verification.responseStatus,latencyMs:verification.latencyMs,assertions:verification.assertions,freshLogsClean:verification.freshLogsClean}:undefined,performance:perf?{verdict:perf.verdict,baselineP95Ms:perf.baselineP95Ms,postFixP50Ms:perf.postFixP50Ms,postFixP95Ms:perf.postFixP95Ms,successRate:perf.successRate,samples:perf.samples}:undefined});
 }
 const now=Date.now(); await ctx.db.patch(args.incidentId,{status:args.to,...(args.to==="RESOLVED"?{resolvedAt:now}:{}),awaitingApproval:args.to==="AWAITING_APPROVAL"});
 await ctx.db.insert("events",{incidentId:args.incidentId,type:"STATE_TRANSITION",status:args.to,timestamp:now,metadata:{from:incident.status,...args.metadata}});
}});
