import type { AgentName } from "../orchestrator/contracts";
export type ModelKind="llm"|"deterministic";
export interface ModelProfile {agent:AgentName;kind:ModelKind;provider?:string;model?:string;temperature?:number;maxTokens?:number;promptVersion:string;enabled:boolean}
export const DEFAULT_MODEL_PROFILES:ModelProfile[]=[
 {agent:"COMMANDER",kind:"llm",provider:"openrouter",model:"anthropic/claude-sonnet-4",temperature:0.1,maxTokens:4000,promptVersion:"commander-v1",enabled:true},
 {agent:"DIAGNOSER",kind:"llm",provider:"openrouter",model:"anthropic/claude-sonnet-4",temperature:0,maxTokens:5000,promptVersion:"diagnoser-v1",enabled:true},
 {agent:"FIXER",kind:"llm",provider:"openrouter",model:"anthropic/claude-sonnet-4",temperature:0,maxTokens:7000,promptVersion:"fixer-v1",enabled:true},
 {agent:"VERIFIER",kind:"deterministic",promptVersion:"verifier-v1",enabled:true},
 {agent:"PERFORMANCE",kind:"deterministic",promptVersion:"performance-v1",enabled:true},
 {agent:"REPORTER",kind:"llm",provider:"openrouter",model:"openai/gpt-4.1-mini",temperature:0.2,maxTokens:3000,promptVersion:"reporter-v1",enabled:true},
 {agent:"TEMP_SPECIALIST",kind:"llm",provider:"openrouter",model:"anthropic/claude-sonnet-4",temperature:0,maxTokens:4000,promptVersion:"specialist-v1",enabled:true},
];
export function resolveModelProfile(agent:AgentName,profiles:ModelProfile[]):ModelProfile{const profile=profiles.find(x=>x.agent===agent&&x.enabled);if(!profile)throw new Error(`MODEL_PROFILE_NOT_CONFIGURED:${agent}`);if(profile.kind==="llm"&&(!profile.provider||!profile.model))throw new Error(`MODEL_PROFILE_INVALID:${agent}`);return profile}
