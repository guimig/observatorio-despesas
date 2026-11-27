import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildIntegratedIndex,scopeFinancialEvidence,itemReferenceCandidates,buildRelationshipLocator,contextualEvidenceMatches} from '../assets/integrated-trajectory.js';
import {prioritizeRelatedImpacts,impactAttemptKey,recentImpactAttempt,summarizeContractProgress} from '../src/enrich-month.mjs';
import {prioritizeMissingAtas} from '../src/collect-pncp-atas.mjs';
import {planMissingNotices} from '../src/pncp-notices-detail.mjs';
import {missingReferencedNe} from '../src/recover-cgu-originals.mjs';
const ne='158459000012026NE000001',ob='158459000012026OB000001';
const purchase='10635424000186-1-000001/2026',ata=purchase+':ata:3',cnpj='12345678000190',process='23349.000001/2026-01';
const doc={id:ne,phase:1,date:'2026-11-10',cents:100,partyRef:cnpj,process};
const payment={id:ob,phase:3,date:'2026-11-25',cents:100};
const contract={id:'c',source:'pncp',number:'2026NE000001',unitCode:'158459',supplierCnpj:cnpj,process,amountCents:100,procurementId:purchase,ataControl:purchase+'-000003'};
const months=[{unit:'158459',month:'2026-11',documents:[doc,payment],relations:[],itemsByDocument:{[ne]:[{seq:1,purchaseItem:'1',cents:100}]}}];
test('candidato forte único permite comparação por item mas não valores',()=>{
 const index=buildIntegratedIndex({months,contracts:[contract],tender:{procedures:[{pncpId:purchase,items:[{number:1}]}]}});
 assert.equal(index.neEdges.get(ne)[0].level,'high_confidence');
 assert.equal(scopeFinancialEvidence(index,'instrument','c').commitment.known,0);
 assert.equal(itemReferenceCandidates(index,index.byNe.get(ne))[0].evidence,'candidate');
 const ambiguous=buildIntegratedIndex({months,contracts:[contract,{...contract,id:'c2'}]});
 assert.equal(itemReferenceCandidates(ambiguous,ambiguous.byNe.get(ne)).length,0);
 assert.equal(contextualEvidenceMatches(doc,{id:ne,issueDate:'2026-10-01',totalCents:100}),true);
});
test('índice só armazena competências de documentos e relações inclusive entre meses',()=>{
 const m=[{...months[0],documents:[doc],month:'2026-10'},
 {unit:'158459',month:'2026-11',documents:[payment],relations:[{from:ob,to:ne,cents:100}]}];
 const r=buildRelationshipLocator(m);assert.deepEqual(r.owners[ne],['2026-10']);
 assert.deepEqual(r.neighbors[ne],['2026-11']);assert.deepEqual(r.neighbors[ob],['2026-10','2026-11']);
 assert.ok(!JSON.stringify(r).includes(cnpj));
});
test('impacto pendente ligado à NE tem prioridade dentro da cota',()=>{
 const m=[{...months[0],documents:[{...doc,relatedIds:[ob]},payment]}];
 const base=Array.from({length:5},(_,i)=>({kind:'payment',id:'other'+i,month:'2026-11'}));
 const r=prioritizeRelatedImpacts(base,m,{slot:0,now:new Date('2026-11-27')});
 assert.equal(r.tasks.length,5);assert.equal(r.selected,1);assert.equal(r.tasks[0].id,ob);
});
test('NE ausente referenciada por identidade é recuperável sem impacto monetário',()=>{
 assert.deepEqual(missingReferencedNe([{...months[0],documents:[{...payment,relatedIds:[ne]}]}],{scope:'all'}),[ne]);
});
test('ata específica e compra de origem da ata entram na recuperação dirigida',()=>{
 const n={pncpId:purchase,srp:true};
 assert.deepEqual(prioritizeMissingAtas([], [n], [], [contract],2).plan,[n]);
 const other='10635424000186-1-000002/2026';
 assert.deepEqual(planMissingNotices({contracts:[{...contract,procurementId:other}]},{notices:[{pncpId:other}]}),[purchase]);
});

test('reserva de pagamentos privilegia NEs contratuais CGU sem aumentar cotas',()=>{
 const p1='158459000012026OB000021',p2='158459000012026OB000022',p3='158459000012026OB000023';
 const m=[{...months[0],documents:[{...doc,relatedIds:[p1,p2,p3]},...([p1,p2,p3].map(id=>({...payment,id})))],relations:[]}];
 const base=Array.from({length:5},(_,i)=>({kind:'payment',id:'other'+i,month:'2026-11'}));
 const a=prioritizeRelatedImpacts(base,m,{slot:0,now:new Date('2026-11-27'),cguContracts:[{refs:[ne]}]});
 const b=prioritizeRelatedImpacts(base,m,{slot:1,now:new Date('2026-11-27'),cguContracts:[{refs:[ne]}]});
 assert.equal(a.selected,2);assert.equal(a.contractPriority,2);assert.equal(a.paymentPriority,2);assert.equal(a.tasks.length,5);assert.notEqual(a.tasks[0].id,b.tasks[0].id);
});

