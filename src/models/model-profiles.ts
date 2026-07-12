import type { AgentName } from "../orchestrator/contracts";
export type ModelKind="llm"|"deterministic";
export interface ModelProfile {agent:AgentName;kind:ModelKind;provider?:string;model?:string;temperature?:number;maxTokens?:number;promptVersion:string;enabled:boolean}
export const DEFAULT_MODEL_PROFILES:ModelProfile[]=[
 {agent:"COMMANDER",kind:"llm",provider:"openai",model:"gpt-4o-mini",temperature:0,maxTokens:2000,promptVersion:"commander-v1",enabled:true},
 {agent:"DIAGNOSER",kind:"llm",provider:"openai",model:"gpt-4o-mini",temperature:0,maxTokens:3000,promptVersion:"diagnoser-v1",enabled:true},
 {agent:"FIXER",kind:"deterministic",promptVersion:"fixer-disabled-v1",enabled:false},
 {agent:"VERIFIER",kind:"deterministic",promptVersion:"verifier-v1",enabled:true},
 {agent:"PERFORMANCE",kind:"deterministic",promptVersion:"performance-v1",enabled:true},
 {agent:"REPORTER",kind:"deterministic",promptVersion:"reporter-disabled-v1",enabled:false},
 {agent:"TEMP_SPECIALIST",kind:"deterministic",promptVersion:"specialist-disabled-v1",enabled:false},
];
export function resolveModelProfile(agent:AgentName,profiles:ModelProfile[]):ModelProfile{const profile=profiles.find(x=>x.agent===agent&&x.enabled);if(!profile)throw new Error(`MODEL_PROFILE_NOT_CONFIGURED:${agent}`);if(profile.kind==="llm"&&(!profile.provider||!profile.model))throw new Error(`MODEL_PROFILE_INVALID:${agent}`);return profile}
