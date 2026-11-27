import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCguContractIdentity,extractCguContractRefs,emptyCguContractEvidence,mergeCguContractEvidence,validateCguContractEvidence,collectCguContractEvidence,planCguContractDiscovery} from '../src/cgu-contract-evidence.mjs';
const ne='158459000012026NE000001',ne2='158459000012026NE000002',now=new Date('2026-11-27T18:00:00Z');
const raw={id:42,numero:'00012/2026',numeroProcesso:'23349000001202601',dataAssinatura:'10/10/2026',unidadeGestora:{codigo:'158459'},fornecedor:{cnpj:'12345678000190',cpf:'11122233344'},objeto:'texto privado'};
const identity=normalizeCguContractIdentity(raw);
test('identidade administrativa CGU e referencias integrais sem payload e sem valores',()=>{
 assert.equal(identity.number,'12/2026');assert.equal(identity.process,'23349.000001/2026-01');
 assert.equal(normalizeCguContractIdentity({...raw,dataAssinatura:'01/01/2023'}),null);
 assert.equal(normalizeCguContractIdentity({...raw,unidadeGestora:{codigo:'158000'}}),null);
 const refs=extractCguContractRefs([{empenho:ne,valor:100},{empenho:ne},{empenho:'1584592026NE000002'},{empenho:'158459000012023NE000001'},{empenho:'158125000012026NE000001'}]);
 assert.deepEqual(refs,[ne]);assert.throws(()=>extractCguContractRefs([{empenhoResumido:ne}]));
 const r=mergeCguContractEvidence(emptyCguContractEvidence(),identity,refs);
 assert.equal(validateCguContractEvidence(r.data),r.data);
 assert.equal(JSON.stringify(r.data).includes('11122233344'),false);assert.equal(JSON.stringify(r.data).includes('texto privado'),false);
 assert.equal(mergeCguContractEvidence(r.data,identity,[]).changed,false);
 assert.equal(mergeCguContractEvidence(r.data,identity,refs).changed,false);
 assert.deepEqual(mergeCguContractEvidence(r.data,identity,[ne2]).data.contracts[0].refs,[ne,ne2]);
 assert.throws(()=>mergeCguContractEvidence(r.data,{...identity,number:'13/2026'},[ne2]));
});
test('descoberta retoma janelas da sondagem e conserva apenas evidencias positivas',async()=>{
 assert.deepEqual(planCguContractDiscovery({now}).map(x=>x.month),['2026-10','2025-10','2024-10']);
 const report=await collectCguContractEvidence({now,token:'secret',budget:{stopped:()=>false,snapshot:()=>({})},request:async url=>new URL(url).pathname.endsWith('/contratos')?[raw]:[{empenho:ne}]});
 assert.equal(report.report.contractsQueried,1);assert.equal(report.report.positiveContracts,1);assert.equal(report.data.contracts.length,1);
 assert.ok(Object.keys(report.state).length>0);assert.ok(!JSON.stringify(report).includes('secret'));
});

import {buildIntegratedIndex,scopeFinancialEvidence,trajectoryMatches,summarizeIntegratedCoverage,indexCguContractEvidence} from '../assets/integrated-trajectory.js';
import {missingReferencedNe} from '../src/recover-cgu-originals.mjs';
test('relacao CGU direta nao confirma PNCP nem compoe seus totais; candidato exige unicidade',()=>{
 const row={...identity,refs:[ne,ne2]},contract={id:'p',source:'pncp',kind:'Contrato',number:'00012/2026',process:identity.process,signed:identity.signed,supplierCnpj:identity.supplierCnpj,unitCode:'158459'};
 const month={unit:'158459',month:'2026-10',documents:[{id:ne,phase:1,date:'2026-10-10',cents:100}],relations:[]};
 const i=buildIntegratedIndex({months:[month],contracts:[contract],cguContracts:[row]});
 assert.equal(i.cguEvidence.byNe.get(ne)[0].id,42);
 assert.equal(i.cguEvidence.byPncp.get('p').length,1);
 assert.equal(scopeFinancialEvidence(i,'instrument','p').commitment.known,0);
 assert.equal(trajectoryMatches(i,i.byNe.get(ne),'12/2026'),true);
 assert.equal(summarizeIntegratedCoverage(i).cguDirectNePresent,1);
 assert.equal(indexCguContractEvidence([row],[contract,{...contract,id:'p2'}]).byPncp.size,0);
 assert.deepEqual(missingReferencedNe([month],{scope:'all',cguContracts:[row]}),[ne2]);
});

