import {test} from 'node:test';
import assert from 'node:assert/strict';
import {procurementKey,identityCounts,probeCguProcurement,selectProcesses} from '../src/probe-cgu-procurement.mjs';
const proc='23349.000001/2026-01',ne='158459000012026NE000001';
const row={licitacao:{numero:'00001/2026',numeroProcesso:proc},modalidadeLicitacao:'Pregão',unidadeGestora:{codigo:'158125'}};
const modalities=[{codigo:'05',descricao:'Pregão'}];
test('chave oficial CGU, sem adivinhar modalidade, UG ou ano',()=>{
 assert.deepEqual(procurementKey(row,modalities),{codigoUG:'158125',numero:'000012026',codigoModalidade:'05'});
 assert.equal(procurementKey(row,[...modalities,{codigo:'06',descricao:'Pregão'}]),null);
 assert.equal(procurementKey({...row,licitacao:{numero:'1/2023'}},modalities),null);
 assert.equal(procurementKey({...row,unidadeGestora:{codigo:'158000'}},modalities),null);
 assert.deepEqual(selectProcesses([{process:'23349.000001/2023-01'},{process:proc}]),[proc]);
});
test('sondagem restrita usa chaves observadas, preserva erro, nao registra dados individuais',async()=>{
 const paths=[];
 const budget={stopped:()=>false,snapshot:()=>({})};
 const r=await probeCguProcurement({token:'SEGREDO',notices:[{process:proc}],months:[{documents:[{id:ne,phase:1}]}],
 now:new Date('2026-11-26T12:00:00Z'),budget,request:async url=>{
  const u=new URL(url);paths.push(u.pathname);
  if(u.pathname.endsWith('/modalidades'))return modalities;
  if(u.pathname.endsWith('/por-processo'))return [row];
  if(u.pathname.endsWith('/empenhos')){assert.equal(u.searchParams.get('codigoUG'),'158125');return [{empenho:ne,observacao:'dado pessoal'}];}
  if(u.pathname.endsWith('/contratos-relacionados-licitacao'))return [{id:42,dataAssinatura:'2026-05-01',unidadeGestora:{codigo:'158125'}}];
  if(u.pathname.endsWith('/documentos-relacionados'))return [{empenho:ne}];
  return [];
 }});
 assert.equal(r.purchaseLookups[0].knownCampusNe,1);
 assert.equal(r.contractLookups[0].fullCampusNe,1);
 assert.ok(paths.length<=25);
 for(const value of [proc,ne,'dado pessoal','SEGREDO'])assert.equal(JSON.stringify(r).includes(value),false);
 assert.equal(identityCounts([{empenho:'2026NE000001'}],new Set(),'empenho').shortNe,1);
});
