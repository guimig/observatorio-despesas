import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCommitmentChronology,indexCommitmentChronology} from '../assets/siafi-movement-reconciliation.js';
import {classifyChronologyWork,planChronologyEnrichment,chronologyAttemptKey,requiresCanonicalHistoryCheckpoint,promoteCatalogHistories,summarizeCatalogDivergences,summarizeCatalogBacklog,needsInitialCatalog,orderMissingCatalogs,catalogPaginationKey,catalogPageLimit} from '../src/chronology-enrichment.mjs';
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

test('reserva contratual seleciona grupo integral sem prejudicar demais fases',()=>{
 const a=month([{doc:doc(1),items:[pending(1,100)]},{doc:doc(2),items:[pending(1,100)]},{doc:doc(3),items:[pending(1,100)]}]);
 const base=[{kind:'payment',id:'ob'},task(1),task(2),task(3)];
 const {tasks,summary}=planChronologyEnrichment(base,[a],{now,slot:0,maxItemHistories:3,cguContracts:[{refs:[id(3)]}]});
 assert.equal(tasks.find(t=>t.kind==='itemHistory').id,id(3));
 assert.equal(summary.contractHistoryTasks,1);
 assert.equal(tasks.filter(t=>t.kind==='itemHistory').length,3);
 assert.equal(tasks.filter(t=>t.kind==='payment').length,1);
});
test('catalogos com cooldown nao desperdicam vagas quando outras NEs aguardam itens',()=>{
 const a=month([1,2,3,4].map(n=>({doc:doc(n,{itemsDetailVersion:undefined})})));
 const records=indexCommitmentChronology([a]).entries;
 const base=[1,2,3].map(n=>({kind:'items',id:id(n),month:'2026-11'}));
 const state=Object.fromEntries(records.filter(r=>r.id===id(1)||r.id===id(2)).map(r=>[chronologyAttemptKey(r,classifyChronologyWork(r,{now}).task),today]));
 const {tasks}=planChronologyEnrichment(base,[a],{now,slot:0,maxItems:3,state});
 assert.deepEqual(tasks.filter(t=>t.kind==='items').map(t=>t.id).sort(),[id(3),id(4)]);
});
test('catalogo com quatro itens pode completar grupo no mesmo lote sem aumentar chamadas planejadas',()=>{
 const r=record([{doc:doc(1),items:[pending(1,25),pending(2,25),pending(3,25),pending(4,25)]}]);
 const cat={kind:'items',id:id(1)},ns={kind:'liquidation',id:'ns'};
 const tasks=[cat,ns,task(2),task(3),task(4),task(5)];
 assert.equal(promoteCatalogHistories(tasks,0,r,{now}),4);
 assert.equal(tasks.length,6);assert.ok(tasks.includes(ns));
});

test('diagnostico de catalogos distingue observacao anterior sem promover conciliacao',()=>{
 const a=month([{doc:doc(1),items:[checked(1,100)]},{doc:doc(2),items:[pending(1,80)]},{doc:doc(3),items:[pending(1,120)]},{doc:doc(4),items:[checked(1,100)]}],
  [{id:id(1),ownerDate:'2026-11-10',date:'2026-11-21',cents:110},{id:id(3),ownerDate:'2026-11-10',date:'2026-11-21',cents:110}]);
 const result=summarizeCatalogDivergences([a],[{refs:[id(1)]}]);
 assert.equal(result.total,3);assert.equal(result.contractual,1);
 assert.deepEqual(result.reasons,{matches_earlier_listing:1,single_listing_mismatch:1,different_from_all_observations:1});
 assert.deepEqual(result.history,{complete:1,partial:0,none:2});
 assert.deepEqual(result.direction,{above:1,below:2});
 assert.equal(buildCommitmentChronology([a],{today}).reconciled,1);
 assert.ok(!JSON.stringify(result).includes(id(1)));
});

