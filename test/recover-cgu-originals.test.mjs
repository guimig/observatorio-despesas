import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 missingReferencedNe,chooseNeBatch,normalizeOriginalDetail,
 fetchCguOriginal,recoverReferencedNe
} from '../src/recover-cgu-originals.mjs';
import {applyTargetedOriginal,emptyMonth,mergeMonth,validateMonth}
 from '../src/store.mjs';

const prefix='15845926422',note24=prefix+'2024NE000001',
 note24b=prefix+'2024NE000002',note25=prefix+'2025NE000003',
 ns=prefix+'2026NS000001',ob=prefix+'2026OB000002';
const now=new Date('2026-11-23T19:00:00Z');
const listing=(docs,links=[])=>({
 documents:docs,relations:links,coverage:[],
 itemsByDocument:{}
});
const references=()=>[
 listing([{id:ns,date:'2026-11-21',phase:2},
   {id:ob,date:'2026-11-21',phase:3}],
  [{from:ns,to:note24,cents:100},
   {from:ob,to:note25,cents:200},
   {from:ns,to:note24b,cents:300},
   {from:ns,to:note24,cents:100}])
];
function detail(id=note24,overrides={}){
 return {
  documento:id,codigoUg:'158459',data:'2024-06-03',
  fase:'Empenho',valor:'123,45',numeroProcesso:'23349.001234/2024-01',
  observacao:'Aquisicao material permanente',
  codigoFavorecido:'12.345.678/0001-90',
  nomeFavorecido:'Fornecedor de Teste Ltda.',
  ...overrides
 };
}
const json=(body,status=200)=>new Response(
 typeof body==='string'?body:JSON.stringify(body),{status});
