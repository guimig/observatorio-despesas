import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditBaseline} from '../src/diagnose-coverage.mjs';

test('baseline de auditoria publica apenas agregados, sem IDs de documentos',()=>{
 const report={
  documents:3,relations:1,commitmentsCollected:1,commitmentsReferenced:2,
  commitmentsMissing:1,missingByYear:{2025:1},pendingEnrichment:2,
  missingCommitmentIds:['158459000012025NE000001'],
  months:[{month:'2026-11',daysWithCoverage:3,fullyCoveredDays:2,
   documents:3,relations:1,pendingLiquidations:0,pendingPayments:2,
   pendingItems:0,pendingTotal:2}],
  note:'Cobertura parcial'
 };
 const result=auditBaseline(report,{revision:'abc123'});
 assert.equal(result.revision,'abc123');
 assert.equal(result.commitmentsMissing,1);
 assert.equal(result.months[0].fullyCoveredDays,2);
 assert.equal(JSON.stringify(result).includes('158459000012025NE000001'),false);
 assert.equal(Object.hasOwn(result,'missingCommitmentIds'),false);
});
