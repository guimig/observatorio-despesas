import test from 'node:test';
import assert from 'node:assert/strict';
import {prioritizeRapComponentRecovery,consistentRapRecovery,impactAttemptKey,detailKey} from '../src/enrich-month.mjs';
import {summarizeRapEvidence} from '../src/rap-evidence.mjs';
const now=new Date('2026-11-27T20:00:00Z');
const ne24='158459264222024NE000001',ne25='158459264222025NE000001';
const id=n=>'158459264222026OB'+String(n).padStart(6,'0');
function fixture(){
 const docs=Array.from({length:25},(_,i)=>({id:id(i+1),phase:3,cents:100,paymentLinksChecked:true}));
 const relations=docs.slice(0,15).map((d,i)=>({from:d.id,to:i===14?ne25:ne24,cents:100}));
 const month={month:'2026-11',unit:'158459',documents:docs,relations};
 const base=docs.slice(15,25).map(d=>({id:d.id,month:month.month,kind:'payment'}));
 return {month,base};
}
test('recuperação RAP ocupa reserva existente, mantém prioridade protegida e inclui origem 2025',()=>{
 const {month,base}=fixture();
 const p=prioritizeRapComponentRecovery(base,[month],{now,protectedIds:[id(16)]});
 assert.equal(p.tasks.length,base.length);assert.equal(p.summary.selectedDocuments,1);
 assert.ok(p.tasks.some(x=>x.id===id(16)));
 const q=prioritizeRapComponentRecovery(base,[month],{now});
 assert.equal(q.summary.selectedDocuments,2);assert.equal(q.summary.selectedOrigin2025,1);
 assert.equal(new Set(q.tasks.map(x=>x.id)).size,base.length);
 assert.equal(q.tasks.filter(x=>x.rapRecovery).length,2);
});
test('reserva RAP respeita cooldown de tentativas e não reconsulta identidade ambígua',()=>{
 const {month,base}=fixture();
 const state={[impactAttemptKey(month,id(1),'payment')]:'2026-11-27'};
 const p=prioritizeRapComponentRecovery(base,[month],{now,state});
 assert.ok(!p.tasks.some(x=>x.id===id(1)));
 assert.equal(prioritizeRapComponentRecovery(base,[month,month],{now}).summary.selectedDocuments,0);
 assert.equal(prioritizeRapComponentRecovery([], [month], {now}).tasks.length,0);
});
test('revisão parcial com checkpoint recente não monopoliza a recuperação',()=>{
 const {month,base}=fixture();
 const partial={rowCount:1,repeatedRows:0,liquidatedCents:null,paidCents:0,rpPaidCents:100,rpInscribedCents:null,rpCancelledCents:null};
 month.relations=month.relations.map(r=>({...r,impactComponents:partial}));
 const state=Object.fromEntries(month.relations.map(r=>[detailKey(month,r.from,'payment'),'2026-11-26']));
 assert.equal(prioritizeRapComponentRecovery(base,[month],{now,state}).summary.selectedDocuments,0);
 const report=summarizeRapEvidence([month]);
 assert.equal(report.priorYearPairsWithoutComponents,0);assert.equal(report.priorYearPairsPartialComponents,15);
 assert.equal(report.priorYearByOrigin['2025'].partialComponents,1);
});
test('recuperação de componentes não aceita suprimir relação ou retificar valor legado',()=>{
 const previous=[{from:id(1),to:ne24,cents:100}];
 assert.equal(consistentRapRecovery(previous,[{...previous[0],impactComponents:{}}]),true);
 assert.equal(consistentRapRecovery(previous,[{...previous[0],cents:101}]),false);
 assert.equal(consistentRapRecovery(previous,[]),false);
});


test('prioridade documental usa reserva existente, mantém exploração e origem 2025',()=>{
 const {month,base}=fixture(),ne='158459264222024NE000010';
 const origin={month:'2024-12',unit:'158459',documents:[{id:ne,phase:1,date:'2024-12-18',itemsDetailVersion:2}],relations:[],
  itemsByDocument:{[ne]:[{seq:1,historyChecked:true,movements:[{operation:'INSCRICAO EM RP',date:'2025-01-11',cents:100,type:'other'}]}]}};
 const source=month.documents.find(d=>d.id===id(12));source.date='2026-11-10';
 month.relations.find(r=>r.from===id(12)).to=ne;
 const p=prioritizeRapComponentRecovery(base,[origin,month],{now});
 assert.equal(p.summary.selectedDocuments,2);
 assert.equal(p.summary.selectedOrigin2025,1);
 assert.equal(p.summary.selectedWithExplicitEvidence,1);
 assert.equal(p.summary.selectedPotentialLastImpactGap,1);
 assert.ok(p.tasks.some(x=>x.id===id(12)&&x.rapRecovery));
 assert.equal(p.summary.readiness.accountingReady,0);
 assert.equal(p.tasks.length,base.length);
 assert.equal(new Set(p.tasks.map(x=>x.id)).size,base.length);
 assert.ok(!JSON.stringify(p.summary).includes(ne));
});
test('uma vaga alterna prioridade documental e rodízio, sem reconsulta de proteção ou cooldown',()=>{
 const {month,base}=fixture(),ne='158459264222024NE000011';
 const origin={month:'2024-12',unit:'158459',documents:[{id:ne,phase:1,itemsDetailVersion:2}],relations:[],
  itemsByDocument:{[ne]:[{seq:1,historyChecked:true,movements:[{operation:'INSCRICAO EM RP',date:'2025-01-11',cents:100}]}]}};
 month.relations.find(r=>r.from===id(12)).to=ne;
 const queue=base.slice(0,5);
 const even=prioritizeRapComponentRecovery(queue,[origin,month],{now,slot:0});
 assert.ok(even.tasks.some(t=>t.id===id(12)));
 const odd=prioritizeRapComponentRecovery(queue,[origin,month],{now,slot:1});
 assert.ok(!odd.tasks.some(t=>t.id===id(12)));
 const blocked=prioritizeRapComponentRecovery(queue,[origin,month],{now,state:{[impactAttemptKey(month,id(12),'payment')]:'2026-11-27'}});
 assert.ok(!blocked.tasks.some(t=>t.id===id(12)));
 assert.equal(blocked.tasks.length,queue.length);
});
test('reconsulta dirigida preserva componentes conhecidos mesmo com centavos legados iguais',()=>{
 const c={rowCount:1,repeatedRows:0,liquidatedCents:0,paidCents:0,rpPaidCents:100,rpInscribedCents:null,rpCancelledCents:0};
 const old={from:id(1),to:ne24,cents:100,impactComponents:c};
 assert.equal(consistentRapRecovery([old],[{...old,impactComponents:{...c,rpInscribedCents:0}}]),true);
 assert.equal(consistentRapRecovery([old],[{...old,impactComponents:{...c,rpCancelledCents:null}}]),false);
 assert.equal(consistentRapRecovery([old],[{...old,impactComponents:{...c,paidCents:100,rpPaidCents:0}}]),false);
 assert.equal(consistentRapRecovery([old],[{from:old.from,to:old.to,cents:100}]),false);
});
