import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../dist/src/config.js";
import { ModelHealthChecker } from "../dist/src/model-health.js";
import { TaskModelScheduler } from "../dist/src/model-scheduler.js";
import { planModelCandidates } from "../dist/src/model-router.js";
const dir=await mkdtemp(join(tmpdir(),"qing-measure-scheduling-"));
const config=await loadConfig("config/relay.example.json");
const calls={before:[],after:[]};
const request={backend:"codex-cli",role:"executor",route:"codex",category:"code_change",complexityBand:"normal"};
try {
  for (const mode of ["before","after"]) {
    const runner={async run(r){
      calls[mode].push(r.args[0]);
      let stdout="codex-cli 9.9.9";
      if(r.args[0]==="debug")stdout=JSON.stringify({models:["luna","sol","astra"].map(n=>({slug:"gpt-6-"+n,supported_reasoning_levels:["low","medium","high"].map(effort=>({effort}))}))});
      if(r.args[0]==="exec") { await writeFile(r.args[r.args.indexOf("--output-last-message")+1],JSON.stringify({status:"ok",capabilities:["planner","executor","reviewer"]}));stdout='{"type":"turn.completed"}'; }
      return {exitCode:0,signal:null,stdout,stderr:"",timedOut:false,outputLimitExceeded:false,spawnError:null};
    }};
    const options={command:"fake",cwd:dir,schemaPath:join(dir,"schema"),cachePath:join(dir,mode+".json"),timeoutMs:1000,ttlMs:60000};
    const shared=new TaskModelScheduler(config.modelRouting.candidates,new ModelHealthChecker(options,runner));
    for(const role of ["planner","executor","reviewer"]) {
      const scheduler=mode==="after"?shared:new TaskModelScheduler(config.modelRouting.candidates,new ModelHealthChecker(options,runner));
      await scheduler.select({...request,role});
    }
  }
  const count=values=>({versionDiscoveries:values.filter(v=>v==="--version").length,catalogDiscoveries:values.filter(v=>v==="debug").length,modelProbes:values.filter(v=>v==="exec").length,totalProcessRequests:values.length});
  const matrix=[];
  for(const complexityBand of ["trivial","normal","complex","high-risk"]) for(const role of ["planner","executor","reviewer"]) {
    const plan=planModelCandidates(config.modelRouting.candidates,new Map(),{...request,complexityBand,role});
    matrix.push({complexityBand,role,model:plan.orderedCandidates[0].model,effort:plan.orderedCandidates[0].reasoningEffort,fallbacks:plan.orderedCandidates.slice(1).map(c=>c.model)});
  }
  const report={baseline:"d6bf2da3e172479b8f311f8bbabc72766ba60ff4",date:"2026-09-23",method:"Three role selections for the same pair; fake process runner, same persisted-cache semantics; separate checkers versus invocation-shared checker",before:count(calls.before),after:count(calls.after),matrix,limits:["Not a connected-model token, latency or price benchmark","No API billing assumptions applied to ChatGPT subscriptions","Reduced discovery does not mean fewer model probes when the old persistent cache already hits"]};
  await writeFile("docs/gpt6-scheduling-measurements.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
} finally {await rm(dir,{recursive:true,force:true});}
