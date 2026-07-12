import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { diagnosisOutput, type DiagnosisOutput } from "../src/orchestrator/contracts";

export type Diagnosis = DiagnosisOutput;
type Envelope={choices?:Array<{message?:{content?:unknown}}> ;usage?:{total_tokens?:unknown;cost?:unknown;cost_usd?:unknown}};

const MAX_LOG_ERROR_LENGTH=500;
function redactLogError(value:string|undefined){
  if(!value)return value;
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi,"Bearer [REDACTED]")
    .replace(/([?&](?:api_?key|token|secret|password)=)[^&\s]+/gi,"$1[REDACTED]")
    .replace(/\b(?:api_?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,"credential=[REDACTED]")
    .slice(0,MAX_LOG_ERROR_LENGTH);
}

export const configuration=internalQuery({args:{incidentId:v.id("incidents")},handler:async(ctx,{incidentId})=>{const incident=await ctx.db.get(incidentId);if(!incident)return null;const [profile,project,events,logs]=await Promise.all([ctx.db.query("modelProfiles").withIndex("by_agent",q=>q.eq("agent","DIAGNOSER")).unique(),ctx.db.get(incident.projectId),ctx.db.query("events").withIndex("by_incident_time",q=>q.eq("incidentId",incidentId)).order("desc").take(20),ctx.db.query("logs").withIndex("by_project_time",q=>q.eq("projectId",incident.projectId)).order("desc").take(20)]);return {profile:profile?.enabled&&profile.kind==="llm"?profile:null,context:{incident:{service:incident.service,severity:incident.severity,mode:incident.effectiveMode,status:incident.status},project:project?{name:project.name,owner:project.owner,repo:project.repo,defaultBranch:project.defaultBranch}:null,events:events.map(e=>({type:e.type,status:e.status,timestamp:e.timestamp})),logs:logs.map(l=>({timestamp:l.timestamp,endpoint:l.endpoint,method:l.method,status:l.status,latency:l.latency,error:redactLogError(l.error),requestId:l.requestId,version:l.version}))}};}});

function category(error:unknown){if(error instanceof SyntaxError)return "MALFORMED_MODEL_JSON";const message=error instanceof Error?error.message:"";if(message==="MODEL_CONFIGURATION_UNAVAILABLE")return message;if(message==="MODEL_HTTP_FAILURE")return message;if(message==="INVALID_MODEL_ENVELOPE")return message;return "INVALID_DIAGNOSIS";}

export const callModel=internalAction({args:{incidentId:v.id("incidents"),runId:v.id("agentRuns")},handler:async(ctx,args)=>{const started=Date.now();try{const config=await ctx.runQuery(internal.diagnoser.configuration,{incidentId:args.incidentId});const profile=config?.profile;const apiKey=process.env.DIAGNOSER_API_KEY;const baseUrl=process.env.DIAGNOSER_BASE_URL;if(!config||!profile?.model||!apiKey||!baseUrl)throw new Error("MODEL_CONFIGURATION_UNAVAILABLE");const response=await fetch(`${baseUrl.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:profile.model,temperature:profile.temperature??0,max_tokens:profile.maxTokens??1000,response_format:{type:"json_object"},messages:[{role:"system",content:"Return only strict JSON matching the diagnosis contract. Evidence must be at least two objects with source (log/deployment/commit/code/runbook/research), summary, and ref. Never invent evidence or claim code/deployment changes. If context lacks substantive evidence, state insufficiency truthfully."},{role:"user",content:JSON.stringify(config.context)}]})});if(!response.ok)throw new Error("MODEL_HTTP_FAILURE");const body=await response.json() as Envelope;const content=body.choices?.[0]?.message?.content;if(typeof content!=="string")throw new Error("INVALID_MODEL_ENVELOPE");const diagnosis=diagnosisOutput.parse(JSON.parse(content));const usage=body.usage;const cost=typeof usage?.cost==="number"?usage.cost:typeof usage?.cost_usd==="number"?usage.cost_usd:undefined;await ctx.runMutation(internal.orchestration.persistModelSuccess,{...args,diagnosis,model:profile.model,tokens:typeof usage?.total_tokens==="number"?usage.total_tokens:undefined,cost,durationMs:Date.now()-started});}catch(error){await ctx.runMutation(internal.orchestration.failClosed,{...args,reason:category(error),durationMs:Date.now()-started});}}});
