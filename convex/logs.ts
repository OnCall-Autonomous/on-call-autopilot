import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
export const ingest=mutation({args:{timestamp:v.number(),endpoint:v.string(),method:v.string(),status:v.number(),latency:v.number(),error:v.optional(v.string()),requestId:v.string(),version:v.string(),projectId:v.optional(v.id("projects"))},handler:(ctx,args)=>ctx.db.insert("logs",args)});
export const recentErrors=query({args:{projectId:v.id("projects"),since:v.number()},handler:async(ctx,args)=>(await ctx.db.query("logs").withIndex("by_project_time",q=>q.eq("projectId",args.projectId)).collect()).filter(x=>x.timestamp>=args.since&&x.status>=500)});
