import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 missingReferencedNe,chooseNeBatch,normalizeOriginalDetail,
 fetchCguOriginal,recoverReferencedNe,summarizeOriginalIssueFields,
 diagnoseOldestIssueDate
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

test('diagnostico separa fase, emissao e identidade sem registrar ID, CPF ou segredo',async()=>{
 await temporary(async root=>{
   const scenarios=[
     {payload:detail(note24,{fase:'Liquidacao'}),reason:'phase_unverified'},
     {payload:detail(note24,{data:'2026-01-01'}),reason:'issue_date_unverified'},
     {payload:detail(note24,{codigoUg:'158125'}),reason:'identity_mismatch'}
   ];
   for(const scenario of scenarios){
     const result=await recoverReferencedNe({root,now,token:'SEGREDO_CGU',
       limit:1,slot:0,fetchFn:async()=>json(scenario.payload),wait:async()=>{}});
     assert.equal(result.recovered,0);
     assert.deepEqual(result.failures,{[scenario.reason]:1});
     assert.equal(JSON.stringify(result).includes('SEGREDO_CGU'),false);
     assert.equal(JSON.stringify(result).includes(note24),false);
   }
 });
});

test('selecao exclusiva de 2025 nao consulta NE de 2024 bloqueada por data',async()=>{
 await temporary(async root=>{
   const seen=[];
   const result=await recoverReferencedNe({root,now,token:'SECRET',year:'2025',
     limit:5,slot:0,wait:async()=>{},fetchFn:async url=>{
       const id=url.split('/').pop();
       seen.push(id);
       assert.equal(id,note25);
       return json(detail(id,{data:'2025-08-07'}));
     }});
   assert.equal(result.missing,2);
   assert.equal(result.eligible,1);
   assert.deepEqual(result.selected,{'2025':1});
   assert.equal(result.recovered,1);
   assert.deepEqual(seen,[note25]);
   const data=JSON.parse(await readFile(join(root,'data','months','2025-08.json'),'utf8'));
   assert.equal(data.coverage[0].complete,false);
   assert.equal(data.coverage[0].reason,'consulta_individual');
   const plan=await recoverReferencedNe({root,now,year:'2025',dryRun:true});
   assert.equal(plan.eligible,0);
   assert.equal(plan.missing,1);
   const remaining=await recoverReferencedNe({root,now,token:'SECRET',
     year:'2025',fetchFn:async()=>{throw Error('Nao consultar novamente');}});
   assert.equal(remaining.status,'no_eligible');
   assert.equal(remaining.attempted,0);
   await assert.rejects(recoverReferencedNe({root,now,year:'2025NE',
     dryRun:true}),/Exercicio/);
 });
});
test('confronto de campos CGU expõe so relacao com o ano da NE',()=>{
 const check=summarizeOriginalIssueFields(note24,detail(note24,{
   data:'2025-02-01',dataEmissao:'2024-06-03',
   dataDocumento:'2024-06-02',fase:'Empenho'
 }),{now});
 assert.deepEqual(check.dateClasses,{
   data:'after_ne_year',dataEmissao:'same_ne_year',
   dataDocumento:'same_ne_year'
 });
 assert.equal(check.dataMatchesEmissao,false);
 assert.equal(check.identityConfirmed,true);
 assert.equal(check.phaseConfirmed,true);
 assert.equal(JSON.stringify(check).includes(note24),false);
 for(const raw of ['2025-02-01','2024-06-03','SECRET','CPF'])
   assert.equal(JSON.stringify(check).includes(raw),false);
 const noDate=summarizeOriginalIssueFields(note24,detail(note24,{
   data:null,dataEmissao:'31/02/2024',dataDocumento:undefined
 }),{now});
 assert.deepEqual(noDate.dateClasses,{
   data:'not_provided',dataEmissao:'invalid_or_unknown',
   dataDocumento:'not_provided'
 });
 const later=summarizeOriginalIssueFields(note24,detail(note24,{
   data:'2027-01-01'
 }),{now});
 assert.equal(later.dateClasses.data,'future');
});
test('diagnostico de 2024 consulta uma nota sem gravar resposta ou competencia',async()=>{
 await temporary(async root=>{
   const before=await readFile(join(root,'data','months','2026-11.json'),'utf8');
   let calls=0;
   const result=await diagnoseOldestIssueDate({root,now,token:'SECRET',
     fetchFn:async url=>{
       calls++;
       assert.equal(url.endsWith(note24),true);
       return json(detail(note24,{
         data:'2025-06-07',dataEmissao:'2024-06-03',
         observacao:'CPF 000.123.456-78'
       }));
     }});
   assert.equal(calls,1);
   assert.equal(result.status,'observed');
   assert.equal(result.sampled,1);
   assert.equal(result.dateClasses.data,'after_ne_year');
   assert.equal(result.dateClasses.dataEmissao,'same_ne_year');
   assert.equal(result.dataMatchesEmissao,false);
   assert.equal(JSON.stringify(result).includes(note24),false);
   assert.equal(JSON.stringify(result).includes('000.123.456-78'),false);
   assert.equal(await readFile(join(root,'data','months','2026-11.json'),'utf8'),before);
   const denied=await diagnoseOldestIssueDate({root,now,token:'SECRET',
     fetchFn:async()=>json('not found',404)});
   assert.deepEqual(denied,{status:'unavailable',sampled:1,reason:'http_404'});
 });
});

