import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectHistoricalDate,phasesMissingOnDate,safeFailureCategory} from '../src/historical-collector.mjs';

const date='08/12/2025', iso='2025-12-08';
const patch=(phase,{complete=true,invalid=0}={})=>({
  documents:[],links:[],coverage:{date:iso,phase,complete,invalid,count:0}
});

test('isola falha da fase 2 e persiste fases 1 e 3 sem mascarar cobertura',async()=>{
 const saved=[],events=[];
 const result=await collectHistoricalDate({date,
  collect:async(_date,phase)=>{
   if(phase===2)throw Error('Documento não corresponde à UG 158459');
   return patch(phase);
  },persist:async p=>saved.push(p.coverage.phase),logger:e=>events.push(e)});
 assert.deepEqual(saved,[1,3]);
 assert.equal(result.fullyComplete,false);
 assert.equal(result.consulted,2);
 assert.equal(result.failed,1);
 assert.equal(result.failures.document_identity,1);
 assert.deepEqual(events.filter(e=>e.status==='failed').map(e=>e.phase),[2]);
 assert.equal(JSON.stringify(events).includes('158459000012025NE'),false);
});

test('reexecucao consulta apenas fase pendente depois de checkpoint',async()=>{
 const existing={coverage:[patch(1).coverage,patch(3).coverage]};
 const attempted=[];
 assert.deepEqual(phasesMissingOnDate(existing,date),[2]);
 const result=await collectHistoricalDate({date,existing,
  collect:async(_,phase)=>{attempted.push(phase);return patch(phase);},
  persist:async()=>{}});
 assert.deepEqual(attempted,[2]);
 assert.equal(result.fullyComplete,true);
});

test('consulta vazia validada e completa nao significa dia com dados',async()=>{
 const result=await collectHistoricalDate({date,
  collect:async(_,phase)=>patch(phase),persist:async()=>{}});
 assert.equal(result.fullyComplete,true);
 assert.equal(result.documents,0);
});

test('fase parcial ou valor indisponivel nao se torna completa',async()=>{
 const result=await collectHistoricalDate({date,
  collect:async(_,phase)=>patch(phase,{complete:phase!==2,invalid:phase===2?1:0}),
  persist:async()=>{}});
 assert.equal(result.fullyComplete,false);
 assert.equal(result.consulted,3);
 assert.deepEqual(phasesMissingOnDate({coverage:[patch(1).coverage,patch(2,{complete:false}).coverage,patch(3).coverage]},date),[2]);
});

test('falha na persistencia aborta o lote, sem ocultar erro operacional',async()=>{
 await assert.rejects(collectHistoricalDate({date,
  collect:async(_,phase)=>patch(phase),
  persist:async()=>{throw Error('disk failure');}}),/disk failure/);
});

test('falhas de categorias conhecidas nao vazam mensagens ou payloads',()=>{
 assert.equal(safeFailureCategory({status:429}),'http_429');
 assert.equal(safeFailureCategory({code:'CGU_INVALID_SHAPE'}),'invalid_schema');
 assert.equal(safeFailureCategory({code:'CGU_TRANSPORT'}),'network');
 assert.equal(safeFailureCategory({code:'CGU_TIMEOUT'}),'timeout');
 assert.equal(safeFailureCategory({message:'Documento CGU duplicado divergente'}),'duplicate_document_conflict');
 assert.equal(safeFailureCategory({message:'Identificador sigiloso 123'}),'validation_or_other');
});
