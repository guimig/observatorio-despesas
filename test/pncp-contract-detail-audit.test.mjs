import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectContractDetail,auditContractDetails} from '../src/audit-pncp-contract-detail.mjs';
const id='10635424000186-2-001685/2026';
test('auditoria retorna apenas nomes, tipos e contagens de campos',()=>{
 const result=inspectContractDetail({numeroControlePNCP:id,
  nomeRazaoSocialFornecedor:'Nome privado',
  niFornecedor:'000.123.456-78',termosAditivos:[{cpf:'12345678900'}],
  valorAtualizado:1000},id);
 assert.equal(result.termosAditivos.kind,'array');
 assert.equal(result.termosAditivos.nonempty,true);
 assert.equal(result.valorAtualizado.kind,'number');
 assert.equal(JSON.stringify(result).includes('12345678900'),false);
 assert.equal(JSON.stringify(result).includes('Nome privado'),false);
});
test('nao aceita detalhe de outro instrumento',()=>{
 assert.throws(()=>inspectContractDetail({numeroControlePNCP:'outro'},id),/divergente/);
});
test('falha pontual nao impede estatistica de amostra',async()=>{
 const contracts=[{source:'pncp',pncpId:id},{source:'pncp',pncpId:'10635424000186-2-001686/2026'}];
 const result=await auditContractDetails(contracts,{fetcher:async url=>{
  if(url.endsWith('/1686'))throw Error('503');
  return {numeroControlePNCP:id,valorAtualizado:120};
 }});
 assert.equal(result.attempted,2);
 assert.equal(result.success,1);
 assert.equal(result.failed,1);
 assert.equal(result.fields.valorAtualizado.present,1);
});
