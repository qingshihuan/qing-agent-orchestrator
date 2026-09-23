// Deterministic source/contract comparison, NOT a connected-model benchmark.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { decideOrchestration } from "../dist/src/orchestration-policy.js";
const baseline = "f5bc980173dc3117ac035f0def26483885a5ade4";
const oldJs = execFileSync("git", ["show", baseline+":.agents/skills/qing-agent-orchestrator-full/runtime/dist/src/orchestration-policy.js"], { encoding: "utf8" });
const old = await import("data:text/javascript;base64,"+Buffer.from(oldJs).toString("base64"));
const bytes = text => Buffer.byteLength(text.replace(/\r\n/g,"\n"));
const scenarios = [
  ["sequential-safe", "先规划接口，然后实现并测试", []],
  ["fixed-complete-unit", "按固定接口独立实现完整模块并通过既定验收测试，父任务只做集成验收", []],
  ["explicit-lite", "使用 Qing Lite：先规划接口，然后实现并测试", []],
  ["high-effect", "实现修复并部署到生产环境", ["infrastructure"]],
].map(([name,text,signals]) => {
  const input = {text,signals,route:"hybrid",category:"mixed",complexity:{score:45,band:"complex",category:"mixed",role:"planner",risk:"medium",scope:"multi-step",signals:[],reasons:[]}};
  const before = old.decideOrchestration(input), after = decideOrchestration(input);
  return {name,before:{tier:before.tier,childBudget:before.childAgentBudget},after:{tier:after.tier,childBudget:after.childAgentBudget},independentReviewPreserved:before.independentReviewer===after.independentReviewer};
});
const skills = Object.fromEntries(["qing-agent-orchestrator","qing-agent-orchestrator-full"].map(name=>{
  const path=".agents/skills/"+name+"/SKILL.md";
  return [name,{beforeBytes:bytes(execFileSync("git",["show",baseline+":"+path],{encoding:"utf8"})),afterBytes:bytes(readFileSync(path,"utf8"))}];
}));
const result = {baseline,method:"UTF-8 entry bytes and pure routing on synthetic fixed inputs; no host/model calls",skills,scenarios,limits:["Not a replay of the supplied six task runs: original fixtures and per-request measurements were not supplied","No measured total tokens, pricing, success rate or wall-clock speed improvement","Child budgets are decisions, not counts of actual executions"]};
writeFileSync("docs/parent-overhead-measurements.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
