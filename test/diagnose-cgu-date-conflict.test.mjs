import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findConflictingCommitments,diagnoseDateConflict} from '../src/diagnose-cgu-date-conflict.mjs';
const id='158459000012026NE000001';
const months=[{documents:[{id,phase:1,date:'2026-11-24'}]}];
const patch={coverage:{phase:1,complete:true},documents:[{id,phase:1,date:'2026-11-25'}]};
const now=new Date('2026-11-27T15:00:00Z');
const budget={stopped:()=>false,snapshot:()=>({requests:0})};
test('localiza conflito de data sem tratar mesma data como duplicata',()=>{
 assert.equal(findConflictingCommitments(months,patch).length,1);
 assert.equal(findConflictingCommitments(months,{...patch,documents:months[0].documents}).length,0);
});
test('consulta individual e movimentos sao classificados sem ID e sem alterar acervo',async()=>{
 const before=JSON.stringify(months);
 const result=await diagnoseDateConflict({months,date:'2026-11-25',now,token:'fake',budget,
  collect:async()=>patch,detail:async()=>({documento:id,codigoUg:'158459',fase:1,data:'24/11/2026',dataEmissao:'24/11/2026'}),
  items:async()=>({ok:true,items:[{seq:1}]}),history:async()=>({ok:true,movements:[
   {date:'2026-11-24',type:'original'},{date:'2026-11-25',type:'reinforcement'}]})});
 assert.equal(result.conflicts,1);assert.equal(result.samples[0].dateFields.data,'canonical_date');
 assert.equal(result.samples[0].movements.reconsulted_date.reinforcement,1);
 assert.ok(!JSON.stringify(result).includes(id));assert.equal(JSON.stringify(months),before);
});
test('nao usa campos de resposta com identidade divergente',async()=>{
 const result=await diagnoseDateConflict({months,date:'2026-11-25',now,token:'fake',budget,
  collect:async()=>patch,detail:async()=>({documento:'outro',codigoUg:'158459',fase:1,data:'25/11/2026'}),
  items:async()=>({ok:false})});
 assert.equal(result.samples[0].detailStatus,'identity_unverified');
 assert.equal(result.samples[0].dateFields,undefined);
 await assert.rejects(diagnoseDateConflict({months,date:'2026-11-27',now,token:'fake',budget}));
});
