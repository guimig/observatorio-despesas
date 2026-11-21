import {test} from 'node:test';
import assert from 'node:assert/strict';
import {procurementItemsUrl,inspectItems,auditItems} from '../src/audit-pncp-procurement-items.mjs';
const notice={pncpId:'10635424000186-1-000001/2026'};
test('endpoint de itens PNCP e restrito a CNPJs institucionais',()=>{
 assert.match(procurementItemsUrl(notice.pncpId),/\/itens\?pagina=1/);
 assert.throws(()=>procurementItemsUrl('00000000000000-1-000001/2026'));
 assert.throws(()=>procurementItemsUrl(notice.pncpId,0));
});
test('sondagem estrutural nao registra fornecedor nem valores individuais',async()=>{
 const raw={data:[{numeroItem:1,quantidade:900,descricao:'Descricao confidencial',fornecedor:'Fornecedor X'}],totalPaginas:1};
 const r=await auditItems([notice],{fetcher:async()=>raw});
 assert.equal(r.success,1);
 assert.equal(r.rows,1);
 assert.equal(r.fields.quantidade,1);
 assert.equal(JSON.stringify(r).includes('Fornecedor X'),false);
 assert.equal(JSON.stringify(r).includes('Descricao confidencial'),false);
});
test('pagina parcial nao autoriza inferencia de quantitativo total',async()=>{
 const r=await auditItems([notice],{fetcher:async()=>({data:[{quantidade:1}],totalPaginas:2})});
 assert.equal(r.paginated,1);
 assert.equal(r.success,1);
 assert.throws(()=>inspectItems({erro:'indisponivel'}));
});
