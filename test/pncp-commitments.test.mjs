import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  assessContractAttribution,matchDocumentContract,
  extractAraquariNeEvidence,isAraquariProcess
} from '../assets/procurement-links.js';
import {
  linkedCommitmentsUrl,extractCommitmentRefs,fetchLinkedCommitments
} from '../src/pncp-commitments.mjs';
import {
  blankProcurement,mergeProcurement,applyCommitmentResult,validateProcurement
} from '../src/procurement-store.mjs';
import {planCommitmentChecks} from '../src/collect-pncp-commitments.mjs';

const ne='158459264222026NE000266';
const other='158125264222026NE000266';
const pncpId='10635424000186-2-001685/2026';
const process='23349.004018/2026-92';
const base=()=>({
  id:'pncp:'+pncpId,source:'pncp',scope:'ifc',
  orgCnpj:'10635424000186',pncpId,publishedMonth:'2026-11',
  unitCode:'158125',process,number:'2026NE000266'
});
const doc=()=>({id:ne,phase:1,process,partyRef:'12345678000190'});

test('PNCP centralizado não é atribuído a Araquari pela UG publicadora',()=>{
 const record={...base(),unitCode:'158125',process:'23350.000001/2026-01'};
 assert.equal(assessContractAttribution(record,[]).level,'unverified');
 assert.equal(matchDocumentContract({...doc(),process:'23349.000000/2026-00'},record),null);
 assert.equal(assessContractAttribution({...record,scope:'campus'},[]).level,'unverified');
});
test('prefixo 23349 é evidência subsidiária, não confirmação de execução',()=>{
 const record=base();
 assert.equal(isAraquariProcess(process),true);
 assert.equal(assessContractAttribution(record).level,'process_indication');
 assert.equal(assessContractAttribution({...record,process:'23350.004018/2026-92'}).level,'unverified');
 assert.equal(assessContractAttribution({...record,process:'23349.00??18/2026-92'}).level,'unverified');
});
test('NE curta sem UG não pode ser convertida em confirmação',()=>{
 const record={...base(),process:'23350.004018/2026-92'};
 assert.equal(assessContractAttribution(record,[doc()]).level,'unverified');
 assert.equal(extractAraquariNeEvidence('2026NE000266'),null);
 assert.equal(extractAraquariNeEvidence(other),null);
});
test('UG administrativa 158459 e NE abreviada permanecem indicio mesmo com CGU',()=>{
 const contract={...base(),process:'23350.004018/2026-92',unitCode:'158459'};
 assert.equal(assessContractAttribution(contract,[]).level,'ne_indication');
 assert.equal(assessContractAttribution(contract,[doc()]).level,'ne_indication');
 assert.equal(matchDocumentContract(doc(),contract).level,'ne_indication');
 assert.equal(assessContractAttribution({...contract,number:'2026NE000267'},[doc()]).level,
   'ne_indication'); // A UG indicada é indício, mas não coincide com a NE da CGU.
});
test('PNCP vincula NE integral da UG 158459, mesmo cadastrado na Reitoria',()=>{
 const record={...base(),process:'23350.004018/2026-92',number:'00190',
   commitmentStatus:'complete',commitmentAt:'2026-11-19',commitmentRefs:[ne]};
 assert.equal(assessContractAttribution(record).level,'confirmed');
 assert.equal(matchDocumentContract(doc(),record).level,'confirmed');
 assert.equal(extractAraquariNeEvidence(ne).kind,'full');
 assert.equal(extractAraquariNeEvidence('1584592026NE000266').kind,'ug_short');
});
test('numeroEmpenho externo só conserva UG 158459, jamais CPF ou outras UGs',()=>{
 const refs=extractCommitmentRefs([
  {numeroEmpenho:other,niCredorFornecedor:'000.123.456-78'},
  {numeroEmpenho:ne,nomeCredorFornecedor:'PESSOA FÍSICA'},
  {numeroEmpenho:ne},
  {numeroEmpenho:'1584592026NE000265'},
  {numeroEmpenho:'2026NE000266'},
  {numeroEmpenho:'000.123.456-78'}
 ]);
 assert.deepEqual(refs,['1584592026NE000265',ne].sort());
 const json=JSON.stringify(refs);
 assert.equal(json.includes('000.123.456-78'),false);
 assert.equal(json.includes(other),false);
});
test('endpoint oficial de empenhos usa ano/sequencial do contrato PNCP',()=>{
 const url=new URL(linkedCommitmentsUrl(pncpId,2));
 assert.equal(url.pathname,
  '/api/pncp/v1/orgaos/10635424000186/contratos/2026/1685/empenhos');
 assert.equal(url.searchParams.get('pagina'),'2');
 assert.throws(()=>linkedCommitmentsUrl('nota-fiscal'));
});
test('paginação completa e vazio são distintos de falha de API',async()=>{
 const contract=base();
 const requests=[];
 const good=await fetchLinkedCommitments(contract,{fetcher:async url=>{
  const page=Number(new URL(url).searchParams.get('pagina'));
  requests.push(page);
  return {data:page===1?[{sequencialEmpenho:1,numeroEmpenho:ne}]:
    [{sequencialEmpenho:2,numeroEmpenho:other}],totalPaginas:2};
 }});
 assert.deepEqual(requests,[1,2]);
 assert.deepEqual(good,{refs:[ne],count:2});
 const empty=await fetchLinkedCommitments(contract,{fetcher:async()=>({
  data:[],totalPaginas:0
 })});
 assert.deepEqual(empty,{refs:[],count:0});
 await assert.rejects(fetchLinkedCommitments(contract,{maxPages:1,fetcher:async()=>({
  data:[{numeroEmpenho:ne}],totalPaginas:3
 })}),/incompleta/);
 await assert.rejects(fetchLinkedCommitments(contract,{fetcher:async()=>({
  mensagem:'API indisponível'
 })}),/sem data/);
});
test('checkpoint só conserva refs PNCP válidas; nunca guarda NE de outra UG',()=>{
 const original=mergeProcurement(blankProcurement(),[{
  source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0
 }]).data;
 const good=applyCommitmentResult(original,base().id,{
  status:'complete',refs:[ne]
 },new Date('2026-11-19T12:00:00Z'));
 assert.equal(good.changed,true);
 assert.deepEqual(good.data.contracts[0].commitmentRefs,[ne]);
 assert.equal(applyCommitmentResult(good.data,base().id,{
  status:'complete',refs:[ne]
 }).changed,false);
 assert.throws(()=>applyCommitmentResult(original,base().id,{
  status:'complete',refs:[other]
 }));
 assert.doesNotThrow(()=>validateProcurement(good.data));
});
test('resultado indisponível não apaga referência previamente confirmada',()=>{
 const old=mergeProcurement(null,[{
  source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0
 }]).data;
 const complete=applyCommitmentResult(old,base().id,{status:'complete',refs:[ne]}).data;
 const retry=applyCommitmentResult(complete,base().id,{status:'unavailable'});
 assert.equal(retry.changed,false);
 assert.deepEqual(retry.data.contracts[0].commitmentRefs,[ne]);
 const invalid=applyCommitmentResult(old,base().id,{status:'unavailable'});
 assert.equal(invalid.data.contracts[0].commitmentStatus,'unavailable');
 assert.equal(invalid.data.contracts[0].commitmentRefs,undefined);
});
test('coleta de contratos mantém refs PNCP quando instrumento permanece estável',()=>{
 const old=mergeProcurement(null,[{
  source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0
 }]).data;
 const full=applyCommitmentResult(old,base().id,{status:'complete',refs:[ne]}).data;
 const repeated=mergeProcurement(full,[{
  source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0
 }]);
 assert.equal(repeated.changed,false);
 assert.deepEqual(repeated.data.contracts[0].commitmentRefs,[ne]);
 const changed=mergeProcurement(full,[{
  source:'pncp',month:'2026-11',records:[{...base(),number:'00191'}],
  status:'complete',skipped:0
 }]).data;
 assert.equal(changed.contracts[0].commitmentStatus,undefined);
});
test('planejador prioriza evidências, evita repetir consultas, retenta após prazo',()=>{
 const c=base(),a={...c,id:'pncp:10635424000186-2-001686/2026',
   pncpId:'10635424000186-2-001686/2026',process:'23350.000001/2026-01'};
 const catalog=mergeProcurement(null,[{
  source:'pncp',month:'2026-11',records:[c,a],status:'complete',skipped:0
 }]).data;
 const now=new Date('2026-11-19T12:00:00Z');
 assert.equal(planCommitmentChecks(catalog,{now,count:1})[0].id,c.id);
 const checked=applyCommitmentResult(catalog,c.id,{status:'complete',refs:[]},now).data;
 assert.equal(planCommitmentChecks(checked,{now,count:2}).length,1);
 const unavailable=applyCommitmentResult(checked,a.id,{status:'unavailable'},now).data;
 assert.equal(planCommitmentChecks(unavailable,{now,count:2}).length,0);
 assert.equal(planCommitmentChecks(unavailable,{
   now:new Date('2026-11-28T12:00:00Z'),count:2
 }).length,1);
 assert.equal(planCommitmentChecks(unavailable,{now,recheck:true,count:2}).length,2);
});

