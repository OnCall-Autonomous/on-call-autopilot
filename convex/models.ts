import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
const kind=v.union(v.literal("llm"),v.literal("deterministic"));
export const list=query({args:{},handler:ctx=>ctx.db.query("modelProfiles").collect()});
export const getByAgent=query({args:{agent:v.string()},handler:(ctx,args)=>ctx.db.query("modelProfiles").withIndex("by_agent",q=>q.eq("agent",args.agent)).unique()});
export const upsert=mutation({args:{agent:v.string(),kind,provider:v.optional(v.string()),model:v.optional(v.string()),temperature:v.optional(v.number()),maxTokens:v.optional(v.number()),promptVersion:v.string(),enabled:v.boolean()},handler:async(ctx,args)=>{if(args.kind==="llm"&&(!args.provider||!args.model))throw new Error("LLM_PROFILE_REQUIRES_PROVIDER_AND_MODEL");const existing=await ctx.db.query("modelProfiles").withIndex("by_agent",q=>q.eq("agent",args.agent)).unique();if(existing){await ctx.db.patch(existing._id,{...args,updatedAt:Date.now()});return existing._id}return ctx.db.insert("modelProfiles",{...args,updatedAt:Date.now()})}});
