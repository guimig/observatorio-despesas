import {test} from 'node:test';
import assert from 'node:assert/strict';
import {participantsUrl,normalizeParticipants,scanParticipants} from '../src/pncp-ata-participants.mjs';
import {planParticipants,validateParticipants} from '../src/collect-pncp-ata-participants.mjs';
const ata={id:'10635424000186-1-000001/2026:ata:1',procurementId:'10635424000186-1-000001/2026',sequence:1};
test('consulta lista de partes PNCP sem inferir contratacao',async()=>{
 assert.match(participantsUrl(ata),/\/atas\/1\/partesenvolvidas$/);
 const result=await scanParticipants(ata,{fetcher:async()=>({data:[
  {tipoParteEnvolvida:{id:2},orgao:{cnpj:'10635424000348'},unidade:{codigo:'158459'}},
  {tipoParteEnvolvida:{id:1},orgao:{cnpj:'10635424000186'},unidade:{codigo:'158125'}}
 ],totalPaginas:1,totalRegistros:2})});
 assert.deepEqual(result.campusRoles,[2]);
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
