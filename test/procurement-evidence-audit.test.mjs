import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditProcurementReferences} from '../assets/procurement-evidence-audit.js';
const ne='158459000012026NE000001';
const contracts=[{id:'c1',procurementId:'p1',commitmentRefs:[ne,ne]}];
test('referencia nao localizada com historico parcial permanece nao conferida',()=>{
 const a=auditProcurementReferences(contracts,[],{loadedMonths:1,totalMonths:12});
 assert.equal(a.counts.not_checked_fully,1);
 assert.equal(a.counts.not_found_in_published_history,0);
 assert.equal(a.findings.length,1);
});
test('referencia conferida exige NE de Araquari em documento CGU',()=>{
 const a=auditProcurementReferences(contracts,[{id:ne,phase:1}],{loadedMonths:12,totalMonths:12});
 assert.equal(a.counts.verified,1);
});
test('historico completo sem NE e lacuna documental, nao irregularidade',()=>{
 const a=auditProcurementReferences(contracts,[],{loadedMonths:12,totalMonths:12});
 assert.equal(a.counts.not_found_in_published_history,1);
});
test('NE de outra UG nao vira referencia de Araquari',()=>{
 const a=auditProcurementReferences([{id:'x',commitmentRefs:['158125000012026NE000001']}],[],{loadedMonths:1,totalMonths:1});
 assert.equal(a.findings.length,0);
});
