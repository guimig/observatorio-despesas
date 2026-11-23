import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pncpProbeUrl,probePncp,probeContratosGov,instrumentProbeWindow,instrumentControlWindow}
 from '../src/probe-official-data.mjs';

const archived='10635424000186-2-000111/2026';
const other='10635424000186-2-000112/2026';
const commitment='158459264222026NE000003';
const sample={
 contracts:[{pncpId:archived}],
 months:[{documents:[{id:commitment,phase:1}],relations:[]}]
};
const windowStart='2026-11-10',windowEnd='2026-11-23';
function row(id,extra={}){
 return {numeroControlePNCP:id,orgaoEntidade:{cnpj:'10635424000186'},
   dataPublicacaoPncp:'2026-10-10',...extra};
}
const makeBody=(rows,totalPaginas=1)=>({data:rows,totalPaginas});
const mockFn=(callback)=>async(url,options)=>{
 assert.equal(options.redirect,'error');
 return callback(new URL(url));
};
test('parametros de consulta sao limitados a PNCP, CNPJ institucional e 2 paginas',()=>{
 const url=new URL(pncpProbeUrl('contratos_atualizacao',windowStart,windowEnd));
 assert.equal(url.hostname,'pncp.gov.br');
 assert.equal(url.searchParams.get('cnpjOrgao'),'10635424000186');
 assert.equal(url.searchParams.get('tamanhoPagina'),'10');
 assert.equal(url.searchParams.get('dataInicial'),'20261110');
 assert.throws(()=>pncpProbeUrl('contratos_atualizacao',windowEnd,windowStart));
 assert.throws(()=>pncpProbeUrl('contratos_atualizacao','2026-01-01',windowEnd));
 assert.throws(()=>pncpProbeUrl('contratos_atualizacao',windowStart,windowEnd,3));
 assert.throws(()=>pncpProbeUrl('invented',windowStart,windowEnd));
});
test('amostra de contratos relaciona apenas IDs oficiais PNCP e NE integral CGU',async()=>{
 const fetchFn=mockFn(()=>new Response(JSON.stringify(makeBody([
   row(archived,{numeroEmpenho:commitment}),
   row(other,{numeroEmpenho:'2026NE000003',dataPublicacaoPncp:'2026-11-21'})
 ])),{headers:{'Content-Type':'application/json'}}));
 const result=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,{fetchFn});
 assert.equal(result.status,'sample_complete');
 assert.equal(result.counts.rowsExamined,2);
 assert.equal(result.counts.officialPncpIds,2);
 assert.equal(result.counts.matchedArchivedPncpIds,1);
 assert.equal(result.counts.rowsWithFullSiafiNe,1);
 assert.equal(result.counts.fullNeFoundInCguArchive,1);
 assert.equal(result.counts.publishedBeforeUpdateWindow,1);
 assert.equal(JSON.stringify(result).includes(commitment),false);
 assert.equal(JSON.stringify(result).includes(archived),false);
});
test('instrumentos de cobranca nao se tornam pagamentos nem RP',async()=>{
 const fetchFn=mockFn(()=>new Response(JSON.stringify(makeBody([
   {numeroControlePNCPContrato:archived,descricao:'CPF 11122233344',valor:123456},
 ]))));
 const result=await probePncp('instrumentos_inclusao',windowStart,windowEnd,sample,{fetchFn});
 assert.equal(result.status,'sample_complete');
 assert.equal(result.counts.matchedArchivedPncpIds,1);
 assert.equal(result.counts.rowsWithFullSiafiNe,0);
 assert.equal(JSON.stringify(result).includes('11122233344'),false);
 assert.equal(JSON.stringify(result).includes('123456'),false);
});
test('paginacao maior do que teto continua amostra incompleta, nao resultado total',async()=>{
 let page=0;
 const fetchFn=mockFn(()=>new Response(JSON.stringify(makeBody([
   row(page++?other:archived)
 ],4))));
 const result=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,{fetchFn});
 assert.equal(result.status,'sample_incomplete');
 assert.equal(result.pagesDeclared,4);
 assert.equal(result.pagesConsulted,2);
 assert.equal(result.counts.rowsExamined,2);
});
test('respostas repetidas, 401 e schema incompleto nao viram ausencia de registros',async()=>{
 const fetchFn=mockFn(()=>new Response(JSON.stringify(makeBody([row(archived)],2))));
 const repeat=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,{fetchFn});
 assert.equal(repeat.status,'repeated_page');
 assert.equal(repeat.counts.rowsExamined,0);
 const denied=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,
   {fetchFn:mockFn(()=>new Response('private',{status:401}))});
 assert.equal(denied.status,'authentication_required');
 const invalid=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,
   {fetchFn:mockFn(()=>new Response(JSON.stringify({totalPaginas:1,data:{}})))});
 assert.equal(invalid.status,'invalid_envelope');
 assert.equal(denied.counts.rowsExamined,0);
});
test('nao divulga resultados parciais apos falha na pagina seguinte',async()=>{
 let page=0;
 const result=await probePncp('contratos_atualizacao',windowStart,windowEnd,sample,
   {fetchFn:mockFn(()=>++page===1?
     new Response(JSON.stringify(makeBody([row(archived)],2))):
     new Response('private',{status:500}))});
 assert.equal(result.status,'http_500');
 assert.equal(result.counts.rowsExamined,0);
});
test('Contratos.gov: separa acesso anonimo das rotas JWT e nao le retornos de UG',async()=>{
 const calls=[];
 const fetchFn=async(url)=>{
   const {pathname}=new URL(url);calls.push(pathname);
   if(pathname==='/docs/api-docs.json')return new Response(JSON.stringify({
     openapi:'3.0.0',paths:{'/api/v1/empenho/rp':{get:{
       security:[{bearerAuth:[]}],parameters:[
         {name:'dt_alteracao_min',in:'query',required:true},
         {name:'cpf',in:'header',required:false}]}}},
     example:'CPF 11122233344'
   }));
   if(pathname==='/api/v1/empenho/rp')return new Response('',{status:401});
   if(pathname==='/api/contrato/ug/158459')
     return new Response(JSON.stringify([{cpf:'11122233344',nome:'PRIVATE NAME'}]));
   return new Response('<html>docs</html>');
 };
 const result=await probeContratosGov({fetchFn});
 assert.equal(calls.length,4);
 assert.deepEqual(result.map(x=>x.status),[
   'http_200','openapi_available','authentication_required','http_200']);
 assert.equal(result[1].routes[0].query[0].name,'dt_alteracao_min');
 for(const secret of ['11122233344','PRIVATE NAME','CPF'])
   assert.equal(JSON.stringify(result).includes(secret),false);
});
test('falhas de rede dos quatro testes de acesso nao vazam URL ou CPF',async()=>{
 const result=await probeContratosGov({fetchFn:async()=>{throw Error('CPF 12345678900 token');}});
 assert.equal(result.length,4);
 assert.ok(result.every(x=>x.status==='network_unavailable'));
 assert.equal(JSON.stringify(result).includes('12345678900'),false);
});

test('instrumentos de cobranca sondados em um unico dia encerrado',()=>{
 const short=instrumentProbeWindow(new Date('2026-11-23T15:00:00Z'));
 assert.deepEqual(short,{initial:'2026-11-22',final:'2026-11-22'});
 assert.ok(short.initial===short.final);
});

test('controle da cobranca usa dia util encerrado, sem tratar 404 como zero',()=>{
 assert.deepEqual(instrumentControlWindow(new Date('2026-11-23T15:00:00Z')),
   {initial:'2026-11-20',final:'2026-11-20'});
 assert.deepEqual(instrumentControlWindow(new Date('2026-11-24T15:00:00Z')),
   {initial:'2026-11-23',final:'2026-11-23'});
 const sunday=instrumentProbeWindow(new Date('2026-11-23T15:00:00Z'));
 assert.equal(sunday.final,'2026-11-22');
});
