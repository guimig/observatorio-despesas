import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  noticeDetailUrl,normalizeNoticeDetail,fetchNoticeDetail,planMissingNotices
} from '../src/pncp-notices-detail.mjs';
import {
  blankNotices,mergeNotices,validateNotices,applyDirectNotice
} from '../src/pncp-notices-store.mjs';
import {assessNoticeAttribution} from '../assets/procurement-links.js';

const pncpId='10635424000186-1-000263/2025';
const secondId='10635424000186-1-000264/2025';
const contractId='10635424000186-2-001685/2026';
const sample=(id=pncpId,modality=6)=>({
  numeroControlePNCP:id,numeroCompra:'90021',modalidadeId:modality,
  dataPublicacaoPncp:'2025-08-12T12:00:00',
  orgaoEntidade:{cnpj:'10635424000186'},
  unidadeOrgao:{codigoUnidade:'158125'},processo:'23349.000111/2025-18',
  objetoCompra:'Materiais de laboratório',
  valorTotalEstimado:1234.56
});
const contract=(purchaseId=pncpId)=>({
  source:'pncp',id:'pncp:'+contractId,
  pncpId:contractId,procurementId:purchaseId,
  process:'23349.000111/2025-18'
});
test('URL direta do detalhe PNCP usa ID de contratação oficial Reitoria',()=>{
 assert.equal(new URL(noticeDetailUrl(pncpId)).pathname,
  '/api/consulta/v1/orgaos/10635424000186/compras/2025/263');
 assert.throws(()=>noticeDetailUrl(contractId));
 assert.throws(()=>noticeDetailUrl('000.123.456-78'));
 assert.throws(()=>noticeDetailUrl('10635424000348-1-000263/2025'));
});
test('normalizador de detalhe minimiza resposta e não armazena CPF',()=>{
 const raw={...sample(),niFornecedor:'000.123.456-78',
  nomeFornecedor:'NOME DE PESSOA',dadosBancarios:'Agência 0001'};
 const detail=normalizeNoticeDetail(raw,pncpId);
 assert.equal(detail.pncpId,pncpId);
 assert.equal(detail.modality,6);
 assert.equal(detail.month,'2025-08');
 assert.equal(detail.process,'23349.000111/2025-18');
 assert.equal(detail.estimatedCents,123456);
 const serialized=JSON.stringify(detail);
 assert.equal(serialized.includes('000.123.456-78'),false);
 assert.equal(serialized.includes('NOME DE PESSOA'),false);
 assert.equal(serialized.includes('Agência 0001'),false);
});
test('IDs PNCP divergentes e modalidade desconhecida abortam recuperação',()=>{
 assert.throws(()=>normalizeNoticeDetail(sample(),secondId),/não corresponde/);
 assert.throws(()=>normalizeNoticeDetail({...sample(),modalidadeId:99},pncpId),
  /não reconhecida/);
 assert.throws(()=>normalizeNoticeDetail({data:[sample()]},pncpId));
});
test('fetch só usa detalhe da contratação exata, sem varredura por processo',async()=>{
 const calls=[];
 const notice=await fetchNoticeDetail(pncpId,{fetcher:async url=>{
   calls.push(url);return sample();
 }});
 assert.equal(calls.length,1);
 assert.equal(calls[0],noticeDetailUrl(pncpId));
 assert.equal(notice.id,'pncp:'+pncpId);
});
test('lookup pontual cria cobertura parcial por modalidade/mês, não completa',()=>{
 const notice=normalizeNoticeDetail(sample(),pncpId);
 const result=applyDirectNotice(blankNotices(),notice,new Date('2026-11-19T12:00:00Z'));
 assert.equal(result.changed,true);
 assert.equal(result.data.notices.length,1);
 assert.deepEqual(result.data.coverage,[{
   month:'2025-08',modality:6,status:'partial',count:1,skipped:0
 }]);
 assert.doesNotThrow(()=>validateNotices(result.data));
});
test('dois IDs distintos na mesma modalidade são agregados e sem duplicação',()=>{
 const one=normalizeNoticeDetail(sample(),pncpId);
 const two=normalizeNoticeDetail(sample(secondId),secondId);
 const a=applyDirectNotice(null,one).data;
 const b=applyDirectNotice(a,two).data;
 assert.equal(b.notices.length,2);
 assert.equal(b.coverage[0].count,2);
 assert.equal(applyDirectNotice(b,one).changed,false);
});
test('recuperar detalhe não converte uma cobertura incompleta em completa',()=>{
 const one=normalizeNoticeDetail(sample(),pncpId);
 const two=normalizeNoticeDetail(sample(secondId),secondId);
 const full=mergeNotices(null,[{
  month:'2025-08',modality:6,status:'complete',records:[one],skipped:0
 }]).data;
 const enhanced=applyDirectNotice(full,two).data;
 assert.equal(enhanced.coverage[0].status,'partial');
 assert.equal(enhanced.coverage[0].count,2);
 const scanned=mergeNotices(enhanced,[{
  month:'2025-08',modality:6,status:'complete',records:[one,two],skipped:0
 }]).data;
 assert.equal(scanned.coverage[0].status,'complete');
 assert.equal(scanned.notices.length,2);
});
test('planejador consulta apenas IDs ausentes e remove repetições',()=>{
 const contracts={contracts:[
  contract(pncpId),
  {...contract(pncpId),id:'pncp:10635424000186-2-001686/2026'},
  {...contract(secondId),id:'pncp:10635424000186-2-001687/2026'},
  {...contract('10635424000348-1-000001/2026'),id:'pncp:10635424000186-2-001688/2026'}
 ]};
 const plan=planMissingNotices(contracts,{notices:[]});
 assert.deepEqual(plan,[pncpId,secondId].sort());
 assert.deepEqual(planMissingNotices(contracts,{
   notices:[normalizeNoticeDetail(sample(),pncpId)]
 }),[secondId]);
 assert.throws(()=>planMissingNotices(contracts,{notices:[]},{count:100}));
});
test('link oficial contrato-compra não prova despesa da UG 158459',()=>{
 const notice=normalizeNoticeDetail(sample(),pncpId);
 const evidence=assessNoticeAttribution(notice,[contract()],[]);
 assert.equal(evidence.level,'process_indication');
 const contractWithNe={...contract(),commitmentStatus:'complete',
   commitmentAt:'2026-11-19',commitmentRefs:['158459264222026NE000100']};
 assert.equal(assessNoticeAttribution(notice,[contractWithNe],[]).level,'confirmed');
});
test('objeto com dado pessoal é suprimido na recuperação direta',()=>{
 const unsafe=normalizeNoticeDetail({
  ...sample(),objetoCompra:'CPF 000.123.456-78 de servidor'
 },pncpId);
 assert.equal(unsafe.object,undefined);
 assert.equal(JSON.stringify(unsafe).includes('000.123.456-78'),false);
});
