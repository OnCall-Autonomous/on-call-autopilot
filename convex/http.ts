import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { jsonResponse, parseApprovalRequest, parseCreateIncidentRequest, parseEvalRunRequest, parseProjectRequest } from "../src/api/contracts";

const asId = <TableName extends TableNames>(value: string): Id<TableName> => value as Id<TableName>;
const optionalId = <TableName extends TableNames>(value: string | null): Id<TableName> | undefined =>
  value === null ? undefined : asId<TableName>(value);
const http=httpRouter();
const options=httpAction(async()=>jsonResponse({ok:true}));
for(const path of ["/api/health","/api/projects","/api/incidents","/api/incidents/detail","/api/approvals","/api/models","/api/overview","/api/evaluations","/api/evaluations/runs","/logs"])http.route({path,method:"OPTIONS",handler:options});
function finiteNumber(value:unknown,field:string){const n=Number(value);if(!Number.isFinite(n))throw new Error(`${field} must be a finite number`);return n}
function requiredString(value:unknown,field:string){if(typeof value!=="string"||!value.trim())throw new Error(`${field} is required`);return value}
http.route({path:"/api/health",method:"GET",handler:httpAction(async()=>jsonResponse({ok:true,service:"on-call-autopilot",timestamp:Date.now()}))});
http.route({path:"/api/projects",method:"GET",handler:httpAction(async ctx=>jsonResponse({data:await ctx.runQuery(api.projects.list,{})}))});
http.route({path:"/api/projects",method:"POST",handler:httpAction(async(ctx,req)=>{try{const body=parseProjectRequest(await req.json());const id=await ctx.runMutation(api.projects.upsert,body);return jsonResponse({data:{id}},201)}catch(error){return jsonResponse({error:error instanceof Error?error.message:"INVALID_REQUEST"},400)}})});
http.route({path:"/api/incidents",method:"GET",handler:httpAction(async(ctx,req)=>{const url=new URL(req.url);const projectId=optionalId<"projects">(url.searchParams.get("projectId"));const limit=Number(url.searchParams.get("limit")??50);return jsonResponse({data:await ctx.runQuery(api.incidents.list,{projectId,limit:Math.min(Math.max(limit,1),100)})})})});
http.route({path:"/api/incidents",method:"POST",handler:httpAction(async(ctx,req)=>{try{const body=parseCreateIncidentRequest(await req.json());const id=await ctx.runMutation(api.incidents.create,{projectId:asId<"projects">(body.projectId),source:body.source,service:body.service,severity:body.severity,configuredMode:body.configuredMode,idempotencyKey:body.idempotencyKey});return jsonResponse({data:{id}},201)}catch(error){return jsonResponse({error:error instanceof Error?error.message:"INVALID_REQUEST"},400)}})});
http.route({path:"/api/incidents/detail",method:"GET",handler:httpAction(async(ctx,req)=>{const id=new URL(req.url).searchParams.get("incidentId");if(!id)return jsonResponse({error:"incidentId is required"},400);return jsonResponse({data:await ctx.runQuery(api.dashboard.incidentDetail,{incidentId:asId<"incidents">(id)})})})});
http.route({path:"/api/overview",method:"GET",handler:httpAction(async(ctx,req)=>{const projectId=optionalId<"projects">(new URL(req.url).searchParams.get("projectId"));return jsonResponse({data:await ctx.runQuery(api.dashboard.overview,{projectId})})})});
http.route({path:"/api/approvals",method:"GET",handler:httpAction(async ctx=>jsonResponse({data:await ctx.runQuery(api.approvals.pending,{})}))});
http.route({path:"/api/approvals",method:"POST",handler:httpAction(async(ctx,req)=>{try{const raw=await req.json();const body=parseApprovalRequest(raw);const id=await ctx.runMutation(api.approvals.decide,{incidentId:raw.incidentId,...body});return jsonResponse({data:{id}})}catch(error){return jsonResponse({error:error instanceof Error?error.message:"INVALID_REQUEST"},400)}})});
http.route({path:"/api/models",method:"GET",handler:httpAction(async ctx=>jsonResponse({data:await ctx.runQuery(api.models.list,{})}))});
http.route({path:"/api/evaluations",method:"GET",handler:httpAction(async(ctx,req)=>{const limit=Number(new URL(req.url).searchParams.get("limit")??20);return jsonResponse({data:await ctx.runQuery(api.evaluations.summary,{limit:Math.min(Math.max(limit,1),100)})})})});
http.route({path:"/api/evaluations/runs",method:"POST",handler:httpAction(async(ctx,req)=>{try{const body=parseEvalRunRequest(await req.json());const id=await ctx.runMutation(api.evaluations.createRun,body);return jsonResponse({data:{id}},201)}catch(error){return jsonResponse({error:error instanceof Error?error.message:"INVALID_REQUEST"},400)}})});
// Shared-logs inlet: the guarded app (checkout-demo) POSTs each LogRecord to `${CONVEX_LOGS_URL}/logs`.
// A Cloudflare Worker can only speak plain HTTP, so this route bridges into the `logs.ingest` mutation.
http.route({path:"/logs",method:"POST",handler:httpAction(async(ctx,req)=>{try{const r=await req.json();const projectId=typeof r.projectId==="string"&&r.projectId.trim()?asId<"projects">(r.projectId):undefined;const repo=typeof r.repo==="string"&&r.repo.trim()?r.repo:typeof r.projectRepo==="string"&&r.projectRepo.trim()?r.projectRepo:undefined;const error=typeof r.error==="string"&&r.error?r.error:undefined;await ctx.runMutation(api.logs.ingest,{timestamp:finiteNumber(r.timestamp,"timestamp"),endpoint:requiredString(r.endpoint,"endpoint"),method:requiredString(r.method,"method"),status:finiteNumber(r.status,"status"),latency:finiteNumber(r.latency,"latency"),requestId:requiredString(r.requestId,"requestId"),version:requiredString(r.version,"version"),...(error!==undefined?{error}:{}),...(projectId!==undefined?{projectId}:{}),...(repo!==undefined?{repo}:{})});return jsonResponse({ok:true},202)}catch(error){return jsonResponse({error:error instanceof Error?error.message:"INVALID_LOG"},400)}})});
export default http;
