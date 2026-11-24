import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resultUrl,normalizeResult,fetchItemResults,applyItemResults,planItemResults,resultKey,validateResults} from '../src/pncp-item-results.mjs';
import {validateTenderCatalog,planTenderItems} from '../src/collect-pncp-tender-items.mjs';
const id='10635424000186-1-000001/2026',item={pncpId:id,number:1,description:'Material',quantity:8,scope:'ifc_tendered'};
const row={numeroItem:1,sequencialResultado:1,situacaoCompraItemResultadoId:1,dataResultado:'2026-11-20',quantidadeHomologada:3.125,valorUnitarioHomologado:1.234,valorTotalHomologado:3.85625,tipoPessoa:'PJ',niFornecedor:'12345678000190',ordemClassificacaoSrp:1,numeroControlePNCPCompra:id};
test('endpoint oficial, corte, valores decimais e identidade',()=>{
 assert.match(resultUrl(id,1),/compras\/2026\/1\/itens\/1\/resultados$/);
 assert.throws(()=>resultUrl(id.replace('2026','2023'),1));
 const r=normalizeResult(row,id,1);assert.equal(r.unitPrice,'1.234');assert.equal(r.quantity,'3.125');assert.equal(r.total,'3.85625');assert.equal(r.supplierCnpj,'12345678000190');
 assert.throws(()=>normalizeResult({...row,numeroItem:2},id,1));
 assert.throws(()=>normalizeResult({...row,numeroControlePNCPCompra:id.replace('000001','000002')},id,1));
});
test('varios fornecedores, cancelado e reserva; nenhum CPF ou nome bruto',async()=>{
 const pf={...row,sequencialResultado:2,tipoPessoa:'PF',niFornecedor:'00012345678',nomeRazaoSocialFornecedor:'NOME PRIVADO',situacaoCompraItemResultadoId:2,reservaRemanescenteId:{codigo:3},dataCancelamento:'2026-11-21'};
 const result=await fetchItemResults(item,{fetcher:async()=>[pf,row]});
 assert.equal(result.length,2);assert.equal(result[1].supplierCpfMasked,'***.123.456-**');assert.equal(result[1].reserve,3);assert.equal(result[1].status,2);
 assert.ok(!JSON.stringify(result).includes('00012345678'));assert.ok(!JSON.stringify(result).includes('NOME PRIVADO'));
 const next=applyItemResults(item,result);assert.equal(applyItemResults(next,result),next);
 assert.throws(()=>applyItemResults(next,[result[0]]));
 assert.throws(()=>validateResults([{...result[0],supplierCpfMasked:'00012345678'}]));
 assert.doesNotThrow(()=>validateTenderCatalog({schema_version:1,procedures:[{pncpId:id,checkedAt:'2026-11-24',items:[next]}]},[{pncpId:id}]));
});
test('vazio completo distinto de pendencia; duplicado e pagina incompleta recusados',async()=>{
 assert.deepEqual(await fetchItemResults(item,{fetcher:async()=>({dados:[],totalPaginas:0})}),[]);
 await assert.rejects(fetchItemResults(item,{fetcher:async()=>[row,row]}));
 await assert.rejects(fetchItemResults(item,{fetcher:async()=>({data:[row],totalPaginas:2})}));
 await assert.rejects(fetchItemResults(item,{fetcher:async()=>({data:[row],totalRegistros:2})}));
});
test('fila inclui nao SRP, preserva recorte e reconsulta por hash sem novo dado',()=>{
 const now=new Date('2026-11-24T18:00:00Z'),next={...item,results:[normalizeResult(row,id,1)]},empty={...item,number:2,results:[]},pending={...item,number:3};
 const p=[{pncpId:id,items:[next,empty,pending]}];
 assert.equal(planTenderItems([{pncpId:id,srp:false},{pncpId:id.replace('2026','2023'),srp:true}],[]).length,1);
 const state={[resultKey(next)]:'2026-11-01',[resultKey(empty)]:'2026-11-23'};
 assert.deepEqual(planItemResults(p,{state,now,slot:0}).map(i=>i.number),[3]);
 assert.equal(planItemResults(p,{state:{},now,slot:0}).length,3);
 assert.notEqual(resultKey(next),resultKey({...next,quantity:9}));
});

test('rejeita quantidade ou valor unitario ausente e envelope sem contagem valida',async()=>{
 assert.throws(()=>normalizeResult({...row,quantidadeHomologada:null},id,1));
 assert.throws(()=>normalizeResult({...row,valorUnitarioHomologado:undefined},id,1));
 await assert.rejects(fetchItemResults(item,{fetcher:async()=>({data:[row],totalPaginas:'invalido'})}));
 await assert.rejects(fetchItemResults(item,{fetcher:async()=>({data:[row],totalPaginas:0})}));
});
