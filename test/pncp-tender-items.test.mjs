import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchTenderItems,normalizeTenderItem} from '../src/pncp-tender-items.mjs';
import {planTenderItems,validateTenderCatalog} from '../src/collect-pncp-tender-items.mjs';
const pncpId='10635424000186-1-000001/2026',notice={pncpId,srp:true};
const row=(n)=>({numeroItem:n,descricao:'Material de consumo',quantidade:5});
test('pagina todos os itens e nao infere saldo',async()=>{
 const items=await fetchTenderItems(pncpId,{fetcher:async url=>url.includes('pagina=1')?
  {data:[row(1)],totalPaginas:2}:{data:[row(2)],totalPaginas:2}});
 assert.equal(items.length,2);assert.equal(items[0].scope,'ifc_tendered');
 assert.equal(items[0].available,undefined);
});
test('descarta respostas incompletas e duplicadas',async()=>{
 await assert.rejects(fetchTenderItems(pncpId,{fetcher:async()=>({data:[row(1)],totalPaginas:2}),maxPages:1}),/Limite/);
 await assert.rejects(fetchTenderItems(pncpId,{fetcher:async()=>({data:[row(1),row(1)],totalPaginas:1})}),/duplicado/);
 assert.equal(normalizeTenderItem({numeroItem:1,descricao:'x',quantidade:-1},pncpId),null);
});
test('catalogo so aceita itens associados a licitacao cadastrada',()=>{
 const items=[{pncpId,number:1,description:'Material',quantity:5,scope:'ifc_tendered'}];
 const data={schema_version:1,procedures:[{pncpId,checkedAt:'2026-11-21',items}]};
 assert.equal(validateTenderCatalog(data,[notice]),data);
 assert.throws(()=>validateTenderCatalog(data,[]));
 assert.equal(planTenderItems([notice],data.procedures).length,0);
});

test('rotacao diaria evita bloqueio por licitacao indisponivel',()=>{
 const notices=Array.from({length:6},(_,i)=>({pncpId:'10635424000186-1-'+String(i+1).padStart(6,'0')+'/2026',srp:true}));
 const a=planTenderItems(notices,[],3,0).map(n=>n.pncpId);
 const b=planTenderItems(notices,[],3,3).map(n=>n.pncpId);
 assert.equal(a.length,3);assert.equal(b.length,3);
 assert.equal(new Set([...a,...b]).size,6);
 assert.deepEqual(planTenderItems(notices,[],3,0).map(n=>n.pncpId),a);
});
