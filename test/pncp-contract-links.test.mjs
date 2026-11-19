import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  contractDetailUrl,normalizeContractPurchaseLink,fetchContractPurchaseLink,
  planContractPurchaseLinks
} from '../src/pncp-contract-link.mjs';
import {
  blankProcurement,mergeProcurement,validateProcurement,
  applyContractPurchaseLink
} from '../src/procurement-store.mjs';
import {assessNoticeAttribution} from '../assets/procurement-links.js';

const contractId='10635424000186-2-001685/2026';
const purchaseId='10635424000186-1-000263/2026';
const contract=()=>({
  id:'pncp:'+contractId,pncpId:contractId,source:'pncp',
  scope:'ifc',orgCnpj:'10635424000186',publishedMonth:'2026-11',
  number:'2026NE000266',process:'23349.000111/2026-18',unitCode:'158125'
});
const createCatalog=(records=[contract()])=>mergeProcurement(blankProcurement(),[{
  source:'pncp',month:'2026-11',status:'complete',records,skipped:0
}]).data;

test('rota oficial do detalhe não aceita ID externo, CPF ou processo como parâmetro',()=>{
 assert.equal(new URL(contractDetailUrl(contractId)).pathname,
  '/api/pncp/v1/orgaos/10635424000186/contratos/2026/1685');
 assert.throws(()=>contractDetailUrl(purchaseId));
 assert.throws(()=>contractDetailUrl('000.123.456-78'));
 assert.throws(()=>contractDetailUrl('22222222000111-2-000001/2026'));
});
test('retorno real PNCP usa numeroControlePncpCompra e gera ID verificável',()=>{
 const normalized=normalizeContractPurchaseLink({
  numeroControlePNCP:contractId,
  numeroControlePncpCompra:purchaseId,
  nomeRazaoSocialFornecedor:'Nome de pessoa privada',
  niFornecedor:'000.123.456-78'
 },contractId);
 assert.deepEqual(normalized,{status:'linked',procurementId:purchaseId});
 assert.equal(JSON.stringify(normalized).includes('000.123.456-78'),false);
 assert.equal(JSON.stringify(normalized).includes('Nome de pessoa'),false);
});
test('variante de grafia documentada também é aceita, sem adivinhar campos',()=>{
 const normalized=normalizeContractPurchaseLink({
  numeroControlePNCP:contractId,numeroControlePNCPCompra:purchaseId
 },contractId);
 assert.equal(normalized.procurementId,purchaseId);
});
test('resposta sem referência é distinta de resposta errada ou indisponível',async()=>{
 assert.deepEqual(normalizeContractPurchaseLink({
  numeroControlePNCP:contractId,numeroControlePncpCompra:null
 },contractId),{status:'not_reported'});
 assert.throws(()=>normalizeContractPurchaseLink({
  numeroControlePNCP:'10635424000186-2-000001/2026',
  numeroControlePncpCompra:purchaseId
 },contractId),/não corresponde/);
 assert.throws(()=>normalizeContractPurchaseLink({
  numeroControlePNCP:contractId,numeroControlePncpCompra:'12345'
 },contractId),/inválida/);
 await assert.rejects(fetchContractPurchaseLink(contract(),{
  fetcher:async()=>{throw Error('HTTP 503; resposta bruta não deve sair');}
 }));
});
test('consulta autenticada não é necessária para ler o vínculo público',async()=>{
 const url=[];
 const outcome=await fetchContractPurchaseLink(contract(),{fetcher:async target=>{
  url.push(target);
  return {numeroControlePNCP:contractId,numeroControlePncpCompra:purchaseId};
 }});
 assert.equal(url.length,1);
 assert.equal(url[0],contractDetailUrl(contractId));
 assert.equal(outcome.procurementId,purchaseId);
});
test('checkpoint idempotente evita duplicar ID ou escrever novamente',()=>{
 const data=createCatalog();
 const first=applyContractPurchaseLink(data,'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 },new Date('2026-11-19T12:00:00Z'));
 assert.equal(first.changed,true);
 assert.equal(first.data.contracts[0].procurementLinkStatus,'linked');
 assert.equal(first.data.contracts[0].procurementLinkAt,'2026-11-19');
 assert.equal(first.data.contracts[0].procurementId,purchaseId);
 assert.doesNotThrow(()=>validateProcurement(first.data));
 assert.equal(applyContractPurchaseLink(first.data,'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 },new Date('2026-11-19T23:59:00Z')).changed,false);
});
test('reconsulta de contratos PNCP preserva vínculo oficial se nada mudou',()=>{
 let data=createCatalog();
 data=applyContractPurchaseLink(data,'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 }).data;
 const stable=mergeProcurement(data,[{
  source:'pncp',month:'2026-11',status:'complete',records:[contract()],skipped:0
 }]);
 assert.equal(stable.changed,false);
 assert.equal(stable.data.contracts[0].procurementId,purchaseId);
 assert.equal(stable.data.contracts[0].procurementLinkStatus,'linked');
});
test('retificação do contrato invalida vínculo antigo para nova consulta',()=>{
 let data=createCatalog();
 data=applyContractPurchaseLink(data,'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 }).data;
 const updated=mergeProcurement(data,[{
  source:'pncp',month:'2026-11',status:'complete',skipped:0,
  records:[{...contract(),number:'00415'}]
 }]).data;
 assert.equal(updated.contracts[0].procurementLinkStatus,undefined);
 assert.equal(updated.contracts[0].procurementId,undefined);
});
test('falha externa não apaga ID PNCP confirmado',()=>{
 const first=applyContractPurchaseLink(createCatalog(),'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 }).data;
 assert.equal(applyContractPurchaseLink(first,'pncp:'+contractId,{
  status:'unavailable'
 }).changed,false);
 assert.equal(applyContractPurchaseLink(first,'pncp:'+contractId,{
  status:'not_reported'
 }).changed,false);
 assert.deepEqual(first.contracts[0].procurementId,purchaseId);
});
test('campo not_reported não produz vínculo falso',()=>{
 const first=applyContractPurchaseLink(createCatalog(),'pncp:'+contractId,{
  status:'not_reported'
 },new Date('2026-11-19T12:00:00Z'));
 assert.equal(first.data.contracts[0].procurementId,undefined);
 assert.equal(first.data.contracts[0].procurementLinkStatus,'not_reported');
 assert.throws(()=>validateProcurement({
  ...first.data,contracts:[{...first.data.contracts[0],procurementId:purchaseId}]
 }),/contraditório/);
});
test('fila processa somente pendências, respeita periodicidade de reconsulta',()=>{
 const now=new Date('2026-11-19T12:00:00Z');
 const empty=createCatalog();
 assert.equal(planContractPurchaseLinks(empty,{now}).length,1);
 const confirmed=applyContractPurchaseLink(empty,'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 },now).data;
 assert.equal(planContractPurchaseLinks(confirmed,{now}).length,0);
 assert.equal(planContractPurchaseLinks(confirmed,{now,recheck:true}).length,1);
 const failed=applyContractPurchaseLink(empty,'pncp:'+contractId,{
  status:'unavailable'
 },now).data;
 assert.equal(planContractPurchaseLinks(failed,{now}).length,0);
 assert.equal(planContractPurchaseLinks(failed,{
  now:new Date('2026-11-27T12:00:00Z')
 }).length,1);
 const missing=applyContractPurchaseLink(empty,'pncp:'+contractId,{
  status:'not_reported'
 },now).data;
 assert.equal(planContractPurchaseLinks(missing,{now}).length,0);
 assert.equal(planContractPurchaseLinks(missing,{
  now:new Date('2026-12-20T12:00:00Z')
 }).length,1);
 assert.throws(()=>planContractPurchaseLinks(empty,{count:500}));
});
test('a relação licitação-contrato é oficial, mas não prova UG Araquari',()=>{
 const linked=applyContractPurchaseLink(createCatalog(),'pncp:'+contractId,{
  status:'linked',procurementId:purchaseId
 }).data.contracts[0];
 const notice={pncpId:purchaseId,process:'23350.001234/2026-01'};
 assert.equal(assessNoticeAttribution(notice,[linked],[]).level,'context'); // Referência oficial à compra, mas campus só indicado no contrato.
 const withNe={...linked,commitmentRefs:['158459264222026NE000266'],
  commitmentAt:'2026-11-19',commitmentStatus:'complete'};
 assert.equal(assessNoticeAttribution(notice,[withNe],[]).level,'confirmed');
});