async function temporary(callback){
 const root=await mkdtemp(join(tmpdir(),'cgu-ne-original-'));
 try{
   await mkdir(join(root,'data','months'),{recursive:true});
   const m=emptyMonth('2026-11');
   const nsDoc={id:ns,date:'2026-11-21',phase:2,cents:100};
   const obDoc={id:ob,date:'2026-11-21',phase:3,cents:200};
   // Uma fase por lote; o acervo real tem cobertura independente.
   const valid=mergeMonth(emptyMonth('2026-11'),'2026-11',[{
     documents:[nsDoc],links:[{from:ns,to:note24,cents:100}],
     coverage:{date:'2026-11-21',phase:2,complete:true,count:1,invalid:0}
   },{
     documents:[obDoc],links:[{from:ob,to:note25,cents:200}],
     coverage:{date:'2026-11-21',phase:3,complete:true,count:1,invalid:0}
   }],now).data;
   await writeFile(join(root,'data','manifest.json'),JSON.stringify({
     schema_version:1,unit:'158459',status:'dados_publicados',months:['2026-11']
   })+'\n');
   await writeFile(join(root,'data','months','2026-11.json'),
     JSON.stringify(valid)+'\n');
   await callback(root);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('11 NEs antigas são selecionadas por relacao CGU e não pelo montante',()=>{
 const more=Array.from({length:8},(_,i)=>prefix+'2025NE'+
   String(i+10).padStart(6,'0'));
 const origins=references();
 for(const target of more)origins[0].relations.push({from:ob,to:target,cents:0});
 const selected=missingReferencedNe(origins);
 assert.equal(selected.length,11);
 assert.equal(selected.filter(x=>x.slice(11,15)==='2024').length,2);
 assert.equal(selected.filter(x=>x.slice(11,15)==='2025').length,9);
 assert.deepEqual(chooseNeBatch(selected,{limit:3,slot:0}),selected.slice(0,3));
 assert.deepEqual(chooseNeBatch(selected,{limit:3,slot:1}),selected.slice(3,6));
 assert.throws(()=>chooseNeBatch(selected,{limit:6}));
});
test('nota original ja presente na lista nao volta ao lote e referencia futura e ignorada',()=>{
 const withOrigin=[...references(),listing([{id:note24,date:'2024-06-03',phase:1}],[])];
 assert.deepEqual(missingReferencedNe(withOrigin),[note24b,note25]);
 const sameYear=prefix+'2026NE000091';
 const d=listing([{id:ns,date:'2026-11-21',phase:2}],
   [{from:ns,to:sameYear,cents:100}]);
 assert.deepEqual(missingReferencedNe([d]),[]);
});
test('identidade UG, fase, ano e data de emissao sao obrigatorios',()=>{
 const normalized=normalizeOriginalDetail(note24,detail(),{now});
 assert.deepEqual({id:normalized.id,date:normalized.date,phase:normalized.phase,
   cents:normalized.cents},{id:note24,date:'2024-06-03',phase:1,cents:12345});
 assert.equal(normalized.description,'Aquisicao material permanente');
 for(const override of [{codigoUg:'158125'},{documento:note24b},
   {fase:'Pagamento'},{data:'2026-11-22'},{data:'2024-02-30'},
   {data:'2027-01-01'},{dataEmissao:'04/06/2024'}]){
   assert.throws(()=>normalizeOriginalDetail(note24,detail(note24,override),{now}));
 }
 assert.equal(normalizeOriginalDetail(note24,detail(note24,{
   data:'03/06/2024',dataEmissao:'2024-06-03'
 }),{now}).date,'2024-06-03');
});
test('consulta autenticada por codigo nao registra cabecalho ou payload em logs',async()=>{
 let call=0;
 const result=await fetchCguOriginal(note24,{
  token:'TOKEN_PRIVADO',fetchFn:async(url,options)=>{
   call++;
   assert.equal(url.endsWith(note24),true);
   assert.equal(options.headers['chave-api-dados'],'TOKEN_PRIVADO');
   assert.equal(options.redirect,'error');
   assert.equal(url.includes('TOKEN_PRIVADO'),false);
   return json(detail(note24,{observacao:'CPF 123.456.789-00'}));
  }
 });
 assert.equal(call,1);
 assert.equal(result.documento,note24);
});
test('HTTP 404, resposta grande, esquema invalido e rate-limit falham fechado',async()=>{
 const missing=()=>fetchCguOriginal(note24,{token:'SECRET',
   fetchFn:async()=>json('missing',404)});
 await assert.rejects(missing(),e=>e.status===404);
 await assert.rejects(fetchCguOriginal(note24,{token:'SECRET',
   fetchFn:async()=>json('X'.repeat(300000))
 }),e=>e.code==='too_large');
 await assert.rejects(fetchCguOriginal(note24,{token:'SECRET',
   fetchFn:async()=>json([{documento:note24}])
 }),e=>e.code==='invalid_shape');
 let tries=0;
 const wait=[];
 const success=await fetchCguOriginal(note24,{token:'SECRET',
   fetchFn:async()=>{
     tries++;return tries===1?json('throttle',429):json(detail());
   },wait:async n=>wait.push(n)});
 assert.equal(tries,2);
 assert.deepEqual(wait,[1500]);
 assert.equal(success.documento,note24);
});
test('insercao individual preserva todos os documentos anteriores e dia incompleto',()=>{
 let d=emptyMonth('2024-06');
 const doc=normalizeOriginalDetail(note24,detail(),{now});
 d=applyTargetedOriginal(d,doc,now).data;
 assert.equal(d.documents.length,1);
 assert.deepEqual(d.coverage,[{date:'2024-06-03',phase:1,
   complete:false,count:1,invalid:0,reason:'consulta_individual'}]);
 assert.ok(d.beneficiaries?.['12345678000190']);
 assert.equal(applyTargetedOriginal(d,doc,now).changed,false);
 assert.doesNotThrow(()=>validateMonth(d));
 const second=normalizeOriginalDetail(note24b,detail(note24b),{now});
 d=applyTargetedOriginal(d,second,now).data;
 assert.equal(d.coverage[0].count,2);
 assert.equal(d.documents.length,2);
 // Nova resposta parcial sem a NE individual nao pode exclui-la.
 const partial=mergeMonth(d,'2024-06',[{
   coverage:{date:'2024-06-03',phase:1,complete:false,count:1,
     invalid:0,reason:'limite_paginas'},
   documents:[doc],links:[]
 }],now);
 assert.equal(partial.data.documents.length,2);
 assert.equal(partial.changed,false);
});
test('dia previamente completo mas sem NE individual gera conflito',()=>{
 const existing=mergeMonth(emptyMonth('2024-06'),'2024-06',[{
   documents:[],links:[],coverage:{date:'2024-06-03',
     phase:1,complete:true,count:0,invalid:0}
 }],now).data;
 assert.throws(()=>applyTargetedOriginal(existing,
   normalizeOriginalDetail(note24,detail(),{now}),now),/ja completo/);
});
test('rotina realista grava competencia antiga com cobertura parcial e sem duplicata',async()=>{
 await temporary(async root=>{
   let calls=0;
   const output=await recoverReferencedNe({root,token:'SECRET',now,slot:0,
     limit:2,fetchFn:async url=>{
       calls++;
       const id=url.split('/').pop();
       return json(detail(id,{data:id===note25?'2025-08-07':'2024-06-03'}));
     },wait:async()=>{}});
   assert.equal(output.recovered,2);
   assert.equal(output.status,'complete');
   assert.equal(output.missing,2);
   assert.equal(calls,2);
   assert.equal(JSON.stringify(output).includes(note24),false);
   assert.equal(JSON.stringify(output).includes('SECRET'),false);
   const manifest=JSON.parse(await readFile(join(root,'data','manifest.json'),'utf8'));
   assert.deepEqual(manifest.months,['2024-06','2025-08','2026-11']);
   for(const target of ['2024-06','2025-08']){
     const data=JSON.parse(await readFile(join(root,'data','months',target+'.json'),'utf8'));
     assert.equal(data.documents.length,1);
     assert.equal(data.coverage[0].complete,false);
     assert.equal(data.coverage[0].reason,'consulta_individual');
   }
   const repeated=await recoverReferencedNe({root,token:'SECRET',now,
     fetchFn:async()=>{throw Error('Nao chamar API de novo');}});
   assert.equal(repeated.missing,0);
   assert.equal(repeated.attempted,0);
   assert.equal(repeated.recovered,0);
 });
});
test('falha por documento nao publica origem inventada nem apaga relacoes',async()=>{
 await temporary(async root=>{
   const before=await readFile(join(root,'data','months','2026-11.json'),'utf8');
   const plan=await recoverReferencedNe({root,now,limit:2,dryRun:true});
   assert.equal(plan.missing,2);
   assert.equal(plan.attempted,0);
   const result=await recoverReferencedNe({root,token:'SECRET',now,limit:2,
     fetchFn:async()=>json('nao encontrado',404),wait:async()=>{}});
   assert.equal(result.recovered,0);
   assert.deepEqual(result.failures,{http_404:2});
   assert.equal(await readFile(join(root,'data','months','2026-11.json'),'utf8'),
     before);
   const manifest=JSON.parse(await readFile(join(root,'data','manifest.json'),'utf8'));
   assert.deepEqual(manifest.months,['2026-11']);
 });
});