test('consulta PNCP completa sem NE da UG e revalidada apos 30 dias',()=>{
 const now=new Date('2026-11-20T12:00:00Z');
 const original=mergeProcurement(null,[{
  source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0
 }]).data;
 const empty=applyCommitmentResult(original,base().id,{
  status:'complete',refs:[]
 },new Date('2026-10-15T12:00:00Z')).data;
 assert.equal(planCommitmentChecks(empty,{now,count:8}).length,1);
 const recent=applyCommitmentResult(original,base().id,{
  status:'complete',refs:[]
 },new Date('2026-11-10T12:00:00Z')).data;
 assert.equal(planCommitmentChecks(recent,{now,count:8}).length,0);
 const withNe=applyCommitmentResult(original,base().id,{
  status:'complete',refs:[ne]
 },new Date('2026-10-15T12:00:00Z')).data;
 assert.equal(planCommitmentChecks(withNe,{now,count:8}).length,1);
});
test('consultas nunca realizadas tem prioridade sobre vazios a revalidar',()=>{
 const now=new Date('2026-11-20T12:00:00Z');
 const a=base(),b={...base(),id:'pncp:10635424000186-2-001686/2026',
  pncpId:'10635424000186-2-001686/2026'};
 const catalog=mergeProcurement(null,[{
  source:'pncp',month:'2026-11',records:[a,b],status:'complete',skipped:0
 }]).data;
 const checked=applyCommitmentResult(catalog,a.id,{
  status:'complete',refs:[]
 },new Date('2026-10-15T12:00:00Z')).data;
 assert.equal(planCommitmentChecks(checked,{now,count:1})[0].id,b.id);
});

