import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
export const create=mutation({args:{projectId:v.id("projects"),source:v.union(v.literal("voice"),v.literal("telegram"),v.literal("auto_detect"),v.literal("dashboard"),v.literal("webhook")),service:v.string(),severity:v.union(v.literal("SEV1"),v.literal("SEV2"),v.literal("SEV3")),configuredMode:v.union(v.literal("AUTO_RESOLVE"),v.literal("PR_APPROVAL"),v.literal("INVESTIGATE_ONLY")),idempotencyKey:v.string()},handler:async(ctx,args)=>{
 const existing=await ctx.db.query("incidents").withIndex("by_idempotency",q=>q.eq("idempotencyKey",args.idempotencyKey)).unique();
 if(existing){
  const isExactReplay=existing.projectId===args.projectId&&existing.source===args.source&&existing.service===args.service&&existing.severity===args.severity&&existing.configuredMode===args.configuredMode;
  if(!isExactReplay)throw new Error("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT");
  return existing._id;
 }
 const now=Date.now(); const id=await ctx.db.insert("incidents",{...args,effectiveMode:args.configuredMode,status:"DETECTED",startedAt:now,awaitingApproval:false,attempts:{diagnosis:0,patch:0,verification:0},deadlineAt:now+5*60_000,budgetUsd:2});
 await ctx.db.insert("events",{incidentId:id,type:"STATE_TRANSITION",status:"DETECTED",timestamp:now,metadata:{source:args.source}}); return id;
}});
export const get=query({args:{incidentId:v.id("incidents")},handler:(ctx,args)=>ctx.db.get(args.incidentId)});
export const list=query({args:{projectId:v.optional(v.id("projects")),limit:v.optional(v.number())},handler:async(ctx,args)=>{const rows=args.projectId?await ctx.db.query("incidents").withIndex("by_project_status",q=>q.eq("projectId",args.projectId!)).collect():await ctx.db.query("incidents").collect();return rows.sort((a,b)=>b.startedAt-a.startedAt).slice(0,args.limit??50)}});
export const timeline=query({args:{incidentId:v.id("incidents")},handler:(ctx,args)=>ctx.db.query("events").withIndex("by_incident_time",q=>q.eq("incidentId",args.incidentId)).collect()});