import {planCguIdentityDetails} from '../src/cgu-contract-evidence.mjs';
import {getCguObject,getCguArray} from '../src/cgu.mjs';
test('formatos compactos e codigo de pessoa juridica sem confundir CPF ou CNPJ divergente',()=>{
 const compact=normalizeCguContractIdentity({...raw,numero:'000122026',fornecedor:{codigoFormatado:'12.345.678/0001-90'}});
 assert.equal(compact.number,'12/2026');assert.equal(compact.supplierCnpj,'12345678000190');
 assert.equal(normalizeCguContractIdentity({...raw,fornecedor:{codigo:'11122233344'}}).supplierCnpj,undefined);
 assert.equal(normalizeCguContractIdentity({...raw,fornecedor:{cnpj:'12345678000190',codigo:'22222222000100'}}).supplierCnpj,undefined);
});
test('detalhe por id deve ser objeto, usar mesma identidade e preservar referencias',async()=>{
 const {number,process,supplierCnpj,...partial}=identity;
 const previous=mergeCguContractEvidence(emptyCguContractEvidence(),partial,[ne]).data;
 assert.equal(planCguIdentityDetails(previous.contracts,{},now).length,1);
 const budget={stopped:()=>false,snapshot:()=>({})};
 const result=await collectCguContractEvidence({previous,now,token:'secret',budget,request:async()=>[],requestDetail:async()=>raw});
 assert.equal(result.report.identityDetailsImproved,1);
 assert.equal(result.data.contracts[0].number,'12/2026');assert.deepEqual(result.data.contracts[0].refs,[ne]);
 const bad=await collectCguContractEvidence({previous,now,token:'secret',budget,request:async()=>[],requestDetail:async()=>({...raw,id:43})});
 assert.equal(bad.report.identityDetailsImproved,0);assert.deepEqual(bad.data,previous);
 const fetcher=async()=>new Response(JSON.stringify({id:42}));
 assert.deepEqual(await getCguObject('https://example.invalid',{token:'secret',fetcher}),{id:42});
 await assert.rejects(getCguArray('https://example.invalid',{token:'secret',fetcher}));
 await assert.rejects(getCguObject('https://example.invalid',{token:'secret',fetcher:async()=>new Response('[]')}));
});

import {cguContractExecutionEvidence} from '../assets/integrated-trajectory.js';
test('execucao contratual separa movimentos conciliados, impactos por NE e identidades concorrentes',()=>{
 const ne3='158459000012026NE000003',ob='158459000012026OB000001',ns='158459000012026NS000001';
 const doc={id:ne,phase:1,date:'2026-10-10',cents:130,itemsDetailVersion:2};
 const month={unit:'158459',month:'2026-10',documents:[doc,{id:ne2,phase:1,date:'2026-10-10',cents:200},{id:ob,phase:3,date:'2026-10-20',cents:999,paymentLinksChecked:true},{id:ns,phase:2,date:'2026-10-19',cents:999,liquidationLinksChecked:true,relatedIds:[ne]}],relations:[{from:ob,to:ne,cents:80},{from:ob,to:ne2,cents:90}],itemsByDocument:{[ne]:[{seq:1,cents:130,historyChecked:true,movements:[{date:'2026-10-10',type:'original',cents:100},{date:'2026-10-11',type:'reinforcement',cents:50},{date:'2026-10-12',type:'annulment',cents:20}]}]}};
 const idx=buildIntegratedIndex({months:[month],cguContracts:[{...identity,refs:[ne,ne2,ne3]},{...identity,id:43,refs:[ne2]}]});
 const e=cguContractExecutionEvidence(idx,42);
 assert.equal(e.references,3);assert.equal(e.located,2);assert.deepEqual(e.ambiguous,[ne2]);assert.deepEqual(e.missing,[ne3]);assert.equal(e.eligible,1);
 assert.equal(e.reconciled,1);assert.equal(e.movements.initialCents.cents,100);assert.equal(e.movements.reinforcementCents.cents,50);assert.equal(e.movements.annulmentCents.cents,20);assert.equal(e.movements.reconstructedCents.cents,130);
 assert.equal(e.payment.cents,80);assert.equal(e.payment.known,1);assert.equal(e.liquidation.known,0);assert.equal(e.liquidation.unknown,1);
 assert.equal(e.periods[0].payment.cents,80);assert.equal(e.periods[0].initialCents.cents,100);
 assert.equal(cguContractExecutionEvidence(idx,43).payment.known,0);
});
test('historico divergente e impacto sem documento unico nao formam subtotal',()=>{
 const ob='158459000012026OB000001';
 const m={unit:'158459',month:'2026-10',documents:[{id:ne,phase:1,date:'2026-10-10',cents:100}],relations:[{from:ob,to:ne,cents:40}]};
 const i=buildIntegratedIndex({months:[m],cguContracts:[{...identity,refs:[ne]}]});
 const e=cguContractExecutionEvidence(i,42);
 assert.equal(e.movements.initialCents.known,0);assert.equal(e.movements.initialCents.unknown,1);assert.equal(e.payment.known,0);assert.equal(e.payment.unknown,1);
});

