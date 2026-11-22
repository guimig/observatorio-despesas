import {test} from 'node:test';
import assert from 'node:assert/strict';
import {procurementFinancialEvidence} from '../assets/procurement-financial-evidence.js';
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
