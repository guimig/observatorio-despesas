import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRelatedRows} from '../src/inspect-cgu-siafi.mjs';
test('sondagem CGU de documentos relacionados conta identidades sem expor valores',()=>{
 const ns='158459000012026NS000001',ob='158459000012026OB000001';
 const r=summarizeRelatedRows([{documento:ns,cpf:'123.456.789-00'},{documento:ob},{documento:'2026NE000001'},{documento:'158125000012026NE000001'}]);
 assert.equal(r.identityCounts.fullCampusNs,1);assert.equal(r.identityCounts.fullCampusPayment,1);
 assert.equal(r.identityCounts.shortOnly,1);assert.equal(r.identityCounts.otherOrUnknown,1);
 for(const v of [ns,ob,'123.456.789-00','2026NE000001'])assert.equal(JSON.stringify(r).includes(v),false);
});
