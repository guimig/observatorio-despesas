import {test} from 'node:test';
import assert from 'node:assert/strict';
import {participantsUrl,normalizeParticipants,scanParticipants,classifyCampusPart} from '../src/pncp-ata-participants.mjs';
import {planParticipants,validateParticipants,validateParticipantReferences,mergeParticipantCheck,participationKey} from '../src/collect-pncp-ata-participants.mjs';
const ata={id:'10635424000186-1-000001/2026:ata:1',procurementId:'10635424000186-1-000001/2026',sequence:1};
test('consulta lista de partes PNCP sem inferir contratacao',async()=>{
 assert.match(participantsUrl(ata),/\/atas\/1\/partesenvolvidas$/);
 const result=await scanParticipants(ata,{fetcher:async()=>({data:[
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000348'},unidade:{codigo:'158459'}},
  {tipoParteEnvolvida:{id:1},orgao:{cnpj:'10635424000186'},unidade:{codigo:'158125'}}
 ],totalPaginas:1,totalRegistros:2})});
 assert.deepEqual(result.campusRoles,[]);
 assert.deepEqual(result.candidateRoles,[2]);
 assert.equal(result.checkedComplete,true);
});
test('sem evidencia dupla de CNPJ e UG nao confirma campus',()=>{
 const result=normalizeParticipants({data:[
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000186'},unidade:{codigo:'158459'}},
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000348'},unidade:{codigo:'158125'}}
 ],totalPaginas:1,totalRegistros:2});
 assert.deepEqual(result.campusRoles,[]);
});
test('paginas incompletas nao viram ausencia de participacao',()=>{
 assert.throws(()=>normalizeParticipants({data:[],totalPaginas:2,totalRegistros:1}));
 assert.deepEqual(normalizeParticipants({data:[],totalPaginas:0,totalRegistros:0}).campusRoles,[]);
});
test('consulta incremental e validacao de dados minimizados',()=>{
 assert.equal(planParticipants([ata],[],new Date(),12).length,1);
 const data={schema_version:1,checks:[{ataId:ata.id,checkedAt:'2026-11-21',campusRoles:[2]}]};
 assert.equal(validateParticipants(data).checks.length,1);
 assert.equal(planParticipants([ata],data.checks,new Date('2026-11-22')).length,0);
});

test('cobertura diversificada seleciona compras diferentes antes de repetir atas',()=>{
 const id='10635424000186-1-000001/2026';
 const other='10635424000186-1-000002/2026';
 const atas=[
  ...Array.from({length:30},(_,i)=>({id:id+':ata:'+(i+1),procurementId:id,sequence:i+1})),
  {id:other+':ata:1',procurementId:other,sequence:1}
 ];
 const planned=planParticipants(atas,[],new Date('2026-11-21'),2);
 assert.equal(planned.length,2);
 assert.equal(new Set(planned.map(a=>a.procurementId)).size,2);
 assert.deepEqual(planned.map(a=>a.sequence),[1,1]);
 const checks=planned.map(a=>({ataId:a.id,checkedAt:'2026-11-21',campusRoles:[]}));
 const second=planParticipants(atas,checks,new Date('2026-11-22'),2);
 assert.equal(second[0].sequence,2);
 assert.equal(second[0].procurementId,id);
});

test('diagnostico so revela contagens de campos, nunca valores pessoais',()=>{
 const result=normalizeParticipants({data:[{
  tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000348'},
  unidade:{codigo:'158459'},nome:'Pessoa hipotetica'
 }],totalPaginas:1,totalRegistros:1});
 assert.equal(result.shape.rows,1);
 assert.equal(result.shape.matchedBoth,1);
 assert.equal(result.shape.recognizedRole,1);
 assert.equal(JSON.stringify(result).includes('Pessoa hipotetica'),false);
 assert.equal(JSON.stringify(result).includes('10635424000348'),false);
});

test('nao publica participacao vinculada a ata inexistente',()=>{
 const data={schema_version:1,checks:[{ataId:ata.id,checkedAt:'2026-11-21',campusRoles:[]}]};
 assert.equal(validateParticipantReferences(data,[ata]),data);
 assert.throws(()=>validateParticipantReferences(data,[]),/ausente/);
});

test('contagens diferenciam Reitoria, Campus e outros sem revelar identificadores',()=>{
 const result=normalizeParticipants({data:[
  {tipoParteEnvolvida:{id:1},orgao:{cnpj:'10635424000186'},unidade:{codigo:'158125'}},
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000348'},unidade:{codigo:'158459'}},
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'00000000000000'},unidade:{codigo:'999999'}}
 ],totalPaginas:1,totalRegistros:3});
 assert.equal(result.shape.reitoriaCnpj,1);
 assert.equal(result.shape.reitoriaUnit,1);
 assert.equal(result.shape.matchedBoth,1);
 assert.equal(result.shape.otherCnpj,1);
 assert.equal(result.shape.otherUnit,1);
 assert.equal(JSON.stringify(result).includes('999999'),false);
});

test('UG SIAFI nao e prova de unidade PNCP; exigir mapeamento documentado',()=>{
 assert.equal(classifyCampusPart('10635424000348','158459',2),'candidate');
 assert.equal(classifyCampusPart('10635424000348','PNCP-UNIDADE-VALIDADA',2,['PNCP-UNIDADE-VALIDADA']),'confirmed');
 assert.equal(classifyCampusPart('10635424000186','158125',1),'not_confirmed');
});

test('reconferencia de papeis identicos fica no cache sem apagar primeira evidencia',()=>{
 const first=mergeParticipantCheck(null,ata.id,[],'2026-10-01',{operational:true});
 const again=mergeParticipantCheck(first,ata.id,[],'2026-11-26',{operational:true});
 assert.strictEqual(again,first);
 const now=new Date('2026-11-26T12:00:00Z');
 assert.equal(planParticipants([ata],[first],now,12).length,1);
 assert.equal(planParticipants([ata],[first],now,12,{[participationKey(first)]:'2026-11-26'}).length,0);
 const changed=mergeParticipantCheck(first,ata.id,[2],'2026-11-26',{operational:true});
 assert.equal(changed.checkedAt,'2026-11-26');assert.deepEqual(changed.campusRoles,[2]);
 assert.notEqual(participationKey(first),participationKey(changed));
});
