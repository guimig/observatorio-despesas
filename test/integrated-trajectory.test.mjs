import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAtaControl,ataControlFor,buildIntegratedIndex,scopeFinancialEvidence,neEvidenceLevel,trajectoryMatches,itemReferenceCandidates,summarizeIntegratedCoverage,scopeItemReferences,noticeAtaItemReferences,ataFilesUrl} from '../assets/integrated-trajectory.js';
const ne='158459000012026NE000001',ne2='158459000012026NE000002',ns='158459000012026NS000001',ob='158459000012026OB000001';
const purchase='10635424000186-1-000001/2026',other='10635424000186-1-000002/2026';
const ata={id:purchase+':ata:3',procurementId:purchase,sequence:3,number:'03/2026'};
const cnpj='12345678000190',process='23349.000001/2026-01';
const doc={id:ne,phase:1,date:'2026-05-01',cents:10000,partyRef:cnpj,process};
const baseContract={id:'c1',pncpId:'10635424000186-2-000001/2026',source:'pncp',procurementId:purchase,number:'01/2026',kind:'Contrato',supplierCnpj:cnpj,process,commitmentRefs:[ne],ataControl:purchase+'-000003'};
const months=[{unit:'158459',month:'2026-05',documents:[doc,{...doc,id:ne2,cents:25000}],
 relations:[],itemsByDocument:{[ne]:[{seq:1,purchaseItem:'0002',quantity:'2',cents:10000}]}},
 {unit:'158459',month:'2026-06',documents:[{id:ns,phase:2,date:'2026-06-01',cents:10000},{id:ob,phase:3,date:'2026-06-01',cents:20000}],
 relations:[{from:ns,to:ne,cents:7000},{from:ns,to:ne2,cents:3000},{from:ob,to:ne,cents:6000},{from:ob,to:ne2,cents:14000}]}];
