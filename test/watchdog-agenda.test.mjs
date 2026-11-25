import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overdueStatus,monitorAgenda,WATCHED} from '../src/watchdog-agenda.mjs';
const now=new Date('2026-11-25T12:00:00Z');
test('run ativo ou tentativa recente, mesmo falha, nao gera duplicata',()=>{
 assert.equal(overdueStatus([{status:'queued',created_at:'2026-11-24T00:00:00Z'}],6,now).reason,'active');
 assert.equal(overdueStatus([{status:'completed',conclusion:'failure',created_at:'2026-11-25T09:00:00Z'}],6,now).eligible,false);
 assert.equal(overdueStatus([{status:'completed',created_at:'2026-11-25T05:00:00Z'}],6,now).eligible,true);
 assert.equal(overdueStatus([],6,now).reason,'never_run');
 assert.throws(()=>overdueStatus([{status:'completed',created_at:'bad'}],6,now));
});
test('watchdog consulta apenas allowlist, limita tres disparos e dry run nao dispara',async()=>{
 const posts=[];const fetcher=async(url,opts)=>{
  assert.ok(url.startsWith('https://api.github.com/repos/guimig/observatorio-despesas/actions/workflows/'));
  if(opts.method==='POST'){posts.push({url,body:JSON.parse(opts.body)});return {status:204}}
  return {ok:true,json:async()=>({workflow_runs:[]})};
 };
 const r=await monitorAgenda({token:'test',now,fetcher});
 assert.equal(r.checked,WATCHED.length);assert.equal(r.dispatched,3);assert.equal(posts.length,3);
 assert.equal(posts[1].body.inputs.intensive,'true');
 posts.length=0;const d=await monitorAgenda({token:'test',now,fetcher,dryRun:true});
 assert.equal(d.dispatched,0);assert.equal(posts.length,0);
});
test('metadados inacessiveis falham fechado',async()=>{
 let posts=0;
 const r=await monitorAgenda({token:'test',now,fetcher:async(_u,o)=>{if(o.method==='POST')posts++;return {ok:false,status:403}}});
 assert.equal(r.failed,WATCHED.length);assert.equal(posts,0);
});
