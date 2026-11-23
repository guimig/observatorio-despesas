import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 IMPACT_FIELDS,summarizeImpactFields,selectRapSamples,inspectRapImpacts,auditRapSample
} from '../src/inspect-cgu-rap.mjs';
const prefix='158459264222026';
const ns=prefix+'NS000001';
const ob=prefix+'OB000001';
const old='158459264222025NE000001';
const current=prefix+'NE000002';
const fixture={month:'2026-11',data:{documents:[
 {id:ns,phase:2},{id:ob,phase:3}
],relations:[
 {from:ns,to:old,cents:100},{from:ns,to:current,cents:200},
 {from:ob,to:old,cents:300}
]}};
test('campos RP preservam ausencia, zero, positivo, negativo e invalido sem totais',()=>{
 const rows=[
  {valorLiquidado:'1.000,00',valorPago:'0',valorRestoInscrito:'10,00',
   valorRestoCancelado:'-2,00',valorRestoPago:'NA'},
  {valorLiquidado:null,valorPago:'20',valorRestoPago:'0'}
 ];
 const output=summarizeImpactFields(rows);
 assert.equal(output.rows,2);
 assert.equal(output.fields.valorLiquidado.positive,1);
 assert.equal(output.fields.valorLiquidado.missing,1);
 assert.equal(output.fields.valorPago.zero,1);
 assert.equal(output.fields.valorRestoInscrito.missing,1);
 assert.equal(output.fields.valorRestoCancelado.negative,1);
 assert.equal(output.fields.valorRestoPago.invalid,1);
 assert.equal(output.fields.valorRestoPago.zero,1);
 assert.equal(JSON.stringify(output).includes('1.000,00'),false);
 assert.deepEqual(Object.keys(output.fields),[...IMPACT_FIELDS]);
});
test('seleciona NS e OB com vinculo anterior sem classificar como RP',()=>{
 const list=selectRapSamples([fixture]);
 assert.equal(list.length,2);
 assert.equal(list[0].kind,'NS');
 assert.equal(list[0].priorYearReference,true);
 assert.equal(list[0].sameYearReference,true);
 assert.equal(list[1].kind,'OB');
 assert.equal(list[1].priorYearReference,true);
 assert.throws(()=>selectRapSamples([{month:'2026-11',data:{}}]));
});
test('paginas CGU completas, inclusive valores faltantes, nao produzem saldos',async()=>{
 let pages=0;
 const audit=await auditRapSample(selectRapSamples([fixture])[0],{
  token:'SECRET',request:async(url,{token})=>{
   assert.equal(token,'SECRET');
   assert.match(url,/fase=2/);
   pages++;
   return pages===1?[{valorRestoPago:'17,02',valorRestoInscrito:'30,50'}]:[];
  }
 });
 assert.equal(audit.impacts.status,'complete');
 assert.equal(audit.impacts.complete,true);
 assert.equal(audit.impacts.rows,1);
 assert.equal(audit.impacts.fields.valorRestoPago.positive,1);
 const printed=JSON.stringify(audit);
 for(const privateValue of [ns,old,'17,02','30,50','SECRET'])
   assert.equal(printed.includes(privateValue),false);
});
test('API vazia nao significa sem RP; limite, repeticao e falha sao parciais',async()=>{
 const base={token:'SECRET'};
 const empty=await inspectRapImpacts(ns,2,{...base,request:async()=>[]});
 assert.equal(empty.status,'empty');
 assert.equal(empty.impacts,undefined);
 const repeated=await inspectRapImpacts(ns,2,{...base,request:async()=>[{valorRestoPago:'2,00'}]});
 assert.equal(repeated.status,'unavailable');
 assert.equal(repeated.reason,'repeated_page');
 const partial=await inspectRapImpacts(ns,2,{...base,maxPages:1,
  request:async()=>[{valorRestoPago:'2,00'}]});
 assert.equal(partial.status,'partial');
 assert.equal(partial.complete,false);
 const fail=await inspectRapImpacts(ns,2,{...base,
  request:async()=>{const e=Error('private CPF');e.status=429;throw e;}});
 assert.equal(fail.reason,'http_429');
 assert.equal(JSON.stringify(fail).includes('CPF'),false);
 assert.throws(()=>inspectRapImpacts(old,2,base));
});
test('amostra real do acervo contem referencias de ano anterior',async()=>{
 const month=JSON.parse(await readFile(new URL('../data/months/2026-11.json',import.meta.url),'utf8'));
 const samples=selectRapSamples([{month:'2026-11',data:month}]);
 assert.ok(samples.some(s=>s.priorYearReference));
 assert.ok(samples.every(s=>s.phase===2||s.phase===3));
});
