import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noticeUrl,normalizeNotice,scanNotices} from '../src/pncp-notices.mjs';
import {blankNotices,validateNotices,mergeNotices} from '../src/pncp-notices-store.mjs';
import {assessNoticeAttribution} from '../assets/procurement-links.js';
import {MODALITIES} from '../assets/pncp-modalities.js';

const fixture=(modality=6)=>({
  numeroControlePNCP:'10635424000186-1-000123/2026',numeroCompra:'90024/2026',
  dataPublicacaoPncp:'2026-11-19T12:00:00',
  modalidadeId:modality,orgaoEntidade:{cnpj:'10635424000186'},
  unidadeOrgao:{codigoUnidade:'158125'},
  processo:'23349.000111/2026-18',
  objetoCompra:'Aquisição de equipamentos de laboratório',
  valorTotalEstimado:25000,valorTotalHomologado:18000,
  situacaoCompraId:1,srp:true
});
test('14 modalidades do PNCP varridas sob CNPJ publicador Reitoria',()=>{
 assert.equal(Object.keys(MODALITIES).length,14);
 for(const m of [1,4,5,6,7,8,9,12,13,14]){
   const url=new URL(noticeUrl('2026-11',m));
   assert.equal(url.searchParams.get('cnpj'),'10635424000186');
   assert.equal(url.searchParams.get('codigoModalidadeContratacao'),String(m));
   assert.equal(url.searchParams.get('tamanhoPagina'),'50');
 }
 assert.throws(()=>noticeUrl('2026-13',6));
 assert.throws(()=>noticeUrl('2026-11',99));
});
test('normalizar edital PNCP não atribui pela UASG 158125',()=>{
 const n=normalizeNotice(fixture(),6);
 assert.equal(n.publicationUasg,'158125');
 assert.equal(n.modality,6);
 assert.equal(n.process,'23349.000111/2026-18');
 assert.equal(n.estimatedCents,2500000);
 assert.equal(n.homologatedCents,1800000);
 assert.equal(n.srp,true);
 assert.equal(n.object,'Aquisição de equipamentos de laboratório');
 assert.equal(assessNoticeAttribution(n).level,'process_indication');
 const other=normalizeNotice({...fixture(),processo:'23350.000111/2026-18'},6);
 assert.equal(assessNoticeAttribution(other).level,'unverified');
});
test('objeto inseguro suprimido e sem CPF integral publicado',()=>{
 const n=normalizeNotice({...fixture(8),
  objetoCompra:'CPF 000.123.456-78 de servidor e email user@example.com'},8);
 assert.equal(n.object,undefined);
 assert.equal(JSON.stringify(n).includes('000.123.456-78'),false);
 assert.equal(normalizeNotice({...fixture(),orgaoEntidade:{cnpj:'10635424000348'}},6),null);
});
test('API PNCP retorna data e totalPaginas, inclusive páginas vazias',async()=>{
 const result=await scanNotices('2026-11',6,{fetcher:async()=>({
  data:[fixture()],totalPaginas:1
 })});
 assert.equal(result.records.length,1);
 assert.equal(result.skipped,0);
 const empty=await scanNotices('2026-11',9,{fetcher:async()=>({
  data:[],totalPaginas:0
 })});
 assert.deepEqual(empty,{records:[],skipped:0});
});
test('paginação truncada e registros não normalizáveis não são completude',async()=>{
 await assert.rejects(scanNotices('2026-11',6,{maxPages:1,fetcher:async()=>({
  data:[fixture()],totalPaginas:2
 })}),/excedido/);
 const partial=await scanNotices('2026-11',6,{fetcher:async()=>({
  data:[fixture(),{...fixture(),numeroControlePNCP:'outro CNPJ'}],totalPaginas:1
 })});
 assert.equal(partial.skipped,1);
 assert.equal(partial.records.length,1);
});
test('catálogo admite cobertura por modalidade sem dados inventados',()=>{
 const first=mergeNotices(blankNotices(),[{
  month:'2026-11',modality:6,status:'complete',records:[
    normalizeNotice(fixture(),6)],skipped:0
 }]);
 assert.equal(first.changed,true);
 assert.equal(first.data.notices.length,1);
 const again=mergeNotices(first.data,[{
  month:'2026-11',modality:6,status:'complete',records:[
    normalizeNotice(fixture(),6)],skipped:0
 }]);
 assert.equal(again.changed,false);
 const failed=mergeNotices(first.data,[{
  month:'2026-11',modality:6,status:'unavailable',httpStatus:503
 }]);
 assert.equal(failed.changed,false);
 assert.doesNotThrow(()=>validateNotices(first.data));
});
test('outra modalidade mantém cobertura independente e nunca substitui histórico',()=>{
 const a=normalizeNotice(fixture(),6);
 const b=normalizeNotice({...fixture(8),numeroControlePNCP:
  '10635424000186-1-000124/2026'},8);
 const merged=mergeNotices(null,[{
  month:'2026-11',modality:6,status:'complete',records:[a]
 },{
  month:'2026-11',modality:8,status:'complete',records:[b]
 }]);
 assert.equal(merged.data.notices.length,2);
 assert.equal(merged.data.coverage.length,2);
 const other=mergeNotices(merged.data,[{
  month:'2026-10',modality:6,status:'unavailable',httpStatus:500
 }]);
 assert.equal(other.data.notices.length,2);
 assert.equal(other.data.coverage.length,3);
});
test('vínculo de edital não é confirmado só por processo 23349',()=>{
 const notice=normalizeNotice(fixture(),6);
 const contract={
  procurementId:notice.pncpId,pncpId:'10635424000186-2-000333/2026',
  source:'pncp',process:notice.process,commitmentRefs:['158459264222026NE000111']
 };
 assert.equal(assessNoticeAttribution(notice,[contract]).level,'confirmed');
 assert.equal(assessNoticeAttribution({...notice,process:'23350.000111/2026-18'},[]).level,
  'unverified');
});
test('schema proíbe CPF bruto e chaves não autorizadas no catálogo',()=>{
 const n=normalizeNotice(fixture(),6);
 const data=mergeNotices(null,[{
  month:'2026-11',modality:6,status:'complete',records:[n]
 }]).data;
 const bad=structuredClone(data);bad.notices[0].cpf='000.123.456-78';
 assert.throws(()=>validateNotices(bad));
});
