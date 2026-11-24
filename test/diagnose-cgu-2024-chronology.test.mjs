import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 checkEmissionListing,summarizeChronologyEvents,diagnoseCgu2024Chronology
} from '../src/diagnose-cgu-2024-chronology.mjs';

const prefix='15845926422';
const ne=prefix+'2024NE000123',ns=prefix+'2026NS000013';
const now=new Date('2026-11-23T18:00:00Z');
const sources=[{documents:[{id:ns,phase:2,date:'2026-11-10'}],
 relations:[{from:ns,to:ne,cents:12345}],itemsByDocument:{}}];
const detail={
 documento:ne,codigoUg:'158459',fase:'Empenho',data:'2025-02-17',
 observacao:'CPF 000.111.222-33 conta bancaria 000001',valor:'12345,00'
};
const makeMovement=(date,type,extra={})=>({
 date,type,operation:'Inclusao',quantity:'1',unitPrice:'12345',cents:1234500,...extra
});
const dayRow=(extra={})=>({
 documento:ne,codigoUg:'158459',fase:'Empenho',
 data:'15/05/2024',valor:'12345,00',
 observacao:'Nao armazenar CPF 123.123.123-00',...extra
});
const baseOpts={
 sources,token:'SECRETO',now,
 requestDetail:async id=>{assert.equal(id,ne);return detail;},
 resolveItemsFn:async()=>({ok:true,items:[{seq:1},{seq:2}]}),
 resolveHistoryFn:async(id,seq)=>({ok:true,movements:seq===1?
   [makeMovement('2024-05-15','original'),
    makeMovement('2025-02-17','reinforcement')]:
   [makeMovement('2024-05-15','original')]}),
 requestDayFn:async(date,phase,page)=>{
   assert.equal(date,'15/05/2024');
   assert.equal(phase,1);
   assert.equal(page,1);
   return [dayRow()];
 }
};
test('confronto oficial por dataEmissao e id exato nao altera documento original',async()=>{
 const result=await diagnoseCgu2024Chronology(baseOpts);
 assert.equal(result.status,'observed');
 assert.equal(result.pending,1);
 assert.equal(result.detail.dateClasses.data,'after_ne_year');
 assert.equal(result.items.total,2);
 assert.equal(result.items.unexamined,0);
 assert.equal(result.history.completed,2);
 assert.equal(result.history.originalYearEvents,2);
 assert.equal(result.history.otherTypeEvents,1);
 assert.equal(result.listing.candidateDaysObserved,1);
 assert.equal(result.listing.exactMatches,1);
 assert.equal(result.listing.candidateDaysChecked,1);
 assert.equal(result.assessment,'listing_corrob_or_requires_review');
 assert.equal(result.originRecorded,false);
 const serialized=JSON.stringify(result);
 for(const sensitive of [ne,'SECRETO','2024-05-15','15/05/2024',
   '2025-02-17','000.111.222-33','12345'])
   assert.equal(serialized.includes(sensitive),false);
});
test('consulta de dia com UG e fase divergentes nao comprova emissao',async()=>{
 const responses=[
   [dayRow({codigoUg:'158125'})],
   [dayRow({fase:'Pagamento'})],
   [dayRow({documento:prefix+'2024NE000124'})],
   []
 ];
 let page=0;
 const outcome=await checkEmissionListing(ne,'2024-05-15',{
   token:'SECRET',
   requestDayFn:async()=>{
     const r=responses[page];
     page++;
     return r;
   }
 });
 assert.equal(outcome.status,'complete_no_match');
 assert.equal(outcome.matched,false);
 assert.equal(outcome.rowsChecked,3);
 assert.equal(page,4);
});
test('fonte incompleta, paginas repetidas e rate limit nao viram data confirmada',async()=>{
 const incomplete=await checkEmissionListing(ne,'2024-05-15',{
   token:'SECRET',maxPages:2,requestDayFn:async()=>[
     dayRow({documento:prefix+'2024NE000130'}),
     dayRow({documento:prefix+'2024NE000131'})
   ]});
 assert.equal(incomplete.status,'repeated_page');
 const many=await checkEmissionListing(ne,'2024-05-15',{
   token:'SECRET',maxPages:2,requestDayFn:async(_day,_phase,page)=>[
     dayRow({documento:prefix+'2024NE'+String(100+page).padStart(6,'0')})
   ]});
 assert.equal(many.status,'pagination_incomplete');
 const denied=await checkEmissionListing(ne,'2024-05-15',{
   token:'SECRET',requestDayFn:async()=>{throw Error('CPF 000.111.222-33');}
 });
 assert.deepEqual(denied,{status:'source_unavailable',rowsChecked:0,matched:false});
 const invalid=await checkEmissionListing(ne,'2024-05-15',{
   token:'SECRET',requestDayFn:async()=>({data:[]})
 });
 assert.equal(invalid.status,'invalid_page');
 assert.throws(()=>checkEmissionListing(ne,'2025-01-01'),/incompatível/);
});
test('historico de item sozinho nao autoriza data de emissao',async()=>{
 let listCalls=0;
 const result=await diagnoseCgu2024Chronology({
   ...baseOpts,resolveHistoryFn:async()=>({ok:true,movements:[
     makeMovement('2025-02-17','original'),
     makeMovement('2024-03-01','annulment')
   ]}),
   requestDayFn:async()=>{listCalls++;return [];}
 });
 assert.equal(result.history.laterYearOriginalEvents,2);
 assert.equal(result.history.originalYearEvents,0);
 assert.equal(result.history.otherTypeEvents,2);
 assert.equal(result.listing.candidateDaysObserved,0);
 assert.equal(result.assessment,'no_original_date_candidate');
 assert.equal(listCalls,0);
});
test('historicos incompletos e mais de dois dias sao identificados como amostra',async()=>{
 const visited=[];
 const result=await diagnoseCgu2024Chronology({
   ...baseOpts,
   resolveItemsFn:async()=>({ok:true,items:
     Array.from({length:7},(_,i)=>({seq:i+1}))}),
   resolveHistoryFn:async(_id,seq)=>{
     if(seq===7)return {ok:false,reason:'limite_paginacao'};
     return {ok:true,movements:[makeMovement(
       seq===1?'2024-01-15':seq===2?'2024-02-20':'2024-03-02','original'
     )]};
   },
   requestDayFn:async(day)=>{visited.push(day);return [];}
 });
 assert.equal(result.items.examined,4);
 assert.equal(result.items.unexamined,3);
 assert.equal(result.history.completed,3);
 assert.equal(result.history.unavailable,1);
 assert.deepEqual(result.history.failures,{limite_paginacao:1});
 assert.equal(result.listing.candidateDaysObserved,3);
 assert.equal(result.listing.candidateDaysChecked,2);
 assert.deepEqual(visited,['15/01/2024','20/02/2024']);
 assert.equal(result.assessment,'item_history_only_not_issuance_proof');
 assert.equal(JSON.stringify(result).includes('15/01/2024'),false);
});
test('retorno vazio da consulta de itens preserva origem nao concluida',async()=>{
 const r=await diagnoseCgu2024Chronology({...baseOpts,
   resolveItemsFn:async()=>({ok:false,reason:'limite_paginacao'}),
   requestDayFn:async()=>{throw Error('Nao consultar listagem');}
 });
 assert.equal(r.status,'items_unavailable');
 assert.equal(r.reason,'limite_paginacao');
 assert.equal(r.detail.dateClasses.data,'after_ne_year');
});
test('sem pendencia ou com mais de uma NE nao consulta API',async()=>{
 const empty=await diagnoseCgu2024Chronology({sources:[{
   documents:[],relations:[],itemsByDocument:{}
 }]});
 assert.deepEqual(empty,{status:'no_2024_pending',pending:0});
 const many=[{documents:[{id:ns,phase:2,date:'2026-11-10'}],
   relations:[
     {from:ns,to:ne},
     {from:ns,to:prefix+'2024NE000124'}
   ]}];
 const other=await diagnoseCgu2024Chronology({sources:many});
 assert.deepEqual(other,{status:'ambiguous_2024_pending',pending:2});
});
test('diagnostico somente leitura nao modifica arquivos do acervo',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cgu-2024-chronology-'));
 try{
   await mkdir(join(root,'data/months'),{recursive:true});
   const file=join(root,'data/months/2026-11.json');
   const original=JSON.stringify(sources[0]);
   // Sources injetadas sao usadas exclusivamente em memoria.
   await writeFile(file,original);
   const result=await diagnoseCgu2024Chronology({...baseOpts,root});
   assert.equal(result.status,'observed');
   assert.equal(await readFile(file,'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
