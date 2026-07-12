import { mutation } from "./_generated/server";
import { v } from "convex/values";
// Append a human-readable timeline event that mirrors a demo/orchestrator log line 1:1.
// Append-only; metadata is a short label/message pair (no secrets, no raw request bodies).
export const append=mutation({args:{incidentId:v.id("incidents"),step:v.string(),message:v.string(),elapsedMs:v.optional(v.number()),timestamp:v.optional(v.number())},handler:(ctx,args)=>ctx.db.insert("events",{incidentId:args.incidentId,type:"TIMELINE",status:args.step,timestamp:args.timestamp??Date.now(),metadata:{step:args.step,message:args.message.slice(0,500),...(args.elapsedMs!==undefined?{elapsedMs:args.elapsedMs}:{})}})});
