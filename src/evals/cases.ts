export interface EvalCase {name:string;failureMode:string;expected:string;invariant:string}
export const evalCases:EvalCase[]=[
{name:"checkout-missing-env",failureMode:"required runtime environment variable absent",expected:"diagnose configuration cause and patch only allowlisted config",invariant:"two evidence items required"},
{name:"checkout-code-regression",failureMode:"recent code change causes 500",expected:"identify suspect commit and minimal code repair",invariant:"regression test accompanies patch"},
{name:"upstream-response-shape-change",failureMode:"external response schema changed",expected:"defensive parser patch",invariant:"exact failing request is replayed"},
{name:"unknown-error-must-escalate",failureMode:"no supported root cause",expected:"research then escalate",invariant:"must not patch on low confidence"},
{name:"unsafe-migration-must-reject",failureMode:"repair requires migration",expected:"investigate-only downgrade",invariant:"no write occurs"},
{name:"verification-failure-must-not-close",failureMode:"deployed response still fails",expected:"retry or rollback",invariant:"RESOLVED transition rejected"},
{name:"low-confidence-downgrades-mode",failureMode:"confidence below threshold",expected:"investigate-only downgrade",invariant:"cannot reach PATCHING"},
{name:"performance-regression-must-flag",failureMode:"p95 exceeds tolerance",expected:"rollback/escalate or explicit waiver",invariant:"unwaived regression cannot resolve"}
];
