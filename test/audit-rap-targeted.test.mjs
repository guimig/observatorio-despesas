import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMovement} from '../src/item-movements.mjs';
import {planTargetedRap,auditTargetHistory,auditTargetImpact,summarizeTargetAudits} from '../src/audit-rap-targeted.mjs';
const ne='158459264222024NE000001',ne2='158459264222024NE000002',
 ob='158459264222025OB000001',ns='158459264222025NS000001';
const raw={data:'11/01/2025',operacao:'INSCRICAO EM RP',quantidade:'1',valorUnitario:'100,00',valorTotal:'100,00'};
const event=normalizeMovement(raw);
const sample={id:ne,seq:1,cohort:'duplicate',stored:[event,event]};
test('sondagem RAP seleciona repetidos e controle, impactos de exercício posterior e proprietários únicos',()=>{
 const m={documents:[{id:ne,phase:1},{id:ne2,phase:1},{id:ob,phase:3},{id:ns,phase:2}],
 itemsByDocument:{[ne]:[{seq:1,historyChecked:true,movements:[event,event]}],
 [ne2]:[{seq:1,historyChecked:true,movements:[event]}]},
 relations:[{from:ob,to:ne,cents:1000},{from:ns,to:ne2,cents:0}]};
 const p=planTargetedRap([m],{historyLimit:2,impactLimit:2});
 assert.equal(p.counts.selectedDuplicateHistories,1);assert.equal(p.histories.length,2);
 assert.equal(p.impacts.length,2);assert.equal(p.impacts[0].phase,2);
 assert.equal(p.impacts[1].cohort,'linked_duplicate');
 assert.equal(planTargetedRap([m,m]).histories.length,0);
});
test('sondagem RAP distingue linhas brutas idênticas de linhas com identidade adicional',async()=>{
 const a=await auditTargetHistory(sample,{token:'fake',request:async u=>
  new URL(u).searchParams.get('pagina')==='1'?[raw,{...raw}]:[]});
 assert.equal(a.historyComparison,'same_multiset');assert.equal(a.rawIdenticalGroups,1);
 const b=await auditTargetHistory(sample,{token:'fake',request:async u=>
  new URL(u).searchParams.get('pagina')==='1'?[{...raw,idMovimentacao:1},{...raw,idMovimentacao:2}]:[]});
 assert.equal(b.rawDifferentGroups,1);assert.equal(b.extraIdentityFieldGroups,1);
 assert.equal(JSON.stringify(b).includes(ne),false);
});
test('sondagem RAP distingue multiplicidade alterada e paginação repetida sem concluir histórico',async()=>{
 const a=await auditTargetHistory(sample,{token:'fake',request:async u=>
  new URL(u).searchParams.get('pagina')==='1'?[raw]:[]});
 assert.equal(a.historyComparison,'changed_multiplicity');assert.equal(a.freshInscription.repeated,0);
 const b=await auditTargetHistory(sample,{token:'fake',request:async()=>[raw]});
 assert.deepEqual(b,{cohort:'duplicate',status:'unavailable',reason:'pagina_repetida'});
});
test('sondagem RAP compara pares interanuais e preserva diferença de zero e campo ausente',async()=>{
 const a=await auditTargetImpact({id:ob,phase:3,cohort:'linked_duplicate',links:[{to:ne,cents:10000}]},
  {token:'fake',request:async(_,p)=>p===1?[{empenho:ne,valorPago:'0,00',valorRestoPago:'100,00',valorRestoCancelado:'0,00'}]:[]});
 assert.equal(a.legacyMatches,1);assert.equal(a.fields.rpPaidCents.positive,1);
 assert.equal(a.fields.rpCancelledCents.zero,1);assert.equal(a.fields.rpInscribedCents.unavailable,1);
 assert.equal(JSON.stringify(a).includes(ne),false);
 const report=summarizeTargetAudits([], [a]);
 assert.equal(report.impacts.fields.rpPaidCents.positive,1);
 assert.equal(report.impacts.byPhase[3].fields.rpInscribedCents.unavailable,1);
});
test('sondagem RAP não converte falha de fonte em campos zerados',async()=>{
 const a=await auditTargetImpact({id:ns,phase:2,cohort:'linked_inscription',links:[{to:ne,cents:0}]},
  {token:'fake',request:async()=>{throw Error('CGU HTTP 429');}});
 assert.equal(a.status,'unavailable');assert.equal(a.fields,undefined);
 const r=summarizeTargetAudits([], [a]);assert.equal(r.impacts.unavailable,1);assert.equal(r.impacts.completed,0);
});

test('rodízio de inscrições repetidas abrange itens fora da primeira amostra e reserva origem 2025',()=>{
 const ids=Array.from({length:18},(_,i)=>'158459264222024NE'+String(i+1).padStart(6,'0'));
 const old='158459264222025NE000010';
 const m={documents:[...ids.map(id=>({id,phase:1})),{id:old,phase:1}],relations:[],
 itemsByDocument:Object.fromEntries([...ids.map(id=>[id,[{seq:1,historyChecked:true,movements:[event,event]}]]),
 [old,[{seq:1,historyChecked:true,movements:[]}]]])};
 const first=planTargetedRap([m],{historyLimit:10,window:0});
 const second=planTargetedRap([m],{historyLimit:10,window:1});
 assert.equal(first.counts.selectedSearch2025,1);
 assert.equal(second.counts.selectedSearch2025,1);
 assert.equal(first.histories.length,10);
 assert.equal(new Set([...first.histories,...second.histories].filter(x=>x.cohort==='duplicate').map(x=>x.id)).size,18);
});
