import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCsvPlan,auditCsvTargets} from '../src/audit-rap-csv-targets.mjs';
const ne='158459264222025NE000001',ob='158459264222026OB000001';
const event={date:'2026-01-10',operation:'inscricao em rp',quantity:'1.00',unitPrice:'100.000',cents:10000,count:2};
const components={paidCents:0,liquidatedCents:null,rpInscribedCents:0,rpCancelledCents:null,rpPaidCents:10000};
const fixture=()=>({version:1,histories:[{id:ne,seq:1,events:[{...event}]}],impacts:[{id:ob,ne,phase:3,components:{...components}}]});
test('confronto preserva multiplicidade, normaliza somente decimais e distingue campo ausente',async()=>{
 const fresh={...event,operation:'INSCRIÇÃO EM RP',quantity:'1',unitPrice:'100'};
 const result=await auditCsvTargets(fixture(),{
  historyResolver:async()=>({ok:true,movements:[fresh,fresh]}),
  paymentResolver:async()=>({ok:true,links:[{from:ob,to:ne,cents:10000,impactComponents:{...components,rpCancelledCents:0,repeatedRows:0}}]})
 });
 assert.equal(result.history.sameMultiset,1);assert.equal(result.history.origin2025Confirmed,1);
 assert.equal(result.impacts.allComparableFieldsEqual,1);assert.equal(result.impacts.fields.rpPaidCents.equal,1);
 assert.equal(result.impacts.fields.rpCancelledCents.equal,0);assert.ok(!JSON.stringify(result).includes(ne));
});
test('multiplicidade e divergência não são transformadas em saldo; resposta vazia não é zero',async()=>{
 const r=await auditCsvTargets(fixture(),{historyResolver:async()=>({ok:true,movements:[event]}),
  paymentResolver:async()=>({ok:true,links:[]})});
 assert.equal(r.history.differentMultiplicity,1);assert.equal(r.history.csvOnlyOccurrences,1);
 assert.equal(r.impacts.missingPairs,1);assert.equal(r.impacts.fields.rpPaidCents.equal,0);
});
test('rejeita chaves, limite, identidade fora do recorte e pares duplicados antes de consultar',()=>{
 for(const mutate of [p=>p.histories[0].id='158459264222023NE000001',
  p=>p.impacts.push({...p.impacts[0]}),p=>p.histories[0].events[0].count=101,
  p=>p.impacts[0].components.rpPaidCents='10000',p=>p.histories[0].events[0].description='x']){
  const p=fixture();mutate(p);assert.throws(()=>validateCsvPlan(p));
 }
});
test('orçamento interrompe antes de consultar; campos divergentes ou ambíguos são explícitos',async()=>{
 const stopped=await auditCsvTargets(fixture(),{budget:{stopped:()=>true},
 historyResolver:async()=>{throw Error('não deve consultar');}});
 assert.equal(stopped.history.attempted,0);assert.equal(stopped.impacts.attemptedDocuments,0);
 const r=await auditCsvTargets(fixture(),{historyResolver:async()=>({ok:false}),
 paymentResolver:async()=>({ok:true,links:[{from:ob,to:ne,impactComponents:{...components,rpPaidCents:9999}}]})});
 assert.equal(r.history.unavailable,1);assert.equal(r.impacts.fields.rpPaidCents.different,1);
 assert.equal(r.impacts.allComparableFieldsEqual,0);
});
