import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 IMPACT_FIELDS,summarizeImpactFields,selectRapSamples,inspectRapImpacts,auditRapSample,impactCommitmentYearGroup
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
 await assert.rejects(inspectRapImpacts(old,2,base));
});
test('amostra real do acervo contem referencias de ano anterior',async()=>{
 const month=JSON.parse(await readFile(new URL('../data/months/2026-11.json',import.meta.url),'utf8'));
 const samples=selectRapSamples([{month:'2026-11',data:month}]);
 assert.ok(samples.some(s=>s.priorYearReference));
 assert.ok(samples.every(s=>s.phase===2||s.phase===3));
});

test('coortes exigem codigo SIAFI completo e distinguem exercicios sem deduzir RP',()=>{
 const same={empenho:current,valorRestoPago:'10,00'};
 const previous={empenho:old,valorRestoPago:'15,00'};
 const future={empenho:'158459264222027NE000001',valorRestoPago:'20,00'};
 const unknown={empenho:'2025NE000001',valorRestoPago:'500,00'};
 assert.deepEqual([previous,same,future,unknown].map(row=>
   impactCommitmentYearGroup(row,2026)),['prior','same','future','unknown']);
 const result=summarizeImpactFields([previous,same,future,unknown],{documentYear:2026});
 assert.deepEqual(Object.fromEntries(Object.entries(result.byCommitmentYear).map(
   ([key,value])=>[key,value.rows])),{prior:1,same:1,future:1,unknown:1});
 assert.equal(result.byCommitmentYear.prior.fields.valorRestoPago.positive,1);
 assert.equal(JSON.stringify(result).includes('500,00'),false);
});

test('coortes em varias paginas acumulam somente estatisticas, nunca identificadores',async()=>{
 let page=0;
 const result=await inspectRapImpacts(ob,3,{token:'SECRET',
   request:async()=>{
     page++;
     if(page===1)return [{empenho:old,valorRestoPago:'15,00'},
       {empenho:'NE000001',valorRestoPago:'2,00'}];
     if(page===2)return [{empenho:current,valorPago:'8,00'}];
     return [];
   }
 });
 assert.equal(result.status,'complete');
 assert.equal(result.rows,3);
 assert.equal(result.byCommitmentYear.prior.rows,1);
 assert.equal(result.byCommitmentYear.same.rows,1);
 assert.equal(result.byCommitmentYear.unknown.rows,1);
 assert.equal(result.byCommitmentYear.prior.fields.valorRestoPago.positive,1);
 for(const secret of [old,current,'15,00','8,00','SECRET'])
   assert.equal(JSON.stringify(result).includes(secret),false);
});

test('amostragem ampliada cobre NS, OB, DF interanuais e controle contemporaneo',()=>{
 const docs=[],relations=[];
 for(const kind of ['NS','OB','DF']){
   for(let i=1;i<=5;i++){
     const id=prefix+kind+String(i).padStart(6,'0');
     docs.push({id,phase:kind==='NS'?2:3});
     relations.push({from:id,to:i<=3?old:current});
   }
 }
 const fixture={month:'2026-11',data:{documents:docs,relations}};
 const samples=selectRapSamples([fixture],{max:18});
 assert.equal(samples.length,15);
 assert.equal(new Set(samples.map(s=>s.id)).size,15);
 assert.deepEqual([...new Set(samples.map(s=>s.kind))].sort(),['DF','NS','OB']);
 assert.equal(samples.filter(s=>s.priorYearReference).length,9);
 assert.equal(samples.filter(s=>!s.priorYearReference).length,6);
 assert.throws(()=>selectRapSamples([fixture],{max:25}));
});