test('impactos contratuais usam vagas ociosas e falhas recentes nao monopolizam consultas',()=>{
 const m={...months[0],documents:[{...doc,relatedIds:[ob]},payment]};
 const now=new Date('2026-11-27');
 const args={slot:0,now,cguContracts:[{refs:[ne]}]};
 const r=prioritizeRelatedImpacts([],[m],args);
 assert.equal(r.tasks.length,1);assert.equal(r.tasks[0].id,ob);
 assert.equal(r.contractPendingPaymentPairs,1);
 const key=impactAttemptKey(m,ob,'payment');
 assert.equal(prioritizeRelatedImpacts([],[m],{...args,state:{[key]:'2026-11-26'}}).tasks.length,0);
 assert.equal(prioritizeRelatedImpacts([],[m],{...args,state:{[key]:'2026-11-24'}}).tasks.length,1);
 assert.equal(prioritizeRelatedImpacts([],[m],{...args,state:{[key]:'2026-11-28'}}).tasks.length,1);
});
test('par numerico sem checkpoint validado continua elegivel para consulta',()=>{
 const m={...months[0],documents:[{...doc,relatedIds:[ob]},payment],relations:[{from:ob,to:ne,cents:0}]};
 assert.equal(prioritizeRelatedImpacts([],[m],{now:new Date('2026-11-27')}).selected,1);
 const checked={...m,documents:[m.documents[0],{...payment,paymentLinksChecked:true}]};
 assert.equal(prioritizeRelatedImpacts([],[checked],{now:new Date('2026-11-27')}).selected,0);
});
import {planContractRecovery} from '../src/collect-procurement.mjs';
test('recuperacao dirigida usa apenas uma rodada em quatro e respeita cobertura e recorte',()=>{
 const now=new Date('2026-11-27');
 const cguContracts=[{signed:'2024-11-28'},{signed:'2024-11-29'},{signed:'2023-12-01'},{signed:'2026-11-01'}];
 const directed=planContractRecovery([],cguContracts,{now,slot:0});
 assert.equal(directed.month,'2024-11');assert.deepEqual(directed.pending,['pncp']);
 assert.equal(planContractRecovery([],cguContracts,{now,slot:1}).reason,undefined);
 const complete=[{source:'pncp',month:'2024-11',status:'complete',closedMonth:true}];
 assert.equal(planContractRecovery(complete,cguContracts,{now,slot:0}).month,'2024-12');
 const all=[...complete,...['2024-12','2025-01'].map(month=>({source:'pncp',month,status:'complete',closedMonth:true}))];
 assert.equal(planContractRecovery(all,cguContracts,{now,slot:0}).reason,undefined);
});

test('cooldown abrange fila regular mesmo sem identidade relacionada e libera quando evidencia muda',()=>{
 const m={...months[0],documents:[doc,payment]};
 const now=new Date('2026-11-27'),key=impactAttemptKey(m,ob,'payment');
 const state={[key]:'2026-11-26'},base=[{kind:'payment',id:ob,month:m.month}];
 assert.equal(recentImpactAttempt(m,ob,'payment',state,now),true);
 assert.equal(prioritizeRelatedImpacts(base,[m],{state,now}).tasks.length,0);
 const changed={...m,documents:[doc,{...payment,cents:101}]};
 assert.equal(prioritizeRelatedImpacts(base,[changed],{state,now}).tasks.length,1);
});
test('progresso contratual mede pares por NE sem valores nem identificadores',()=>{
 const cguContracts=[{id:42,refs:[ne]}];
 const m={...months[0],documents:[{...doc,relatedIds:[ob]},payment]};
 const before=summarizeContractProgress([m],cguContracts);
 const after=summarizeContractProgress([{...m,documents:[m.documents[0],{...payment,paymentLinksChecked:true}],relations:[{from:ob,to:ne,cents:30}]}],cguContracts);
 assert.equal(before.unknownPaymentPairs,1);assert.equal(before.knownPaymentPairs,0);
 assert.equal(after.unknownPaymentPairs,0);assert.equal(after.knownPaymentPairs,1);
 assert.equal(after.eligible,1);assert.ok(!JSON.stringify(after).includes(ne));
});
