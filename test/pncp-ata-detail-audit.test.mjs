import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detailUrl,inspectDetail,auditDetails} from '../src/audit-pncp-ata-detail.mjs';
const ata={procurementId:'10635424000186-1-000001/2026',sequence:1};
test('detalhe de ata consulta somente origem PNCP autorizada',()=>{
 assert.match(detailUrl(ata),/\/atas\/1$/);
 assert.throws(()=>detailUrl({procurementId:'00000000000000-1-000001/2026',sequence:1}));
});
test('auditoria nao divulga quantidade, fornecedor ou valor',async()=>{
 const payload={quantidadeTotal:12345,fornecedores:[{nome:'FORNECEDOR SENSIVEL'}],itens:[{quantidade:300}]};
 const result=await auditDetails([ata],{fetcher:async()=>payload});
 assert.equal(result.success,1);
 assert.equal(result.fields.quantidadeTotal,1);
 assert.equal(result.fields['fornecedores:nonempty'],1);
 assert.equal(JSON.stringify(result).includes('12345'),false);
 assert.equal(JSON.stringify(result).includes('FORNECEDOR SENSIVEL'),false);
});
test('erro de endpoint nao e interpretado como ausencia de itens',async()=>{
 const result=await auditDetails([ata],{fetcher:async()=>{throw Error('HTTP 404')}});
 assert.deepEqual({success:result.success,failed:result.failed},{success:0,failed:1});
 assert.throws(()=>inspectDetail([]));
});
