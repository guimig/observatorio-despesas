import {test} from 'node:test';
import assert from 'node:assert/strict';
import {procurementFinancialEvidence,procurementEvidenceDetails} from '../assets/procurement-financial-evidence.js';
const notice={pncpId:'10635424000186-1-000001/2026'};
test('ARP e licitacao isoladas nao comprovam NE de Araquari',()=>{
 const r=procurementFinancialEvidence(notice,[],[]);
 assert.equal(r.level,'unverified');assert.equal(r.verifiedCommitments,0);
});
test('processo 23349 nao constitui NE confirmada',()=>{
 const c={id:'x',procurementId:notice.pncpId,process:'23349.000001/2026-00'};
 const r=procurementFinancialEvidence(notice,[c],[]);
 assert.equal(r.level,'indication');assert.equal(r.verifiedCommitments,0);
});
test('NE integral PNCP e CGU e contada uma unica vez',()=>{
 const ne='158459000012026NE000001';
 const c={id:'x',procurementId:notice.pncpId,commitmentRefs:[ne]};
 const doc={id:ne,phase:1};
 const r=procurementFinancialEvidence(notice,[c,c],[doc,doc]);
 assert.equal(r.level,'confirmed');assert.equal(r.verifiedCommitments,1);
});
test('NE de outra UG nao e atribuida a Araquari',()=>{
 const c={id:'x',procurementId:notice.pncpId,commitmentRefs:['158125000012026NE000001']};
 const r=procurementFinancialEvidence(notice,[c],[]);
 assert.equal(r.level,'unverified');
});

test('detalhe exibe NE confrontada e nao duplica instrumento',()=>{
 const ne='158459000012026NE000001';
 const c={id:'contrato-1',procurementId:notice.pncpId,commitmentRefs:[ne]};
 const details=procurementEvidenceDetails(notice,[c,c],[{id:ne,phase:1}]);
 assert.equal(details.length,1);
 assert.equal(details[0].level,'verified_ne');
 assert.deepEqual(details[0].commitments,[ne]);
});
test('detalhe nao promove indício de processo a NE confirmada',()=>{
 const c={id:'contrato-2',procurementId:notice.pncpId,process:'23349.000001/2026-00'};
 const details=procurementEvidenceDetails(notice,[c],[]);
 assert.equal(details[0].level,'indication');
 assert.deepEqual(details[0].commitments,[]);
});
