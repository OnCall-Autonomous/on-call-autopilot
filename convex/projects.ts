import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
const mode=v.union(v.literal("AUTO_RESOLVE"),v.literal("PR_APPROVAL"),v.literal("INVESTIGATE_ONLY"));
export const list=query({args:{},handler:ctx=>ctx.db.query("projects").collect()});
export const get=query({args:{projectId:v.id("projects")},handler:(ctx,args)=>ctx.db.get(args.projectId)});
export const upsert=mutation({args:{name:v.string(),owner:v.string(),repo:v.string(),defaultBranch:v.string(),productionUrl:v.string(),cloudflareProject:v.string(),defaultMode:mode,guardrails:v.any(),verificationConfig:v.any(),baselineLatencyMs:v.number()},handler:async(ctx,args)=>{const existing=await ctx.db.query("projects").withIndex("by_repo",q=>q.eq("repo",args.repo)).unique();if(existing){await ctx.db.patch(existing._id,args);return existing._id}return ctx.db.insert("projects",{...args,createdAt:Date.now()})}});
