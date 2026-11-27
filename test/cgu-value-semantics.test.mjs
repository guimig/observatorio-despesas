import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexCommitmentChronology} from '../assets/siafi-movement-reconciliation.js';
import {reconstructValueMeasures,classifyValueMeaning,summarizeStoredValueMeanings,readFreshListingValue,classifySourceAgreement}
 from '../src/cgu-value-semantics.mjs';
import {inspectDivergentRecord} from '../src/cgu-divergence-probe.mjs';

const now=new Date('2026-11-27T17:00:00Z'),today='2026-11-27';
const id=n=>'158459000012024NE'+String(n).padStart(6,'0');
const event=(date,type,cents)=>({date,type,cents});
const events=[event('2024-03-01','original',100),event('2024-06-01','reinforcement',70),
 event('2024-08-01','annulment',20),event('2025-03-01','reinforcement',30),
 event('2025-07-01','cancellation',40)];
const item={seq:1,cents:140,historyChecked:true,movements:events};
const doc=(n,cents=100)=>({id:id(n),date:'2024-03-01',phase:1,cents,itemsDetailVersion:2});
const month=(docs,items)=>({month:'2024-03',documents:docs,itemsByDocument:items});
const make=(cents=100,items=[item])=>indexCommitmentChronology([month([doc(1,cents)],{[id(1)]:items})]).entries[0];
const raw=(code=id(1),valor='1,50',extra={})=>({documento:code,codigoUg:'158459',fase:'Empenho',data:'2024-03-01',valor,...extra});

test('quatro medidas distintas: original, liquido do exercicio, antes de cancelamentos, atualizado',()=>{
 const r=make(),result=reconstructValueMeasures(r,[item],{today});
 assert.deepEqual(result,{status:'comparable',measures:{initial:100,issue_year_net:150,net_before_cancellations:180,updated:140}});
 assert.equal(classifyValueMeaning(100,result),'initial');
 assert.equal(classifyValueMeaning(150,result),'issue_year_net');
 assert.equal(classifyValueMeaning(180,result),'net_before_cancellations');
 assert.equal(classifyValueMeaning(140,result),'updated');
 assert.equal(classifyValueMeaning(110,result),'matches_none');
});
test('coincidencia de varias medidas nao permite identificar semantica exclusiva',()=>{
 const flat={seq:1,cents:100,historyChecked:true,movements:[events[0]]};
 const r=reconstructValueMeasures(make(100,[flat]),[flat],{today});
 assert.equal(classifyValueMeaning(100,r),'initial+issue_year_net+net_before_cancellations+updated');
 assert.equal(classifyValueMeaning(null,r),'not_comparable');
});
test('historicos incompletos, ambiguos, divergentes, fora do recorte e duplicados nunca autorizam comparacao',()=>{
 const r=make();
 for(const [items,status] of [
  [[{...item,historyChecked:false}],'partial'],
  [[{...item,cents:141}],'history_unreconciled'],
  [[{...item,movements:[...events,event('2026-10-01','other',0)]}],'history_unreconciled'],
  [[{...item,movements:[...events,event('2027-01-01','reinforcement',0)]}],'outside_window'],
  [[item,item],'invalid_catalog']
 ]){
  const a=reconstructValueMeasures(r,items,{today});assert.equal(a.status,status);
  assert.equal(classifyValueMeaning(100,a),'not_comparable');
 }
});
test('controle de catalogos coincidentes separado dos divergentes; contagens sem identificadores ou valores',()=>{
 const flat={seq:1,cents:100,historyChecked:true,movements:[events[0]]};
 const m=month([doc(1),doc(2,140),doc(3),doc(4)],{[id(1)]:[item],[id(2)]:[item],[id(3)]:[flat],[id(4)]:[{...item,historyChecked:false}]});
 const r=summarizeStoredValueMeanings([m],{today});
 assert.equal(r.divergent.total,2);assert.equal(r.divergent.eligible,1);
 assert.equal(r.divergent.storedValue.initial,1);
 assert.equal(r.divergent.storedValue.not_comparable,1);
 assert.equal(r.matchingCatalog.total,2);assert.equal(r.matchingCatalog.discriminating,1);
 assert.equal(r.matchingCatalog.storedValue.updated,1);
 assert.equal(r.matchingCatalog.storedValue['initial+issue_year_net+net_before_cancellations+updated'],1);
 assert.ok(!JSON.stringify(r).includes(id(1)));
});
test('listagem reconsultada exige paginacao completa e identidade unica',async()=>{
 const r=make(),opts={now,today,token:'test'};
 const good=await readFreshListingValue(r,{...opts,requestDay:async(date,phase,page)=>{
  assert.equal(date,'01/03/2024');assert.equal(phase,1);
  return page===1?[raw()]:[];
 }});
 assert.deepEqual(good,{status:'verified',cents:150});
 const dup=await readFreshListingValue(r,{...opts,requestDay:async(d,f,p)=>p===1?[raw(),raw()]:[]});
 assert.equal(dup.status,'duplicate_identity');
 const repeated=await readFreshListingValue(r,{...opts,requestDay:async()=>[raw()]});
 assert.equal(repeated.status,'repeated_page');
 const partial=await readFreshListingValue(r,{...opts,maxPages:1,requestDay:async()=>[raw()]});
 assert.equal(partial.status,'pagination_incomplete');
 assert.equal(partial.cents,null);
 const wrong=await readFreshListingValue(r,{...opts,requestDay:async(d,f,p)=>p===1?[raw(id(1),'1,50',{fase:'Pagamento'})]:[]});
 assert.equal(wrong.status,'identity_unverified');
 const missing=await readFreshListingValue(r,{...opts,requestDay:async()=>[]});
 assert.equal(missing.status,'complete_no_match');
 const stopped=await readFreshListingValue(r,{...opts,budget:{stopped:()=>true},requestDay:async()=>{throw Error('nao consultar')}});
 assert.equal(stopped.status,'budget_limited');
});
test('confronto de fontes distingue mudanca da listagem de divergencia entre rotas',()=>{
 const v=cents=>({status:'verified',cents});
 assert.equal(classifySourceAgreement(100,v(100),v(100)),'all_equal');
 assert.equal(classifySourceAgreement(100,v(150),v(150)),'current_sources_equal_stored_differs');
 assert.equal(classifySourceAgreement(100,v(100),v(150)),'detail_equals_stored_listing_differs');
 assert.equal(classifySourceAgreement(100,v(150),v(100)),'listing_equals_stored_detail_differs');
 assert.equal(classifySourceAgreement(100,v(150),v(140)),'all_different');
 assert.equal(classifySourceAgreement(100,v(100),{status:'pagination_incomplete',cents:null}),'not_comparable');
});
test('sondagem integra classificacao do detalhe e listagem atuais, sem publicar valores ou identificadores',async()=>{
 const p=await inspectDivergentRecord(make(),{now,today,token:'SECRET',
  requestDetail:async()=>raw(id(1),'1,40'),requestItems:async()=>({ok:true,items:[{seq:1,cents:140}]}),
  requestHistory:async()=>({ok:true,movements:events}),requestDay:async(d,f,p)=>p===1?[raw()]:[]});
 assert.equal(p.semanticStatus,'comparable');
 assert.equal(p.storedMeaning,'initial');assert.equal(p.detailMeaning,'updated');
 assert.equal(p.listingMeaning,'issue_year_net');assert.equal(p.sourceAgreement,'all_different');
 assert.ok(!JSON.stringify(p).includes(id(1)));
 assert.ok(!JSON.stringify(p).includes('SECRET'));
});
