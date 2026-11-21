import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditAttribution} from '../src/audit-attribution.mjs';

test('AUD-05: contagem por evidencia sem expor IDs ou fornecedores',()=>{
 const ne='158459000012026NE000123';
 const pid='10635424000186-1-000001/2026';
 const result=auditAttribution({
  contracts:[
   {id:'c1',source:'pncp',kind:'Contrato',commitmentRefs:[ne],procurementId:pid,procurementLinkStatus:'linked'},
   {id:'c2',source:'pncp',kind:'Empenho',process:'23349.000001/2026-01'},
   {id:'c3',source:'compras',kind:'Contrato',process:'23514.000001/2026-01'}
  ],
  notices:[{pncpId:pid},{pncpId:'10635424000186-1-000002/2026'}],
  documents:[{id:ne,phase:1}]
 });
 assert.equal(result.contracts.attribution.confirmed,1);
 assert.equal(result.contracts.attribution.process_indication,1);
 assert.equal(result.contracts.attribution.unverified,1);
 assert.equal(result.contracts.instrumentTypes.formal_contract,2);
 assert.equal(result.contracts.instrumentTypes.commitment_substitute,1);
 assert.equal(result.notices.attribution.confirmed,1);
 assert.equal(result.documents.fullNeRefsWithCguDocument,1);
 assert.equal(JSON.stringify(result).includes(ne),false);
 assert.equal(JSON.stringify(result).includes(pid),false);
});
test('AUD-05: catalogos invalidos nao geram relatorio enganoso',()=>{
 assert.throws(()=>auditAttribution({contracts:{}}));
});
