import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 CAMPUS_CNPJ,REITORIA_CNPJ,pncpUrl,comprasUrl,uasgUrl,monthBounds,
 normalizePncp,normalizeCompras,scanPncp,scanCompras,matchDocumentContract,
 paginate,requestPublicJSON
} from '../src/procurement.mjs';
import {blankProcurement,mergeProcurement,validateProcurement} from '../src/procurement-store.mjs';

const idReitoria=REITORIA_CNPJ+'-2-000001/2026';
const idCampus=CAMPUS_CNPJ+'-2-000001/2026';
const fixture=(pncpId=idReitoria,unit='158125')=>({
 numeroControlePNCP:pncpId,numeroControlePNCPCompra:REITORIA_CNPJ+'-1-000001/2026',
 orgaoEntidade:{cnpj:pncpId.slice(0,14)},unidadeOrgao:{codigoUnidade:unit},
 numeroContratoEmpenho:'2026NE000001',processo:'23349.000001/2026-01',
 tipoContrato:{nome:'Contrato'},tipoPessoa:'PJ',niFornecedor:'12.345.678/0001-90',
 nomeRazaoSocialFornecedor:'Empresa Exemplo Ltda',valorGlobal:'1234,56',
 dataPublicacaoPncp:'2026-11-04T09:00:00',dataAssinatura:'2026-11-01',
 dataVigenciaInicio:'2026-11-10',dataVigenciaFim:'2027-11-09',
 objetoContrato:'Aquisição de material para laboratório'
});
const compra=()=>({
 codigoUnidadeGestora:'158459',numeroContrato:'7/2026',
 dataVigenciaInicial:'2026-11-02 00:00:00',dataVigenciaFinal:'2027-11-02',
 processo:'23349.000001/2026-01',niFornecedor:'000.123.456-78',
 nomeRazaoSocialFornecedor:'NOME DE PESSOA QUE NÃO SERÁ PUBLICADO',
 objeto:'Fornecimento de serviço',valorGlobal:'10.000,00'
});

