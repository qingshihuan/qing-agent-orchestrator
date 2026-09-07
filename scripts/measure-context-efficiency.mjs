import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { selectEventPage } from "../dist/src/output-efficiency.js";
const baseline = "b7317374fca396ec1f4959d1f250c876416cd49a";
const handoff = JSON.parse(readFileSync("examples/game-visual-analyzer/handoff.json", "utf8"));
const bytes = value => Buffer.byteLength(value, "utf8");
const normalized = value => value.replace(/\r\n/g, "\n");
const events = Array.from({length:200},(_,i)=>({sequence:i+1,type:"process.heartbeat",payload:{iteration:1,pid:42,evidence:"synthetic-fixture"}}));
const metrics = {
  baseline, units:"UTF-8 bytes; not billed tokens or end-to-end latency", node:process.version,
  executorHandoff:{before:bytes(JSON.stringify(handoff,null,2)),after:bytes(JSON.stringify(handoff)),lossless:JSON.stringify(JSON.parse(JSON.stringify(handoff)))===JSON.stringify(handoff)},
  logPage:{historyEvents:200,returnedEvents:20,before:bytes(JSON.stringify(events)),after:bytes(JSON.stringify(selectEventPage(events,{after:180,limit:20})))},
  skills:Object.fromEntries(["qing-agent-orchestrator","qing-agent-orchestrator-full"].map(name=>{
    const path=".agents/skills/"+name+"/SKILL.md";
    return [name,{before:bytes(normalized(execFileSync("git",["show",baseline+":"+path],{encoding:"utf8"}))),after:bytes(normalized(readFileSync(path,"utf8")))}];
  })),
  limits:["No connected model calls or billed-token measurement","Log paging does not optimize disk scanning","Conditional reference loading is an instruction policy, not an enforced host token cap"]
};
writeFileSync("docs/context-efficiency-measurements.json",JSON.stringify(metrics,null,2)+"\n");
console.log(JSON.stringify(metrics,null,2));
