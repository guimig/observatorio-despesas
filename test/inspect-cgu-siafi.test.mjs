import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  docType,detailUrl,relatedUrl,impactUrl,itemHistoryUrl,
  structuralFields,classifyMovement,summarizeItems,summarizeImpacts,
  selectSamples,inspectDocumentDetails,inspectCguSample
} from '../src/inspect-cgu-siafi.mjs';
const prefix='158459264222026';
const ne=prefix+'NE000111';
const ns=prefix+'NS000001';
const ob=prefix+'OB000001';
const df=prefix+'DF800001';
const out=prefix+'NE000112';

test('URLs CGU obrigam UG 158459, fase adequada e sequência válida',()=>{
 assert.equal(new URL(detailUrl(ne)).pathname,
  '/api-de-dados/despesas/documentos/'+ne);
 assert.equal(new URL(relatedUrl(ns,2)).searchParams.get('fase'),'2');
 assert.equal(new URL(impactUrl(df,3)).searchParams.get('fase'),'3');
 assert.equal(new URL(itemHistoryUrl(ne,2)).searchParams.get('sequencial'),'2');
 assert.throws(()=>detailUrl('158125264222026NE000111'));
 assert.throws(()=>relatedUrl(ns,3));
 assert.throws(()=>impactUrl(ne,2));
 assert.throws(()=>itemHistoryUrl(ne,0));
 assert.deepEqual([docType(ne),docType(ns),docType(ob),docType(df)],
  ['NE','NS','OB','DF']);
});
test('estrutura nunca inclui valores, favorecido nem CPF de origem',()=>{
 const data={documento:ne,cpf:'000.123.456-78',favorecido:'PESSOA FÍSICA',
  value:20,detalhes:{cpf:'000.123.456-78'},
  '000.123.456-78':'não deve aparecer'};
 const schema=structuralFields(data);
 assert.ok(schema.includes('documento:string'));
 assert.ok(schema.includes('cpf:string'));
 const published=JSON.stringify(schema);
 assert.equal(published.includes(ne),false);
 assert.equal(published.includes('000.123.456-78'),false);
 assert.equal(published.includes('PESSOA FÍSICA'),false);
});
test('operações históricas são classificadas sem copiar observação livre',()=>{
 const data=[
  {operacao:'Emissão original',valorTotal:'100',nome:'NOME PRIVADO'},
  {operacao:'Reforço',valorTotal:'50'},
  {operacao:'Anulação',valorTotal:'-10'},
  {operacao:'Cancelamento',valorTotal:'-15'},
  {operacao:'Estorno',valorTotal:'-4'},
  {operacao:'Operação desconhecida'}
 ];
 const summary=summarizeItems(data);
 assert.equal(summary.count,6);
 assert.deepEqual(summary.operations,{original:1,reinforcement:1,annulment:1,
  cancellation:1,reversal:1,other:1,unknown:0});
 assert.equal(JSON.stringify(summary).includes('NOME PRIVADO'),false);
});
test('1 NS pode impactar diversas NEs e a amostra conta distintos sem expor IDs',()=>{
 const samples=[
   {empenho:ne,valorLiquidado:'10,00',cpf:'000.123.456-78'},
   {empenho:out,valorLiquidado:'-2,00'},
   {empenho:out,valorLiquidado:'5,00'},
   {empenho:'158460264222026NE000111'}
 ];
 const summary=summarizeImpacts(samples);
 assert.deepEqual({count:summary.count,uniqueNe:summary.uniqueNe,
  missingNe:summary.missingNe,negativeRows:summary.negativeRows},
  {count:4,uniqueNe:2,missingNe:1,negativeRows:1});
 assert.equal(JSON.stringify(summary).includes('000.123.456-78'),false);
 assert.equal(JSON.stringify(summary).includes(ne),false);
 assert.equal(summary.pageOnly,true);
});
test('seleção prioriza NS com 2+ empenhos vinculados e NE com itens',()=>{
 const month={
  documents:[
   {id:prefix+'NS000002',phase:2},
   {id:ns,phase:2},
   {id:ne,phase:1},{id:ob,phase:3},{id:df,phase:3}
  ],
  relations:[
   {from:ns,to:ne,cents:100},
   {from:ns,to:out,cents:200}
  ],
  itemsByDocument:{[ne]:[{seq:3}]}
 };
 const chosen=selectSamples(month);
 assert.deepEqual(chosen.map(x=>x.kind),['NE','NS','OB','DF']);
 assert.equal(chosen.find(x=>x.kind==='NS').id,ns);
 assert.equal(chosen[0].seq,3);
});
test('amostra pública real seleciona somente espécies da UG 158459',async()=>{
 const data=JSON.parse(await readFile(
  new URL('../data/months/2026-11.json',import.meta.url),'utf8'));
 const samples=selectSamples(data);
 assert.ok(samples.length>=3);
 assert.ok(samples.every(x=>x.id.startsWith('15845926422')));
 assert.ok(samples.some(x=>x.kind==='NS'&&
  new Set(data.relations.filter(l=>l.from===x.id).map(l=>l.to)).size>1));
});
test('detalhe autenticado envia token no cabeçalho e não registra CPF',async()=>{
 let called=0;
 const result=await inspectDocumentDetails(ne,{token:'TOKEN_TESTE',
  fetcher:async(url,options)=>{
   called++;
   assert.equal(url,detailUrl(ne));
   assert.equal(options.headers['chave-api-dados'],'TOKEN_TESTE');
   return {ok:true,status:200,json:async()=>({
    documento:ne,credor:'NOME PESSOA',
    cpf:'000.123.456-78',valor:'1.000,00'
   })};
  }});
 assert.equal(called,1);
 assert.equal(result.status,'ok');
 const serialized=JSON.stringify(result);
 assert.equal(serialized.includes(ne),false);
 assert.equal(serialized.includes('000.123.456-78'),false);
 assert.equal(serialized.includes('NOME PESSOA'),false);
 assert.equal(serialized.includes('TOKEN_TESTE'),false);
});
test('erro da CGU reduzido ao código HTTP sem dados privados',async()=>{
 const result=await inspectDocumentDetails(ne,{
  token:'SECRETO',fetcher:async()=>({ok:false,status:403})
 });
 assert.deepEqual(result,{status:'HTTP 403'});
 await assert.rejects(inspectDocumentDetails(ne,{token:''}),/CGU_API_KEY/);
});
test('sondagem integrada NS usa fase 2, sem gravar valores/IDs',async()=>{
 const accessed=[];
 const result=await inspectCguSample({id:ns,phase:2,kind:'NS'},{
  token:'SEGREDO',
  detail:async()=>({status:'ok',fields:['documento:string']}),
  request:async(url)=>{
   accessed.push(url);
   return url.includes('empenhos-impactados')?
    [{empenho:ne,valorLiquidado:'100,00'}]:
    [{documento:ob,cpf:'000.123.456-78'}];
  }
 });
 assert.equal(result.kind,'NS');
 assert.equal(result.related.count,1);
 assert.equal(result.impacts.uniqueNe,1);
 assert.equal(accessed.length,2);
 assert.ok(accessed.some(url=>url.includes('fase=2')));
 const printable=JSON.stringify(result);
 for(const sensitive of [ns,ne,ob,'000.123.456-78','SEGREDO','100,00']){
  assert.equal(printable.includes(sensitive),false);
 }
});

test('entrypoint executa mesmo sem credencial e falha explicitamente, sem chamada de rede',()=>{
  const file=fileURLToPath(new URL('../src/inspect-cgu-siafi.mjs',import.meta.url));
  const outcome=spawnSync(process.execPath,[file],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),
    env:{...process.env,CGU_API_KEY:''},
    encoding:'utf8',timeout:5000
  });
  assert.equal(outcome.status,1);
  const output=outcome.stdout+outcome.stderr;
  assert.match(output,/Secret CGU_API_KEY ausente/);
  assert.equal(output.includes('undefined'),false);
});