test('CNPJs dos âmbitos IFC e Araquari e filtros são separados',()=>{
 assert.equal(new URL(pncpUrl('2026-11',CAMPUS_CNPJ)).searchParams.get('cnpjOrgao'),CAMPUS_CNPJ);
 assert.equal(new URL(pncpUrl('2026-11',REITORIA_CNPJ)).searchParams.get('cnpjOrgao'),REITORIA_CNPJ);
 assert.equal(new URL(comprasUrl('26422','2026-11')).searchParams.get('codigoUnidadeGestora'),'158459');
 assert.equal(new URL(uasgUrl()).pathname,'/modulo-uasg/1_consultarUasg');
 assert.throws(()=>pncpUrl('2026-11','00012345678901'));
 assert.throws(()=>comprasUrl('../private','2026-11'));
 assert.throws(()=>monthBounds('2026-13'));
});
test('PNCP institucional não é automaticamente atribuído ao campus',()=>{
 const rec=normalizePncp(fixture());
 assert.equal(rec.scope,'ifc');
 assert.equal(rec.orgCnpj,REITORIA_CNPJ);
 assert.equal(rec.amountCents,123456);
 assert.equal(rec.supplierCnpj,'12345678000190');
 assert.equal(rec.process,'23349.000001/2026-01');
 assert.equal(rec.object,'Aquisição de material para laboratório');
 assert.equal(rec.procurementId,REITORIA_CNPJ+'-1-000001/2026');
});
test('PNCP campus com código da unidade tem escopo campus',()=>{
 assert.equal(normalizePncp(fixture(idCampus)).scope,'campus');
 assert.equal(normalizePncp(fixture(idReitoria,'158459')).scope,'campus');
 assert.equal(normalizePncp({...fixture(),orgaoEntidade:{cnpj:'00000000000000'}}),null);
});
test('CPF integral não é publicado; nome de PF suprimido em ambas as fontes',()=>{
 const rec=normalizePncp({...fixture(),niFornecedor:'000.123.456-78',
  tipoPessoa:'PF',nomeRazaoSocialFornecedor:'NOME PRIVADO'});
 assert.equal(rec.supplierCpfMasked,'***.123.456-**');
 assert.equal(rec.supplierName,undefined);
 assert.equal(JSON.stringify(rec).includes('000.123.456-78'),false);
 const c=normalizeCompras(compra());
 assert.equal(c.supplierCpfMasked,'***.123.456-**');
 assert.equal(c.supplierName,undefined);
 assert.equal(JSON.stringify(c).includes('NOME DE PESSOA'),false);
});
test('descrições inseguras são suprimidas e nunca publicadas',()=>{
 const value=normalizePncp({...fixture(),objetoContrato:
  'CPF 000.123.456-78 e e-mail servidor@example.com'});
 assert.equal(value.object,undefined);
 assert.equal(JSON.stringify(value).includes('000.123.456-78'),false);
});
test('paginação PNCP exige todas as páginas e não aceita páginas repetidas',async()=>{
 const fetched=[];
 const get=async url=>{
  const page=Number(new URL(url).searchParams.get('pagina'));
  fetched.push(page);
  return {data:page===1?[fixture()]:[fixture(idCampus)],
    totalPaginas:2};
 };
 const result=await paginate(page=>pncpUrl('2026-11',REITORIA_CNPJ,page),{fetcher:get});
 assert.equal(result.length,2);
 assert.deepEqual(fetched,[1,2]);
 await assert.rejects(paginate(page=>pncpUrl('2026-11',REITORIA_CNPJ,page),{
  fetcher:async()=>({data:[fixture()],totalPaginas:2})}),/duplicada/);
 await assert.rejects(paginate(page=>pncpUrl('2026-11',REITORIA_CNPJ,page),{
  fetcher:get,maxPages:1}),/incompleta/);
});
test('sem conteúdo PNCP é página completa vazia; scan não mistura CNPJs',async()=>{
 let requested=0;
 const result=await scanPncp('2026-11',{
  fetcher:async url=>{
    requested++;
    return new URL(url).searchParams.get('cnpjOrgao')===CAMPUS_CNPJ?
      {data:[],totalPaginas:0}:{data:[fixture()],totalPaginas:1};
  }
 });
 assert.equal(requested,2);
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].scope,'ifc');
});
test('Compras.gov exige UASG confirmada e filtra registros de outra unidade',async()=>{
 const data=await scanCompras('2026-11',{fetcher:async url=>
  url.includes('/modulo-uasg/')?
  {resultado:[{codigoUasg:'158459',codigoOrgao:26422}],totalPaginas:1}:
  {resultado:[compra(),{...compra(),codigoUnidadeGestora:'158125'}],totalPaginas:1}
 });
 assert.equal(data.records.length,1);
 assert.equal(data.skipped,1);
 assert.equal(data.records[0].scope,'campus');
 await assert.rejects(scanCompras('2026-11',{fetcher:async()=>({
  resultado:[{codigoUasg:'158459'}],totalPaginas:1})}),/não confirmado/);
});
test('falha HTTP e dados ausentes não equivalem a zero contratos',async()=>{
 await assert.rejects(requestPublicJSON(uasgUrl(),{
  fetcher:async()=>({ok:false,status:404})}),e=>e.status===404);
 await assert.rejects(requestPublicJSON('https://exemplo.com/privado'),/não autorizado/);
});
test('vínculo confirmado exige NE oficial e escopo campus; contextual exige processo+CNPJ',()=>{
 const doc={id:'158459000012026NE000001',phase:1,
  process:'23349.000001/2026-01',partyRef:'12345678000190'};
 const institutional=normalizePncp(fixture());
 assert.equal(matchDocumentContract(doc,institutional).level,'context');
 const campus=normalizePncp(fixture(idCampus));
 assert.equal(matchDocumentContract(doc,campus).level,'confirmed');
 assert.equal(matchDocumentContract({...doc,partyRef:'00000000000000'},institutional),null);
 assert.equal(matchDocumentContract({...doc,process:'23349.000002/2026-01'},institutional),null);
});
test('JSON contratual único é idempotente e falha remota não remove registros',()=>{
 const row=normalizePncp(fixture());
 const old=mergeProcurement(blankProcurement(),[{
  source:'pncp',month:'2026-11',status:'complete',records:[row],skipped:0
 }]);
 assert.equal(old.changed,true);
 const again=mergeProcurement(old.data,[{source:'pncp',month:'2026-11',
  status:'complete',records:[row],skipped:0}]);
 assert.equal(again.changed,false);
 const failed=mergeProcurement(old.data,[{source:'pncp',month:'2026-11',
  status:'unavailable',httpStatus:503,records:[]}]);
 assert.equal(failed.changed,false);
 assert.equal(failed.data.contracts.length,1);
 assert.doesNotThrow(()=>validateProcurement(failed.data));
});
test('cobertura incompleta é identificada, não transformada em completa',()=>{
 const row=normalizePncp(fixture());
 const data=mergeProcurement(null,[{source:'pncp',month:'2026-11',
  status:'partial',records:[row],skipped:1}]);
 assert.equal(data.data.coverage[0].status,'partial');
 assert.throws(()=>validateProcurement({...data.data,contracts:[
  {...row,supplierCpfMasked:'000.123.456-78'}]}));
});

test('PNCP oficial pagina com data, não somente dados',async()=>{
 const result=await scanPncp('2026-11',{fetcher:async url=>{
  const org=new URL(url).searchParams.get('cnpjOrgao');
  return org===CAMPUS_CNPJ?{data:[],totalPaginas:0}:
    {data:[fixture()],totalPaginas:1};
 }});
 assert.equal(result.records.length,1);
 assert.equal(result.skipped,0);
});