test('passivo distingue catalogo ausente ou legado, consulta vazia v2 e identidade duplicada',()=>{
 const a=month([{doc:doc(1,{itemsDetailVersion:undefined})},{doc:doc(2,{itemsDetailVersion:1}),items:[pending(1,100)]},
  {doc:doc(3),items:[]},{doc:doc(4),items:[pending(1,100)]},{doc:doc(5)}]);
 const b=month([{doc:doc(5)}]);
 const result=summarizeCatalogBacklog([a,b]);
 assert.equal(result.identities,5);assert.equal(result.missing,2);assert.equal(result.empty,1);
 assert.equal(result.available,1);assert.equal(result.duplicate,1);
 assert.deepEqual(result.byYear['2026'],{missing:2,empty:1,available:1,duplicate:1});
 assert.ok(!JSON.stringify(result).includes(id(1)));
});
test('planejamento ocupa as vagas de catalogos com NEs novas e limita revisoes',()=>{
 const rows=[...Array.from({length:12},(_,i)=>({doc:doc(i+1,{itemsDetailVersion:undefined})})),
  ...Array.from({length:5},(_,i)=>({doc:doc(i+20),items:[pending(1,80)]}))];
 const a=month(rows),ns={kind:'liquidation',id:'ns'},ob={kind:'payment',id:'ob'};
 const base=[ns,ob,...[20,21,22].map(n=>({kind:'items',id:id(n),month:a.month,recheck:true}))];
 const {tasks,summary}=planChronologyEnrichment(base,[a],{now,maxItems:10,review:true});
 assert.equal(tasks.filter(t=>t.initialCatalog).length,10);
 assert.equal(tasks.filter(t=>t.kind==='items'&&!t.initialCatalog).length,2);
 assert.equal(tasks[0].initialCatalog,true);assert.equal(tasks[1].initialCatalog,true);
 assert.ok(tasks.includes(ns)&&tasks.includes(ob));
 assert.equal(summary.initialCatalogEligible,12);assert.equal(summary.initialCatalogSelected,10);
 assert.equal(summary.initialCatalogByYear['2026'],10);
 assert.ok(tasks.findIndex(t=>t===ns)<5);assert.ok(tasks.findIndex(t=>t===ob)<5);
});
test('distribuicao por exercicio reserva cobertura minima e considera volume do passivo',()=>{
 const rows=[...Array.from({length:60},(_,i)=>({id:id(i+1,2024),year:'2024',lastAttempt:''})),
 ...Array.from({length:20},(_,i)=>({id:id(i+1,2025),year:'2025',lastAttempt:''})),
 ...Array.from({length:5},(_,i)=>({id:id(i+1,2026),year:'2026',lastAttempt:''}))];
 const selected=orderMissingCatalogs(rows,{limit:12,slot:0});
 const count=y=>selected.filter(r=>r.year===y).length;
 assert.equal(selected.length,12);assert.ok(count('2024')>count('2025'));
 assert.ok(count('2025')>=count('2026'));assert.ok(count('2026')>=1);
 assert.equal(new Set(selected.map(r=>r.id)).size,12);
 const priority=orderMissingCatalogs(rows,{limit:12,slot:0,contractual:code=>code===id(5,2026)});
 assert.ok(priority.some(r=>r.id===id(5,2026)));
 const small=orderMissingCatalogs(rows,{limit:1,slot:1});
 assert.equal(small[0].year,'2025');
});
test('catalogo independe do valor documental e preserva sequenciais legados em reconsulta',()=>{
 const r=record([{doc:doc(1,{cents:null,itemsDetailVersion:undefined})}]);
 assert.equal(needsInitialCatalog(r),true);assert.equal(classifyChronologyWork(r,{now}).missingCatalog,true);
 const old=record([{doc:doc(1,{itemsDetailVersion:1}),items:[pending(1,80)]}]);
 const w=classifyChronologyWork(old,{now});
 assert.equal(w.missingCatalog,true);assert.equal(w.task.recheck,true);
 const state={[chronologyAttemptKey(old,w.task)]:today};
 assert.equal(classifyChronologyWork(old,{now,state}).kind,'cooldown');
 assert.equal(classifyChronologyWork(old,{now:new Date('2026-11-28T17:00:00Z'),state}).kind,'catalog');
});
test('amplia limite de paginas apenas apos falha de paginacao e somente com evidencia vigente',()=>{
 const r=record([{doc:doc(1,{itemsDetailVersion:undefined})}]);
 assert.equal(catalogPageLimit(r,{},now),8);
 const key=catalogPaginationKey(r),state={[key]:today};
 assert.equal(catalogPageLimit(r,state,now),20);
 assert.equal(catalogPageLimit(r,{[key]:'2026-11-28'},now),8);
 assert.equal(catalogPageLimit(r,state,new Date('2026-12-28T17:00:00Z')),8);
 const other=record([{doc:doc(1,{itemsDetailVersion:undefined,cents:101})}]);
 assert.equal(catalogPageLimit(other,state,now),8);
 const complete=record([{doc:doc(1),items:[pending(1,100)]}]);
 assert.equal(catalogPaginationKey(complete),null);assert.equal(catalogPageLimit(complete,state,now),8);
});
