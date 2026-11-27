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
