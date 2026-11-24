import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkCguAccess,pickCguAccessControl}
  from '../src/check-cgu-api-access.mjs';

const ne='158459264222026NE000001';
const date='2026-11-13';
const controller={id:ne,date};
const doc=(id=ne)=>({id,date,phase:1});
const fakeMonth=({complete=true,checked=true}={})=>({
 month:'2026-11',documents:[doc()],
 itemsByDocument:{[ne]:[{seq:1,historyChecked:checked,movements:[]}]},
 coverage:[{date,phase:1,complete,count:1,invalid:0}]
});
const reply=(status=200,type='application/json')=>
 new Response(JSON.stringify({data:[]}),{
   status,headers:{'content-type':type}
 });
test('escolhe NE original do acervo validado e rejeita cobertura incompleta',()=>{
 assert.deepEqual(pickCguAccessControl([fakeMonth()]),controller);
 assert.throws(()=>pickCguAccessControl([fakeMonth({complete:false})]),
   /Sem NE controle/);
 assert.throws(()=>pickCguAccessControl([fakeMonth({checked:false})]),
   /Sem NE controle/);
});
test('preflight aprovado executa ate tres controles e nao retorna dados sensiveis',async()=>{
 let requests=[];
 const result=await checkCguAccess({token:'CHAVE_SUPER_PRIVADA',
   control:controller,fetchFn:async(url,options)=>{
     requests.push(url);
     assert.equal(options.headers['chave-api-dados'],'CHAVE_SUPER_PRIVADA');
     assert.equal(options.redirect,'error');
     assert.equal(options.headers.Accept,'application/json');
     return reply();
   }});
 assert.equal(result.status,'authorized');
 assert.equal(result.authorized,true);
 assert.deepEqual(result.checks.map(x=>x.route),['documents','detail','items']);
 assert.deepEqual(result.checks.map(x=>x.status),['ok','ok','ok']);
 assert.equal(requests.length,3);
 assert.ok(requests[0].includes('dataEmissao=13%2F11%2F2026'));
 assert.ok(requests[1].endsWith(ne));
 assert.ok(requests[2].includes('codigoDocumento='+ne));
 for(const privateText of [ne,date,'CHAVE_SUPER_PRIVADA','123.456.789-00']){
   assert.equal(JSON.stringify(result).includes(privateText),false);
 }
});
test('401 em listagem bloqueia as duas rotas seguintes, sem repetir chamadas',async()=>{
 let called=0;
 const result=await checkCguAccess({token:'SECRETO',control:controller,
  fetchFn:async()=>{called++;return reply(401);}});
 assert.equal(called,1);
 assert.deepEqual(result,{status:'blocked',authorized:false,
   checks:[{route:'documents',status:'http_401'}]});
});
test('403 no detalhe bloqueia historicos mesmo com listagem acessivel',async()=>{
 let called=0;
 const result=await checkCguAccess({token:'SECRETO',control:controller,
  fetchFn:async()=>{called++;return reply(called===1?200:403);}});
 assert.equal(called,2);
 assert.deepEqual(result.checks.map(x=>x.status),['ok','http_403']);
 assert.equal(result.authorized,false);
});
test('resposta sem JSON ou com HTTP 200 em HTML nao autoriza diagnóstico',async()=>{
 const result=await checkCguAccess({token:'SECRETO',control:controller,
   fetchFn:async()=>reply(200,'text/html')});
 assert.equal(result.authorized,false);
 assert.equal(result.checks[0].status,'unexpected_content_type');
});
test('falha de rede e 429 retornam status sem corpo nem credencial',async()=>{
 const failed=await checkCguAccess({token:'SECRETO',control:controller,
   fetchFn:async()=>{throw Error('CPF 123.456.789-00 CHAVE PRIVADA');}});
 assert.deepEqual(failed.checks.map(x=>x.status),['network_unavailable']);
 const limited=await checkCguAccess({token:'SECRETO',control:controller,
   fetchFn:async()=>reply(429)});
 assert.deepEqual(limited.checks.map(x=>x.status),['http_429']);
 for(const result of [failed,limited]){
   for(const secret of ['SECRETO','123.456.789-00','CHAVE PRIVADA'])
     assert.equal(JSON.stringify(result).includes(secret),false);
 }
});
test('sem Secret nenhuma consulta externa, sem informar que a credencial falhou',async()=>{
 const output=await checkCguAccess({token:'',fetchFn:async()=>{
   throw Error('Nao consultar CGU');
 }});
 assert.deepEqual(output,{status:'credential_unavailable',
   authorized:false,checks:[]});
 await assert.rejects(checkCguAccess({token:'SECRETO',
   control:{id:ne,date:'2026-11-14x'},fetchFn:async()=>reply()}),
   /Controle CGU invalido/);
});

test('workflow nunca prefixa a expressao secreta da CGU com barra invertida',async()=>{
 const yaml=await readFile(new URL(
   '../.github/workflows/diagnosticar-cronologia-ne-2024.yml',
   import.meta.url),'utf8');
 const good='CGU_API_KEY: ${{ secrets.CGU_API_KEY }}';
 const bad='CGU_API_KEY: '+'\\'+'${{ secrets.CGU_API_KEY }}';
 assert.equal(yaml.includes(bad),false);
 assert.equal(yaml.split(good).length-1,3);
 assert.match(yaml,/steps\.access\.outputs\.authorized == 'true'/);
});