const build=opts=>buildIntegratedIndex({months,contracts:[baseContract],notices:[{pncpId:purchase,number:'90001/2026'}],atas:[ata,{...ata,id:purchase+':ata:4',sequence:4}],...opts});
test('ata especifica, compra e instrumento por identificador; nao vincula todas as atas da compra',()=>{
 assert.deepEqual(parseAtaControl(ataControlFor(ata)),{procurementId:purchase,sequence:3,id:ata.id});
 assert.equal(parseAtaControl(purchase+'-000000'),null);
 const i=build();assert.equal(i.ataInstruments.get(ata.id).length,1);
 assert.equal(i.ataInstruments.has(purchase+':ata:4'),false);
 assert.equal(i.noticeInstruments.get(purchase).length,1);
 assert.equal(neEvidenceLevel(i,ne),'confirmed');assert.equal(neEvidenceLevel(i,ne2),'indication');
 const s=scopeFinancialEvidence(i,'notice',purchase);
 assert.equal(s.confirmed.length,1);assert.equal(s.candidates.length,1);
 assert.equal(s.commitment.cents,10000);assert.equal(s.liquidation.cents,7000);assert.equal(s.payment.cents,6000);
 assert.equal(i.originsByDoc.get(ob).length,2);assert.equal(i.originsByDoc.get(ns).length,2);
 assert.equal(trajectoryMatches(i,i.byNe.get(ne),'90001/2026'),true);
 assert.equal(trajectoryMatches(i,i.byNe.get(ne),ob),true);
});
test('adesao mantem compra propria e origem da ata distintas, deduplica as duas fontes',()=>{
 const c={...baseContract,procurementId:other};
 const i=build({contracts:[c],arpDetails:[{ataId:ata.id,instruments:[{pncpId:c.pncpId}]}]});
 assert.equal(i.ataEdges.get(c.id).length,1);assert.equal(i.ataEdges.get(c.id)[0].sources.length,2);
 assert.deepEqual(i.noticeEdges.get(c.id).map(e=>e.purchaseId).sort(),[purchase,other].sort());
 assert.equal(scopeFinancialEvidence(i,'ata',ata.id).payment.cents,6000);
});
test('abreviacao e candidato contextual nao confirmam e nao entram em valores',()=>{
 const c={...baseContract,number:'2026NE000001',unitCode:'158459',commitmentRefs:[],
  commitmentStatus:'complete',commitmentContext:[{id:ne,issueDate:doc.date,totalCents:doc.cents,pi:'PI'}]};
 const i=build({contracts:[c]});
 assert.equal(i.neEdges.get(ne)[0].level,'contextual_candidate');
 assert.equal(scopeFinancialEvidence(i,'instrument',c.id).commitment.known,0);
 assert.equal(neEvidenceLevel(i,ne),'indication');
});
test('NE confirmada em dois instrumentos ou instrumento com duas atas nao recebe alocacao',()=>{
 const i=build({contracts:[baseContract,{...baseContract,id:'c2',pncpId:'10635424000186-2-000002/2026'}]});
 const s=scopeFinancialEvidence(i,'notice',purchase);
 assert.equal(s.confirmed.length,1);assert.deepEqual(s.excluded,[ne]);assert.equal(s.payment.known,0);
 const j=build({arpDetails:[{ataId:purchase+':ata:4',instruments:[{pncpId:baseContract.pncpId}]}]});
 assert.deepEqual(scopeFinancialEvidence(j,'ata',ata.id).excluded,[ne]);
 assert.equal(summarizeIntegratedCoverage(i).ambiguousCommitments,1);
});
test('comparacao de itens exige NE integral, mesmo ID compra, item e credor da ata',()=>{
 const options={tender:{procedures:[{pncpId:purchase,items:[{number:2,description:'Material',quantity:100}]}]},
 arpDetails:[{ataId:ata.id,compras:{items:[{number:2,supplierCnpj:cnpj,homologatedSupplier:'20'}]},unitItems:[{number:2,units:[{unitCode:'158459',registered:'5'}]}]}]};
 const i=build(options),r=itemReferenceCandidates(i,i.byNe.get(ne));
 assert.equal(r.length,1);assert.equal(r[0].tender.number,2);assert.equal(r[0].ata.id,ata.id);
 const j=build({...options,contracts:[{...baseContract,procurementId:other}]});
 assert.deepEqual(itemReferenceCandidates(j,j.byNe.get(ne)),[]);
});
test('referencia integral sem documento e declarada, nao confirmada; conflito nao soma',()=>{
 const absent='158459000012024NE000999';
 const i=build({contracts:[{...baseContract,commitmentRefs:[absent]}]});
 const s=scopeFinancialEvidence(i,'instrument',baseContract.id);
 assert.equal(s.declared.length,1);assert.equal(s.confirmed.length,0);assert.equal(s.commitment.known,0);
 const conflict={...months[1],month:'2026-07',relations:[{from:ns,to:ne,cents:999}]};
 const j=build({months:[...months,conflict]});
 assert.deepEqual(scopeFinancialEvidence(j,'instrument',baseContract.id).excluded,[ne]);
});

test('vinculos por item em sentido reverso preservam compra, ata, fornecedor e instrumento',()=>{
 const options={tender:{procedures:[{pncpId:purchase,items:[{number:2,description:'Material',quantity:100}]}]},
 arpDetails:[{ataId:ata.id,compras:{items:[{number:2,supplierCnpj:cnpj,homologatedSupplier:'20'}]}}]};
 const i=build(options);
 assert.equal(scopeItemReferences(i,'notice',purchase).length,1);
 assert.equal(scopeItemReferences(i,'ata',ata.id)[0].ne,ne);
 assert.equal(scopeItemReferences(i,'instrument',baseContract.id).length,1);
 assert.equal(scopeItemReferences(i,'ata',purchase+':ata:4').length,0);
 assert.equal(noticeAtaItemReferences(i,purchase)[0].tender.description,'Material');
 assert.equal(summarizeIntegratedCoverage(i).neItemsWithAta,1);
 const j=build({...options,contracts:[{...baseContract,procurementId:other}]});
 assert.equal(scopeItemReferences(j,'ata',ata.id).length,0);
 assert.equal(ataFilesUrl(ata,2),'https://pncp.gov.br/api/pncp/v1/orgaos/10635424000186/compras/2026/1/atas/3/arquivos/2');
 assert.equal(ataFilesUrl(ata,0),null);
});
