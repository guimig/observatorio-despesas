import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCommitmentChronology,indexCommitmentChronology} from '../assets/siafi-movement-reconciliation.js';
import {classifyChronologyWork,planChronologyEnrichment,chronologyAttemptKey,requiresCanonicalHistoryCheckpoint,promoteCatalogHistories} from '../src/chronology-enrichment.mjs';
const now=new Date('2026-11-27T17:00:00Z'),today='2026-11-27';
const id=(n,year=2026)=>'15845900001'+year+'NE'+String(n).padStart(6,'0');
const doc=(n,extra={})=>({id:id(n),date:'2026-11-10',phase:1,cents:100,itemsDetailVersion:2,...extra});
const pending=(seq,cents)=>({seq,cents});
const checked=(seq,cents)=>({seq,cents,historyChecked:true,historyCheckedAt:'2026-11-26',
 movements:[{type:'original',date:'2026-11-10',cents}]});
function month(rows,observations=[]){
 return {month:'2026-11',documents:rows.map(r=>r.doc),itemsByDocument:Object.fromEntries(rows.filter(r=>r.items!==undefined).map(r=>[r.doc.id,r.items])),commitmentObservations:observations};
}
const record=(rows,obs=[])=>indexCommitmentChronology([month(rows,obs)]).entries[0];
const task=(n,seq=1)=>({kind:'itemHistory',month:'2026-11',id:id(n),seq,recheck:false});
test('motivos de pendencia exclusivos e totais por exercicio nao revelam identidades',()=>{
 const a=month([{doc:doc(1),items:[checked(1,100)]},{doc:doc(2),items:[pending(1,100)]},
  {doc:doc(3,{itemsDetailVersion:undefined})},{doc:doc(4,{cents:null})},{doc:doc(5),items:[]}]);
 const r=buildCommitmentChronology([a],{today});
 assert.equal(r.identities,5);assert.equal(r.reconciled,1);assert.equal(r.pending,4);
 assert.deepEqual(r.pendingReasons,{histories_pending:1,items_not_collected:1,reference_amount_pending:1,empty_item_catalog:1});
 assert.deepEqual(r.byYear,[{year:'2026',identities:5,reconciled:1,pending:4}]);
 assert.ok(!JSON.stringify(r).includes(id(1)));
});
test('planeja grupos completos pequenos, preserva liquidações e pagamentos, respeita cotas',()=>{
 const a=month([{doc:doc(1),items:[pending(1,50),pending(2,50)]},{doc:doc(2),items:[checked(1,50),pending(2,50)]},
 {doc:doc(3),items:[pending(1,20),pending(2,20),pending(3,20),pending(4,20),pending(5,20)]}]);
 const ns={kind:'liquidation',id:'ns'},ob={kind:'payment',id:'ob'};
 const base=[ns,ob,task(3),task(3,2),task(3,3),task(3,4),task(3,5)];
 const {tasks,summary}=planChronologyEnrichment(base,[a],{now,maxItemHistories:5});
 assert.equal(summary.groupsSelected,2);assert.equal(summary.groupTasks,3);
 assert.deepEqual(tasks.filter(t=>t.chronologyPriority==='finish_group').map(t=>[t.id,t.seq]),[[id(2),2],[id(1),1],[id(1),2]]);
 assert.equal(tasks.filter(t=>t.kind==='itemHistory').length,5);
 assert.ok(tasks.includes(ns)&&tasks.includes(ob));
 assert.equal(new Set(tasks.map(t=>[t.kind,t.id,t.seq].join('/'))).size,tasks.length);
});
test('NE com reaparição exige data de checkpoint e revisita historico mesmo com valor igual',()=>{
 const d=doc(1),obs=[{id:d.id,ownerDate:d.date,date:'2026-11-26',cents:100}];
 const i={...checked(1,100),historyCheckedAt:'2026-11-25'};
 const r=record([{doc:d,items:[i]}],obs);
 assert.equal(requiresCanonicalHistoryCheckpoint(r,i),true);
 const work=classifyChronologyWork(r,{now});
 assert.equal(work.kind,'history');assert.equal(work.tasks[0].recheck,true);
 assert.equal(requiresCanonicalHistoryCheckpoint(r,{...i,historyCheckedAt:today}),false);
});
test('catalogo divergente revisado sem repetir consulta sem mudança por sete dias',()=>{
 const r=record([{doc:doc(1),items:[pending(1,80)]}]);
 const w=classifyChronologyWork(r,{now});
 assert.equal(w.kind,'catalog');assert.equal(w.recheck,true);
 const k=chronologyAttemptKey(r,w.task),state={[k]:'2026-11-26'};
 assert.equal(classifyChronologyWork(r,{state,now}).kind,'cooldown');
 assert.equal(classifyChronologyWork(r,{state,now:new Date('2026-12-04T17:00:00Z')}).kind,'catalog');
 const fresh=record([{doc:doc(1,{cents:120}),items:[pending(1,80)]}]);
 assert.equal(classifyChronologyWork(fresh,{state,now}).kind,'catalog');
 assert.ok(/^[a-f0-9]{64}$/.test(k));
});
test('historico nao conciliavel tem revisao separada, sem alterar regra financeira',()=>{
 const r=record([{doc:doc(1),items:[{...checked(1,100),movements:[{type:'other',date:'2026-11-10',cents:100}]}]}]);
 const w=classifyChronologyWork(r,{now});assert.equal(w.kind,'repair');
 assert.equal(classifyChronologyWork(r,{now,state:{[chronologyAttemptKey(r,w.tasks[0])]:today}}).kind,'cooldown');
 assert.equal(buildCommitmentChronology([month([{doc:r.owners[0].doc,items:r.owners[0].items}])],{today}).reconciled,0);
});
test('apos catalogo pequeno antecipa grupo sem ampliar fila nem desalocar fases ou grupos reservados',()=>{
 const r=record([{doc:doc(1),items:[pending(1,50),pending(2,50)]}]);
 const cat={kind:'items',id:id(1)},ns={kind:'liquidation',id:'ns'},group={...task(2),chronologyPriority:'finish_group'};
 const tasks=[cat,ns,group,task(3),task(4)];
 assert.equal(promoteCatalogHistories(tasks,0,r,{now}),2);
 assert.equal(tasks.length,5);assert.deepEqual(tasks.slice(1,3).map(t=>[t.id,t.seq]),[[id(1),1],[id(1),2]]);
 assert.ok(tasks.includes(ns)&&tasks.includes(group));
 const limited=[cat,ns,group,task(3)];assert.equal(promoteCatalogHistories(limited,0,r,{now}),0);assert.equal(limited.length,4);
});
test('identidade duplicada nao vira prioridade nem entra em subtotal',()=>{
 const a=month([{doc:doc(1),items:[pending(1,100)]}]);
 const {tasks}=planChronologyEnrichment([task(1)],[a,a],{now});
 assert.equal(tasks.length,0);
 const r=buildCommitmentChronology([a,a],{today});
 assert.equal(r.pendingReasons.duplicate_identity,1);
});

test('NE anterior ao recorte permanece referenciada mas não entra na fila ou denominador',()=>{
 const oldId=id(1,2023);
 const a=month([{doc:{...doc(1),id:oldId},items:[pending(1,100)]},{doc:doc(2),items:[pending(1,100)]}]);
 const r=buildCommitmentChronology([a],{today});
 assert.equal(r.identities,1);assert.equal(r.pending,1);assert.equal(r.beforeCutoffIdentities,1);
 const {tasks}=planChronologyEnrichment([{kind:'items',id:oldId,month:'2026-11'},task(2)],[a],{now});
 assert.ok(!tasks.some(t=>t.id===oldId));assert.equal(tasks.filter(t=>t.id===id(2)).length,1);
});
test('soma divergente de itens é motivo próprio antes mesmo de recuperar históricos',()=>{
 const a=month([{doc:doc(1),items:[pending(1,80)]}]);
 const r=buildCommitmentChronology([a],{today});
 assert.deepEqual(r.pendingReasons,{catalog_amount_mismatch:1});
});
