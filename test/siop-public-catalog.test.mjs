import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {refreshPublicDictionaries,readPublicDictionaries,validatePublicDictionaries} from '../src/siop-public-catalog.mjs';
const now=new Date('2026-11-26T12:00:00Z');
const dict=year=>({source:'SIOP',uo:'26422',year,rows:[{kind:'action',code:'20RL',label:'Funcionamento'}],conflicts:0});
test('catalogo idempotente, preserva exercicio indisponivel e recusa dados fora de escopo',async()=>{
 const root=await mkdtemp(join(tmpdir(),'siop-public-'));
 try{
  const read=async y=>({status:'fetched',dictionary:dict(y)});
  assert.equal((await refreshPublicDictionaries({root,now,read})).changed,true);
  const old=await readPublicDictionaries(root,now);
  assert.equal(old.dictionaries.length,3);
  const retry=await refreshPublicDictionaries({root,now,read:async y=>{if(y===2025)throw Error('network');return read(y);}});
  assert.equal(retry.changed,false);assert.equal(retry.statuses[1].status,'previous_preserved');
  assert.deepEqual(await readPublicDictionaries(root,now),old);
  assert.throws(()=>validatePublicDictionaries({...old,dictionaries:[dict(2023)]},now));
  assert.throws(()=>validatePublicDictionaries({...old,dictionaries:[{...dict(2026),rows:[{kind:'action',code:'20RL',label:'CPF 11122233344'}]}]},now));
 }finally{await rm(root,{recursive:true,force:true});}
});
