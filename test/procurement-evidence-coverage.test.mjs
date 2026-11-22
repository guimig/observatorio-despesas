import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeProcurementEvidence} from '../assets/procurement-evidence-coverage.js';
const a={pncpId:'10635424000186-1-000001/2026'};
const b={pncpId:'10635424000186-1-000002/2026'};
test('sem instrumentos nao significa sem contratacao',()=>{
 const r=summarizeProcurementEvidence([a,b],[],[],1,12);
 assert.equal(r.publications,2);
 assert.equal(r.withoutEvidence,2);
 assert.equal(r.complete,false);
 assert.equal(r.withVerifiedNe,0);
});
test('contagem nao duplica NEs e separa referencia de comprovacao',()=>{
 const ne='158459000012026NE000001';
 const contracts=[{id:'c1',procurementId:a.pncpId,commitmentRefs:[ne]}];
 const partial=summarizeProcurementEvidence([a,b],contracts,[],0,2);
 assert.equal(partial.withDeclaredNe,1);
 const full=summarizeProcurementEvidence([a,b],contracts,[{id:ne,phase:1},{id:ne,phase:1}],2,2);
 assert.equal(full.withVerifiedNe,1);
 assert.equal(full.withDeclaredNe,0);
 assert.equal(full.complete,true);
 assert.equal(full.withoutEvidence,1);
});