test('escopo mesmo exercicio seleciona somente NE vinculada de mesmo ano, nao futura ou orfa',()=>{
 const same=prefix+'2026NE000091',future=prefix+'2027NE000001';
 const m=references();
 m[0].relations.push({from:ns,to:same,cents:0},
   {from:ob,to:same,cents:100},{from:ns,to:future,cents:0},
   {from:prefix+'2026NS000099',to:prefix+'2026NE000092',cents:0});
 assert.deepEqual(missingReferencedNe(m,{scope:'same_year'}),[same]);
 assert.equal(missingReferencedNe(m,{scope:'all'}).length,4);
 assert.throws(()=>missingReferencedNe(m,{scope:'unknown'}));
 m[0].documents.push({id:same,date:'2026-10-10',phase:1});
 assert.deepEqual(missingReferencedNe(m,{scope:'same_year'}),[]);
});
test('recuperacao do mesmo exercicio usa origem confirmada e preserva cobertura parcial',async()=>{
 await temporary(async root=>{
   const path=join(root,'data','months','2026-11.json');
   const m=JSON.parse(await readFile(path,'utf8'));
   const same=prefix+'2026NE000091';
   m.relations.push({from:ns,to:same,cents:100});
   await writeFile(path,JSON.stringify(m));
   const seen=[];
   const plan=await recoverReferencedNe({root,now,scope:'same_year',dryRun:true});
   assert.equal(plan.missing,1);
   assert.equal(plan.attempted,0);
   const result=await recoverReferencedNe({root,now,scope:'same_year',
     token:'SECRET',slot:0,wait:async()=>{},fetchFn:async url=>{
       seen.push(url.split('/').pop());
       return json(detail(same,{data:'2026-10-10'}));
     }});
   assert.deepEqual(seen,[same]);
   assert.equal(result.recovered,1);
   const d=JSON.parse(await readFile(join(root,'data','months','2026-10.json'),'utf8'));
   assert.equal(d.coverage[0].complete,false);
   assert.equal(d.coverage[0].reason,'consulta_individual');
   assert.equal(JSON.stringify(result).includes(same),false);
   const repeat=await recoverReferencedNe({root,now,scope:'same_year',dryRun:true});
   assert.equal(repeat.missing,0);
 });
});
test('origem de impacto repetida com a mesma data nao gera conflito artificial',()=>{
 const m=references();
 assert.equal(missingReferencedNe([...m,...m]).length,3);
});
