import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistWindow,validatePublishedData,mergeMonth} from '../src/store.mjs';
import {planIncrementalPatches,runIncremental} from '../src/collect-cgu.mjs';
import {overdueStatus} from '../src/watchdog-agenda.mjs';
import {planAdaptiveBackfill} from '../src/backfill-adaptive.mjs';

const ne='158459000012026NE000001',ns='158459000012026NS000002';
const now=new Date('2026-11-27T15:00:00Z');
const patch=(date,phase,id,cents=100)=>({documents:id?[{date,phase,id,cents}]:[],links:[],
 coverage:{date,phase,complete:true,count:id?1:0,invalid:cents===null&&id?1:0}});
const silent={log(){},warn(){}};
test('incremental preserva documento de data conflitante e incorpora fases independentes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'incremental-'));
 try{
  await persistWindow(root,[patch('2026-11-25',1,ne)],now);
  const result=await runIncremental({root,now,token:'fake',logger:silent,
    collect:async()=>[patch('2026-11-27',1,ne),patch('2026-11-27',2,ns)]});
  assert.equal(result.status,'partial');assert.equal(result.mergeConflicts,1);assert.equal(result.accepted,1);
  const {months}=await validatePublishedData(root);
  assert.equal(months[0].documents.find(d=>d.id===ne).date,'2026-11-25');
  assert.equal(months[0].documents.find(d=>d.id===ns).date,'2026-11-27');
  assert.ok(!months[0].coverage.some(c=>c.date==='2026-11-27'&&c.phase===1));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('simulacao usa acervo existente e nao altera bytes; lote normal e idempotente',async()=>{
 const root=await mkdtemp(join(tmpdir(),'incremental-'));
 try{
  const p=patch('2026-11-25',1,ne);
  await persistWindow(root,[p],now);
  const path=join(root,'data','months','2026-11.json'),before=await readFile(path,'utf8');
  const opts={root,now,token:'fake',logger:silent,collect:async()=>[patch('2026-11-27',1,ne),patch('2026-11-27',2,ns)]};
  const dry=await runIncremental({...opts,dryRun:true});
  assert.equal(dry.mergeConflicts,1);assert.equal(await readFile(path,'utf8'),before);
  const normal=await runIncremental({...opts,collect:async()=>[p]});
  assert.equal(normal.status,'complete');assert.deepEqual(normal.updatedMonths,[]);
  assert.equal(await readFile(path,'utf8'),before);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('nenhuma fase valida falha; excecao inesperada nao e suprimida',async()=>{
 const root=await mkdtemp(join(tmpdir(),'incremental-'));
 try{
  const p=patch('2026-11-25',1,ne);await persistWindow(root,[p],now);
  await assert.rejects(runIncremental({root,now,token:'fake',logger:silent,
    collect:async()=>[patch('2026-11-27',1,ne)]}),{code:'CGU_NO_VALID_PHASE'});
  assert.throws(()=>planIncrementalPatches([], [{coverage:{date:'2026-11-27',phase:1}}],now));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('falha da fonte e valor invalido tornam resultado parcial sem vazar mensagem externa',async()=>{
 const root=await mkdtemp(join(tmpdir(),'incremental-')),logs=[];
 try{
  const result=await runIncremental({root,now,token:'fake',logger:{log:s=>logs.push(s),warn:s=>logs.push(s)},
   collect:async({onPhaseFailure})=>{onPhaseFailure({date:'2026-11-27',phase:1,failure:'secret_payload'});return [patch('2026-11-27',2,ns,null)]}});
  assert.equal(result.status,'partial');assert.equal(result.sourceFailures,1);assert.equal(result.invalid,1);
  assert.ok(!logs.join(' ').includes('secret_payload'));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('monitor distingue tentativa recente do ultimo sucesso e respeita cooldown',()=>{
 const history=[{status:'completed',conclusion:'failure',created_at:'2026-11-27T12:00:00Z'},
 {status:'completed',conclusion:'success',created_at:'2026-11-26T22:00:00Z'}];
 const result=overdueStatus(history,8,now,{retryHours:2});
 assert.equal(result.reason,'retry_failed');assert.equal(result.ageHours,3);
 assert.equal(result.lastSuccessAgeHours,17);assert.equal(result.staleSuccess,true);
 assert.equal(overdueStatus(history,8,new Date('2026-11-27T13:00:00Z'),{retryHours:2}).eligible,false);
});
test('backfill reserva datas do mes atual sem exceder limites e sem consultar hoje',async()=>{
 const plan=await planAdaptiveBackfill({now,slot:1,maxDays:6,prioritizeCurrent:true});
 assert.equal(plan.tasks.length,6);
 assert.ok(plan.tasks.slice(0,3).every(t=>t.month==='2026-11'&&Number(t.date.slice(0,2))<27));
 assert.ok(plan.tasks.slice(3).some(t=>t.month!=='2026-11'));
});
