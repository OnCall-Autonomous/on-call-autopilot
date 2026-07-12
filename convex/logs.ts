import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
export const ingest=mutation({args:{timestamp:v.number(),endpoint:v.string(),method:v.string(),status:v.number(),latency:v.number(),error:v.optional(v.string()),requestId:v.string(),version:v.string(),projectId:v.optional(v.id("projects")),repo:v.optional(v.string())},handler:async(ctx,args)=>{
 const {repo,...log}=args;
 let projectId=log.projectId;
 if(!projectId&&repo){const project=await ctx.db.query("projects").withIndex("by_repo",q=>q.eq("repo",repo)).unique();projectId=project?._id}
 const row={timestamp:log.timestamp,endpoint:log.endpoint,method:log.method,status:log.status,latency:log.latency,requestId:log.requestId,version:log.version,...(log.error!==undefined?{error:log.error}:{}),...(projectId?{projectId}:{})};
 return ctx.db.insert("logs",row);
}});
export const recentErrors=query({args:{projectId:v.id("projects"),since:v.number(),limit:v.optional(v.number())},handler:async(ctx,args)=>{const limit=Math.min(Math.max(args.limit??20,1),100);const rows=[];for await(const row of ctx.db.query("logs").withIndex("by_project_time",q=>q.eq("projectId",args.projectId).gte("timestamp",args.since)).order("desc")){if(row.status>=500)rows.push(row);if(rows.length>=limit)break}return rows}});
export const recent=query({args:{projectId:v.optional(v.id("projects")),limit:v.optional(v.number())},handler:(ctx,args)=>{const limit=Math.min(Math.max(args.limit??10,1),50);return args.projectId?ctx.db.query("logs").withIndex("by_project_time",q=>q.eq("projectId",args.projectId!)).order("desc").take(limit):ctx.db.query("logs").withIndex("by_timestamp").order("desc").take(limit)}});
