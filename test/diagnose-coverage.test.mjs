import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseCoverage } from '../src/diagnose-coverage.mjs';
test('separa documentos NE, referências ausentes e cobertura por dia',()=>{
 const ne='158459264222026NE000001',old='158459264222025NE000002';
 const report=diagnoseCoverage([{month:'2026-11',
  documents:[{id:ne,phase:1}],relations:[{from:'x',to:old,cents:200},{from:'y',to:old,cents:100}],
  coverage:[1,2,3].map(phase=>({date:'2026-11-01',phase,complete:true,invalid:0}))}],
  {now:new Date('2026-11-02T12:00:00Z')});
 assert.equal(report.commitmentsCollected,1);
 assert.equal(report.commitmentsMissing,1);
 assert.equal(report.relations,2);
 assert.deepEqual(report.missingByYear,{'2025':1});
 assert.equal(report.months[0].fullyCoveredDays,1);
});

test('contabiliza enriquecimentos pendentes por fase e por competência',()=>{
 const report=diagnoseCoverage([{month:'2026-11',
 documents:[{id:'ne',phase:1},{id:'ns',phase:2,liquidationLinksChecked:false},{id:'ob',phase:3,paymentLinksChecked:true}],
 relations:[],itemsByDocument:{},coverage:[]}]);
 assert.equal(report.pendingEnrichment,2);
 assert.equal(report.months[0].pendingLiquidations,1);
 assert.equal(report.months[0].pendingPayments,0);
 assert.equal(report.months[0].pendingItems,1);
});
