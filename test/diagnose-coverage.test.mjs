import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseCoverage } from '../src/diagnose-coverage.mjs';
test('separa documentos NE, referências ausentes e cobertura por dia',()=>{
 const ne='158459264222026NE000001',old='158459264222025NE000002';
 const report=diagnoseCoverage([{month:'2026-11',
  documents:[{id:ne,phase:1}],relations:[{from:'x',to:old,cents:200},{from:'y',to:old,cents:100}],
  coverage:[1,2,3].map(phase=>({date:'2026-11-01',phase,complete:true,invalid:0}))}]);
 assert.equal(report.commitmentsCollected,1);
 assert.equal(report.commitmentsMissing,1);
 assert.equal(report.relations,2);
 assert.deepEqual(report.missingByYear,{'2025':1});
 assert.equal(report.months[0].fullyCoveredDays,1);
});
