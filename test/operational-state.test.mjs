import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanState,stateKey,readOperationalState,saveOperationalState,MAX_STATE_BYTES} from '../src/operational-state.mjs';
const now=new Date('2026-11-24'),key=stateKey({id:1});
test('estado descarta chaves inesperadas, datas futuras, invalidas e vencidas',()=>{
 assert.deepEqual(cleanState({[key]:'2026-11-24',secret:'2026-11-24',[stateKey(2)]:'2026-11-31',[stateKey(3)]:'2026-11-25',[stateKey(4)]:'2026-08-01'},{now}),{[key]:'2026-11-24'});
 assert.equal(stateKey({a:1,b:2}),stateKey({b:2,a:1}));
});
test('cache ausente, corrompido ou excessivo retorna estado vazio e permite recuperacao',async()=>{
 const root=await mkdtemp(join(tmpdir(),'observatorio-state-')),path=join(root,'state.json');
 try{
  assert.deepEqual(await readOperationalState(path,{now}),{});
  await writeFile(path,'bad');assert.deepEqual(await readOperationalState(path,{now}),{});
  await writeFile(path,'x'.repeat(MAX_STATE_BYTES+1));assert.deepEqual(await readOperationalState(path,{now}),{});
  await saveOperationalState(path,{[key]:'2026-11-24'},{now});
  assert.deepEqual(await readOperationalState(path,{now}),{[key]:'2026-11-24'});
  assert.equal(JSON.parse(await readFile(path,'utf8'))[key],'2026-11-24');
 }finally{await rm(root,{recursive:true,force:true})}
});
