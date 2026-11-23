import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API_CATALOG,summarizeOpenApi,inspectOfficialCatalog}
  from '../src/probe-official-apis.mjs';

const source=API_CATALOG.find(s=>s.name==='CONTRATOS_GOV');
const spec={openapi:'3.0.0',security:[{bearerAuth:[]}],paths:{
 '/api/v1/empenho/rp':{get:{parameters:[
  {name:'data_inicio',in:'query',required:true,schema:{type:'string'}},
  {name:'data_fim',in:'query',required:true,schema:{type:'string'}},
  {name:'cpf',in:'header',required:false},
  {name:'data_inicio',in:'query',required:true}
 ]}},
 '/api/v2/empenho':{get:{security:[],parameters:[
  {name:'pagina',in:'query',required:false}]}},
 '/api/v1/empenho/ug/{unidade}':{post:{}}
}};
test('catalogo resume somente rotas e parametros, nunca schemas ou exemplos',()=>{
 const result=summarizeOpenApi(spec,source);
 assert.equal(result.status,'openapi_available');
 const rp=result.routes.find(r=>r.path==='/api/v1/empenho/rp');
 assert.equal(rp.status,'documented');
 assert.equal(rp.authentication,'declared');
 assert.deepEqual(rp.query,[{name:'data_inicio',required:true},
   {name:'data_fim',required:true}]);
 const v2=result.routes.find(r=>r.path==='/api/v2/empenho');
 assert.equal(v2.authentication,'not_declared');
 assert.equal(v2.query[0].name,'pagina');
 const missing=result.routes.find(r=>r.path.includes('/ano/'));
 assert.equal(missing.status,'not_documented');
 assert.equal(result.routes.at(-1).status,'not_documented');
});
test('erro HTTP ou schema invalido nao significam catalogo vazio ou sem despesas',async()=>{
 const http=await inspectOfficialCatalog(source,{fetchFn:async()=>new Response('private', {status:403})});
 assert.equal(http.status,'authentication_or_access_required');
 const unavailable=await inspectOfficialCatalog(source,{fetchFn:async()=>new Response('',{status:500})});
 assert.equal(unavailable.status,'http_unavailable');
 const invalid=await inspectOfficialCatalog(source,{fetchFn:async()=>new Response('[]')});
 assert.equal(invalid.status,'invalid_openapi');
 const error=await inspectOfficialCatalog(source,{fetchFn:async()=>{throw Error('CPF/SECRET');}});
 assert.equal(error.status,'network_unavailable');
 assert.equal(JSON.stringify({http,unavailable,invalid,error}).includes('CPF'),false);
});
test('resposta OpenAPI valida nao inclui documentos ou payload de dados',async()=>{
 const extra={...spec,paths:{...spec.paths,
  '/sensitive':{get:{description:'CPF 00011122233'}}},example:'SECRET',
  components:{examples:{sensitive:'R$ 200,00'}}};
 const output=await inspectOfficialCatalog(source,{
   fetchFn:async()=>new Response(JSON.stringify(extra),{
      headers:{'Content-Type':'application/json'}})});
 assert.equal(output.status,'openapi_available');
 for(const secret of ['SECRET','CPF','00011122233','R$ 200,00'])
   assert.equal(JSON.stringify(output).includes(secret),false);
});
test('somente fontes documentadas e timeout limitado podem ser inspecionados',async()=>{
 await assert.rejects(inspectOfficialCatalog({name:'SIAFI',
   url:'https://other.host/path',routes:['/saldos']}));
 await assert.rejects(inspectOfficialCatalog(source,{timeoutMs:120000}));
});

test('OpenAPI informa somente limites numericos seguros dos parametros',()=>{
 const pncp=API_CATALOG.find(s=>s.name==='PNCP');
 const api={paths:{'/v1/contratos/atualizacao':{get:{parameters:[
   {name:'tamanhoPagina',in:'query',required:false,
     schema:{type:'integer',minimum:10,maximum:500,description:'CPF 123'}},
   {name:'pagina',in:'query',required:true,schema:{minimum:-2,maximum:200000}},
 ]}}}};
 const r=summarizeOpenApi(api,pncp);
 assert.deepEqual(r.routes[0].query,[{name:'tamanhoPagina',required:false,
   minimum:10,maximum:500},{name:'pagina',required:true}]);
 assert.equal(JSON.stringify(r).includes('CPF'),false);
});
