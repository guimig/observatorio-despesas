import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterAuditFindings,auditFindingsCsv} from '../assets/procurement-audit-report.js';
const rows=[{instrument:'C1',reference:'2026NE000001',status:'verified',procurementId:'PNCP1'},
 {instrument:'C2',reference:'2026NE000002',status:'not_checked_fully',procurementId:'PNCP2'}];
test('filtra por situacao e identificador sem alterar dados',()=>{
 assert.equal(filterAuditFindings(rows,{status:'verified'}).length,1);
 assert.equal(filterAuditFindings(rows,{query:'pncp2'})[0].instrument,'C2');
 assert.equal(rows.length,2);
});
test('CSV inclui linhas filtradas, BOM e evita injecao de formulas',()=>{
 const csv=auditFindingsCsv([{instrument:'=HYPERLINK("x")',reference:'-1',status:'verified'}]);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.ok(csv.includes("'-1"));
 assert.ok(csv.includes('""x""'));
});
