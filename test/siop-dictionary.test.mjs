import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dictionaryQuery,normalizeDictionary,fetchDictionary,cacheDictionary} from '../src/siop-dictionary.mjs';
const now=new Date('2026-11-26T12:00:00Z');
const binding=(kind,code,label,action='')=>Object.fromEntries(
 Object.entries({kind,code,label,action}).map(([k,value])=>[k,{type:'literal',value}]));
const payload={results:{bindings:[
 binding('action','20RL','Funcionamento'),
 binding('budgetPlan','0000','Primeiro plano','20RL'),
 binding('budgetPlan','0000','Outro plano','2994'),
 binding('fundingSource','1000','Recursos livres')
]}};
test('consulta limitada a UO e exercicio, sem valores financeiros',()=>{
 const q=dictionaryQuery(2024,now);
 assert.match(q,/26422/);assert.match(q,/2024/);
 assert.match(q,/LIMIT 2501/);assert.doesNotMatch(q,/valorEmpenhado/);
 assert.throws(()=>dictionaryQuery(2023,now));assert.throws(()=>dictionaryQuery(2027,now));
});
test('PO preserva contexto da acao; zeros iniciais e descricoes distintos',()=>{
 const result=normalizeDictionary(payload,2026,now);
 assert.equal(result.rows.filter(r=>r.kind==='budgetPlan').length,2);
 assert.equal(result.rows.find(r=>r.kind==='fundingSource').code,'1000');
 assert.equal(result.uo,'26422');
 assert.throws(()=>normalizeDictionary({results:{bindings:[]}},2026,now));
 assert.throws(()=>normalizeDictionary({results:{bindings:Array(2501).fill(payload.results.bindings[0])}},2026,now));
});
test('conflito de rotulo nao e resolvido arbitrariamente',()=>{
 const r=normalizeDictionary({results:{bindings:[...payload.results.bindings,
  binding('budgetPlan','0000','Conflito','20RL')]}},2026,now);
 assert.equal(r.conflicts,1);
 assert.equal(r.rows.filter(x=>x.kind==='budgetPlan').length,1);
});
test('campo invalido e CPF integral bloqueiam cache',()=>{
 assert.throws(()=>normalizeDictionary({results:{bindings:[binding('action','20RL','CPF 111.222.333-44')]}},2026,now));
 assert.throws(()=>normalizeDictionary({results:{bindings:[binding('budgetPlan','0000','Plano','')]}},2026,now));
});
test('consulta e cache por exercicio evitam requisicoes repetidas; HTTP falha',async()=>{
 const root=await mkdtemp(join(tmpdir(),'siop-test-'));
 let calls=0;
 const fetchFn=async(url,options)=>{calls++;assert.match(url,/siop\.planejamento\.gov\.br/);
  assert.equal(options.method,'GET');assert.ok(new URL(url).searchParams.get('query'));return new Response(JSON.stringify(payload));};
 try{
  assert.equal((await cacheDictionary(2026,{root,now,fetchFn})).status,'fetched');
  assert.equal((await cacheDictionary(2026,{root,now,fetchFn})).status,'cache_hit');
  assert.equal(calls,1);
  await assert.rejects(fetchDictionary(2026,{now,fetchFn:async()=>new Response('unavailable',{status:503})}));
 }finally{await rm(root,{recursive:true,force:true});}
});
