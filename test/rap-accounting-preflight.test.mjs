import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightRapAccountingSnapshot as check} from '../src/rap-accounting-preflight.mjs';
const metadata={system:'SIAFI_TESOURO_GERENCIAL',reportId:'TG_RP_UG158459_v1',
  extractedAt:'2026-11-23T12:00:00-03:00',asOf:'2026-11-22',unit:'158459',
  scope:'unit',granularity:'commitment_inscription_modality_asof',complete:true,
  accountingRuleVersion:'pending-accounting-review'};
const prefix='15845926422';
const row=(number,modality,balanceCents,inscriptionYear=2025)=>({
  unit:'158459',management:'26422',commitment:prefix+
  '2025NE'+String(number).padStart(6,'0'),
  inscriptionYear,modality,asOf:metadata.asOf,entryType:'saldo',balanceCents
});
const control=(modality,balanceCents,rows,inscriptionYear=2025)=>({
 unit:'158459',modality,inscriptionYear,asOf:metadata.asOf,
 balanceCents,rows
});
const fixture=()=>({metadata:{...metadata},rows:[
 row(1,'RPP',12000),row(2,'RPP',0),
 row(3,'RPNP_A_LIQUIDAR',5000),row(4,'RPNP_EM_LIQUIDACAO',0)
],controls:[
 control('RPP',12000,2),control('RPNP_A_LIQUIDAR',5000,1),
 control('RPNP_EM_LIQUIDACAO',0,1)
]});
test('preflight distingue categorias contabeis, zero genuino e ano da NE',()=>{
 const result=check(fixture());
 assert.deepEqual(result,{ok:true,reason:'structure_and_controls_verified',
   recordsValidated:4,controlGroupsValidated:3,publishEligible:false});
});
test('recusa duplicidade por NE/ano/modalidade/data e controles duplicados',()=>{
 const x=fixture();x.rows.push({...x.rows[0]});
 assert.equal(check(x).reason,'duplicate_position');
 const y=fixture();y.controls.push({...y.controls[0]});
 assert.equal(check(y).reason,'duplicate_control');
});
test('nao aceita falta de controle, subcobertura ou valor divergente',()=>{
 const x=fixture();x.controls.pop();
 assert.equal(check(x).reason,'control_missing');
 const y=fixture();y.controls[0].balanceCents++;
 assert.equal(check(y).reason,'control_mismatch');
 const z=fixture();z.metadata.complete=false;
 assert.equal(check(z).reason,'source_incomplete');
 const empty=fixture();empty.rows=[];
 assert.equal(check(empty).reason,'no_evidence');
});
test('nao confunde UG, UO, gestão nem numero abreviado de NE',()=>{
 const x=fixture();x.rows[0].unit='26422';
 assert.equal(check(x).reason,'invalid_row');
 const y=fixture();y.rows[0].commitment='2025NE000001';
 assert.equal(check(y).reason,'invalid_row');
 const z=fixture();z.rows[0].management='00001';
 assert.equal(check(z).reason,'invalid_row');
 const w=fixture();w.metadata.scope='budget_unit';
 assert.equal(check(w).reason,'unsupported_scope');
});
test('não aceita campos de saldo ambíguos, data inválida, sinais e decimais',()=>{
 const x=fixture();x.rows[0].cents=100;
 assert.equal(check(x).reason,'unexpected_row_field');
 const y=fixture();y.rows[0].balanceCents=-1;
 assert.equal(check(y).reason,'invalid_row');
 const z=fixture();z.rows[0].balanceCents=10.50;
 assert.equal(check(z).reason,'invalid_row');
 const w=fixture();w.rows[0].asOf='2026-11-23';
 assert.equal(check(w).reason,'invalid_row');
 const d=fixture();d.metadata.asOf='2026-02-30';
 assert.equal(check(d).reason,'invalid_provenance');
});
test('não soma exercícios e modalidades distintos como se fossem uma conta',()=>{
 const x=fixture();x.rows.push(row(5,'RPP',2000,2026));
 x.controls.push(control('RPP',2000,1,2026));
 assert.equal(check(x).ok,true);
 x.controls[0].balanceCents+=2000;
 assert.equal(check(x).reason,'control_mismatch');
});
test('rejeita montantes fora do limite seguro e campos desconhecidos',()=>{
 const x=fixture();x.rows[0].balanceCents=Number.MAX_SAFE_INTEGER;
 x.rows[1].balanceCents=1;
 assert.equal(check(x).reason,'amount_overflow');
 const y=fixture();y.controls[0].nota='valor qualquer';
 assert.equal(check(y).reason,'unexpected_control_field');
 const z=fixture();delete z.metadata.reportId;
 assert.equal(check(z).reason,'missing_metadata');
});
test('nao libera publicacao nem vaza documento ou montante ao resumir',()=>{
 const x=fixture();const result=check(x);
 const printed=JSON.stringify(result);
 for(const term of [x.rows[0].commitment,'12000','5000','26422',
   x.metadata.reportId])assert.equal(printed.includes(term),false);
 assert.equal(result.publishEligible,false);
});
