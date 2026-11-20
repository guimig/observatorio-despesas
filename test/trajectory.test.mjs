import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommitmentTrajectories, filterCommitmentTrajectories } from '../assets/trajectory.js';

const ne='158459264222026NE000001';
const ns='158459264222026NS000001';
const ob='158459264222026OB000001';
const oldNe='158459264222025NE000009';
const month=(name,documents,relations=[],itemsByDocument={})=>({
  schema_version:1,unit:'158459',month:name,documents,relations,itemsByDocument
});
test('reúne liquidações e pagamentos da mesma NE em competências diferentes',()=>{
 const months=[
  month('2026-10',[{id:ne,date:'2026-10-02',phase:1,cents:10000,process:'23349.1'}],
   [{from:ns,to:ne,cents:4000}]),
  month('2026-11',[
   {id:ns,date:'2026-11-03',phase:2,cents:4000,liquidationLinksChecked:true},
   {id:ob,date:'2026-11-05',phase:3,cents:3000,paymentLinksChecked:true}
  ],[{from:ob,to:ne,cents:3000}],{[ne]:[{seq:1,cents:10000,description:'Material'}]})
 ];
 const [entry]=buildCommitmentTrajectories(months).filter(x=>x.id===ne);
 assert.equal(entry.document.date,'2026-10-02');
 assert.equal(entry.liquidations.length,1);
 assert.equal(entry.payments.length,1);
 assert.equal(entry.liquidationCents,4000);
 assert.equal(entry.paymentCents,3000);
 assert.equal(entry.itemsChecked,true);
 assert.equal(entry.items[0].description,'Material');
});
test('preserva valores negativos e NEs de exercícios anteriores sem misturar fases',()=>{
 const months=[month('2026-11',[
  {id:ns,date:'2026-11-03',phase:2,cents:1000,liquidationLinksChecked:true},
  {id:ob,date:'2026-11-04',phase:3,cents:900,paymentLinksChecked:true}
 ],[{from:ns,to:oldNe,cents:-200},{from:ob,to:oldNe,cents:900}])];
 const [entry]=buildCommitmentTrajectories(months);
 assert.equal(entry.id,oldNe);
 assert.equal(entry.liquidationCents,-200);
 assert.equal(entry.paymentCents,900);
 assert.equal(entry.liquidations.length,1);
 assert.equal(entry.payments.length,1);
});
test('marca consultas pendentes e não inventa documento NE ausente',()=>{
 const months=[month('2026-11',[
  {id:ns,date:'2026-11-03',phase:2,cents:1000,liquidationLinksChecked:false}
 ],[{from:ns,to:ne,cents:1000}])];
 const [entry]=buildCommitmentTrajectories(months);
 assert.equal(entry.document,null);
 assert.equal(entry.pendingLiquidations,true);
 assert.equal(entry.pendingPayments,false);
});
test('deduplica relações repetidas entre competências e pesquisa por processo',()=>{
 const docs=[{id:ne,date:'2026-10-02',phase:1,cents:10000,process:'23349.000001/2026-01'}];
 const relation={from:ns,to:ne,cents:4000};
 const entries=buildCommitmentTrajectories([
  month('2026-10',docs,[relation]),month('2026-11',[],[relation])
 ]);
 assert.equal(entries.length,1);
 assert.equal(entries[0].links.length,1);
 assert.equal(filterCommitmentTrajectories(entries,'23349.000001').length,1);
 assert.equal(filterCommitmentTrajectories(entries,'inexistente').length,0);
});
test('recusa competências e documentos de outra UG ou formato inválido',()=>{
 assert.throws(()=>buildCommitmentTrajectories([{
  unit:'158125',month:'2026-11',documents:[],relations:[]
 }]));
});

import { auditCommitmentTrajectories } from '../assets/trajectory.js';

test('auditoria distingue NE referenciada de NE coletada e origens ausentes',()=>{
 const source='158459264222026NS000005';
 const m=month('2026-11',[],[{from:source,to:oldNe,cents:1200}]);
 const audit=auditCommitmentTrajectories([m]);
 assert.equal(audit.commitmentsWithoutDocument,1);
 assert.equal(audit.commitmentDocuments,0);
 assert.equal(audit.olderYearReferences,1);
 assert.equal(audit.missingRelationSources,1);
 const [entry]=buildCommitmentTrajectories([m]);
 assert.equal(entry.completeness,'empenho_nao_coletado');
 assert.equal(entry.hasUnresolvedSources,true);
});
test('auditoria detecta divergências sem confundir duplicatas com novas relações',()=>{
 const first=month('2026-10',[{id:ne,phase:1,cents:1000}],[{from:ns,to:ne,cents:500}]);
 const second=month('2026-11',[{id:ne,phase:1,cents:2000}],[{from:ns,to:ne,cents:600}]);
 const audit=auditCommitmentTrajectories([first,second]);
 assert.equal(audit.duplicateRelations,1);
 assert.equal(audit.conflictingRelations,1);
 assert.equal(audit.conflictingDocuments,1);
 assert.equal(buildCommitmentTrajectories([first,second])[0].links.length,1);
});