import {stateKey} from '../src/operational-state.mjs';
test('vinculos positivos reconsultados nao voltam prematuramente a fila',()=>{
 const now=new Date('2026-11-24');
 const original=mergeProcurement(null,[{source:'pncp',month:'2026-11',records:[base()],status:'complete',skipped:0}]).data;
 const catalog=applyCommitmentResult(original,base().id,{status:'complete',refs:[ne]},new Date('2026-10-01')).data;
 const contract=catalog.contracts[0],state={[stateKey(contract)]:'2026-11-24'};
 assert.equal(planCommitmentChecks(catalog,{now,state}).length,0);
 assert.equal(planCommitmentChecks(catalog,{now,state:{}}).length,1);
 assert.equal(planCommitmentChecks(catalog,{now,state,recheck:true}).length,1);
 assert.equal(planCommitmentChecks({...catalog,contracts:[{...contract,number:'different'}]},{now,state}).length,1);
 assert.equal(applyCommitmentResult(catalog,contract.id,{status:'complete',refs:[ne]},now).changed,false);
});

test('prioriza confronto com NE real sem converter criterio em vinculo e sem selecionar duplicatas',()=>{
 const c=base(),d=doc(),candidate={...c,id:'candidate',pncpId:'10635424000186-2-001687/2026',supplierCnpj:d.partyRef};
 const other={...c,id:'other',pncpId:'10635424000186-2-001688/2026',process:'23350.000001/2026-01'};
 const cat={contracts:[other,c,candidate]};
 assert.equal(planCommitmentChecks(cat,{documents:[d],count:1,now:new Date('2026-11-26')})[0].id,'candidate');
 const plan=planCommitmentChecks(cat,{documents:[d],count:3,now:new Date('2026-11-26')});
 assert.equal(new Set(plan.map(x=>x.id)).size,3);
 assert.notEqual(assessContractAttribution(candidate,[d]).level,'confirmed');
});
