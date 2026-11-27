import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annualUrl,compareSample,probeAnnual,probeAnnualSeries} from '../src/probe-contratos-commitments.mjs';
const now=new Date('2026-11-26T12:00:00Z'),id='158459264222026NE000123';
const docs=[{id,phase:1},{id:'158459264222026NE000124',phase:1}];
test('rota anual restrita a UG e recorte temporal',()=>{
 assert.equal(annualUrl(2024,now),'https://contratos.comprasnet.gov.br/api/v1/empenho/ano/2024/ug/158459');
 assert.throws(()=>annualUrl(2023,now));assert.throws(()=>annualUrl(2027,now));
});
test('comparacao exige identidade integral, nao converte numero curto nem vaza valores',()=>{
 const result=compareSample([{numeroEmpenho:id,numeroPlanoInterno:'PI-TESTE',valor:123456},
  {numero:'2026NE000124',plano_interno:'OUTRO',cpf:'11122233344'},
  {numero:'158125264222026NE000124'}],{year:2026,documents:docs});
 assert.equal(result.localNe,2);assert.equal(result.matchedLocal,1);assert.equal(result.matchedWithPi,1);
 assert.equal(result.shortOnly,1);assert.equal(result.matchedWithoutKnownPncpLink,1);
 for(const secret of [id,'PI-TESTE','123456','11122233344','OUTRO'])
  assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal(compareSample({data:[],totalPaginas:2},{year:2026}).status,'sample_incomplete');
 assert.equal(compareSample({error:'secret'},{year:2026}).status,'invalid_or_oversized_shape');
});
test('HTTP, falha de rede e resposta invalida sao estados distintos',async()=>{
 for(const status of [401,403,404,429,503]){
  const r=await probeAnnual(2026,{now,fetchFn:async()=>new Response('secret',{status})});
  assert.deepEqual(r,{year:2026,status:'http_'+status});
 }
 assert.equal((await probeAnnual(2026,{now,fetchFn:async()=>{throw Error('secret')}})).status,'network_unavailable');
 assert.equal((await probeAnnual(2026,{now,fetchFn:async()=>new Response('<html>secret</html>')})).status,'invalid_json_or_body');
});

test('manutencao: consulta ano corrente e interrompe restantes sem confundir com zero',async()=>{
 let calls=0;
 const r=await probeAnnualSeries({now,fetchFn:async()=>{calls++;return new Response('private',{status:503});}});
 assert.equal(calls,1);
 assert.deepEqual(r,[{year:2026,status:'http_503'},{year:2025,status:'deferred_source_unavailable'},{year:2024,status:'deferred_source_unavailable'}]);
 const ok=await probeAnnualSeries({now,fetchFn:async()=>new Response('[]')});
 assert.deepEqual(ok.map(x=>x.year),[2026,2025,2024]);
 assert.ok(ok.every(x=>x.status==='array_received_completeness_unverified'));
});

test('interseccao por NE integral com CGU nao afirma igualdade de contratos',()=>{
 const r=compareSample([{numeroEmpenho:id,contrato_id:928377},{numero:'2026NE000124',contrato_id:1}],{year:2026,documents:docs,cguContracts:[{id:42,refs:[id]}]});
 assert.equal(r.fullNeWithContractField,1);assert.equal(r.matchedWithCguContractLink,1);assert.equal(r.matchedWithCguContractAndContractField,1);assert.equal(JSON.stringify(r).includes('928377'),false);
});
