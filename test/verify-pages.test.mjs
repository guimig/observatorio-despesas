import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePublication } from '../src/verify-pages.mjs';

test('validação de publicação compara o conteúdo real de cada arquivo',async()=>{
  const files={'index.html':'<html>ok</html>','data/manifest.json':'{}'};
  const requested=[];
  const fetcher=async target=>{
    const url=new URL(target);
    requested.push(url.pathname);
    return {ok:true,text:async()=>files[url.pathname.slice('/observatorio-despesas/'.length)]};
  };
  const result=await comparePublication('https://example.org/observatorio-despesas/',files,{fetcher});
  assert.deepEqual(result,{ok:true,files:2});
  assert.deepEqual(requested,['/observatorio-despesas/index.html',
    '/observatorio-despesas/data/manifest.json']);
});
test('CDN divergente, indisponível ou caminho inesperado falham fechados',async()=>{
  const expected={'index.html':'atual'};
  assert.deepEqual(await comparePublication('https://example.org/',expected,{
    fetcher:async()=>({ok:true,text:async()=>'antigo'})
  }),{ok:false,path:'index.html'});
  assert.deepEqual(await comparePublication('https://example.org/',expected,{
    fetcher:async()=>{throw Error('sem resposta');}
  }),{ok:false,path:'index.html'});
  await assert.rejects(comparePublication('http://example.org/',expected));
  await assert.rejects(comparePublication('https://example.org/',{'../secret':'x'}));
});