test('numero PNCP sem ano e contextualizado somente pela assinatura, nunca pela publicacao',()=>{
 const row={...identity,refs:[ne]};
 const contract={id:'p',source:'pncp',kind:'Contrato',number:'00012',process:identity.process,signed:identity.signed,supplierCnpj:identity.supplierCnpj,unitCode:'158459',publishedMonth:'2027-01'};
 assert.equal(indexCguContractEvidence([row],[contract]).byPncp.get('p')[0].id,42);
 assert.equal(indexCguContractEvidence([row],[{...contract,signed:'2025-10-10'}]).byPncp.size,0);
 assert.equal(indexCguContractEvidence([row],[{...contract,signed:undefined}]).byPncp.size,0);
 assert.equal(indexCguContractEvidence([row],[contract,{...contract,id:'p2'}]).byPncp.size,0);
});

test('NE integral comum permite candidato entre fontes apenas sem concorrencia ou conflito',()=>{
 const row={...identity,refs:[ne]};
 const p={id:'p',source:'pncp',kind:'Contrato',commitmentRefs:[ne]};
 const i=indexCguContractEvidence([row],[p]);
 assert.equal(i.byCgu.get(42).basis,'shared_ne');
 assert.equal(indexCguContractEvidence([row],[p,{...p,id:'p2'}]).byCgu.size,0);
 assert.equal(indexCguContractEvidence([row,{...row,id:43}],[p]).byCgu.size,0);
 assert.equal(indexCguContractEvidence([row],[{...p,process:'23349.000002/2026-01'}]).byCgu.size,0);
 assert.equal(indexCguContractEvidence([row],[{...p,kind:'Nota de empenho'}]).byCgu.size,0);
});
test('NE integral corrobora contexto sem preencher identidade CGU nem agregar valores PNCP',()=>{
 const {process,supplierCnpj,...partial}=identity;
 const row={...partial,refs:[ne]};
 const p={id:'p',source:'pncp',kind:'Contrato',number:'00012',signed:row.signed,unitCode:row.unitCode,process,supplierCnpj};
 const doc={id:ne,phase:1,date:'2026-10-10',cents:100,process,partyRef:supplierCnpj};
 const month={unit:'158459',month:'2026-10',documents:[doc],relations:[]};
 const i=buildIntegratedIndex({months:[month],contracts:[p],cguContracts:[row]});
 assert.equal(i.cguEvidence.byCgu.get(42).basis,'ne_context');
 assert.equal(i.cguEvidence.records.get(42).process,undefined);
 assert.equal(scopeFinancialEvidence(i,'instrument','p').commitment.known,0);
 assert.equal(buildIntegratedIndex({months:[month],contracts:[p,{...p,id:'p2'}],cguContracts:[row]}).cguEvidence.byCgu.size,0);
 const contradictory={...month,documents:[doc,{...doc,id:ne2,process:'23349.000002/2026-01'}]};
 assert.equal(buildIntegratedIndex({months:[contradictory],contracts:[p],cguContracts:[{...row,refs:[ne,ne2]}]}).cguEvidence.byCgu.size,0);
});
test('numero PNCP sem ano nao exige que ano do numero CGU coincida com assinatura',()=>{
 const row={...identity,number:'12/2027',refs:[ne]};
 const p={id:'p',source:'pncp',kind:'Contrato',number:'00012',process:row.process,supplierCnpj:row.supplierCnpj,signed:row.signed,unitCode:row.unitCode};
 assert.equal(indexCguContractEvidence([row],[p]).byCgu.get(42).basis,'administrative_identity');
 assert.equal(indexCguContractEvidence([row],[{...p,number:'12/2026'}]).byCgu.size,0);
});
test('navegacao contratual nao divulga impacto sem checkpoint validado',()=>{
 const ob='158459000012026OB000001';
 const m={unit:'158459',month:'2026-10',documents:[{id:ne,phase:1,date:'2026-10-10',cents:100},{id:ob,phase:3,date:'2026-10-20',cents:999}],relations:[{from:ob,to:ne,cents:80}]};
 const i=buildIntegratedIndex({months:[m],cguContracts:[{...identity,refs:[ne]}]});
 const e=cguContractExecutionEvidence(i,42);
 assert.equal(e.rows[0].paymentLinks[0].id,ob);
 assert.equal(e.rows[0].paymentLinks[0].cents,null);
 assert.equal(e.payment.known,0);
});
