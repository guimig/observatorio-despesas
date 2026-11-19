import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationUrl,summarizeStructure,MODALITIES} from '../src/inspect-pncp-publications.mjs';

test('modalidades PNCP compreendem pregões, concorrências, dispensa, inexigibilidade e demais',()=>{
 assert.equal(Object.keys(MODALITIES).length,14);
 const p=new URL(publicationUrl(8));
 assert.equal(p.searchParams.get('cnpj'),'10635424000186');
 assert.equal(p.searchParams.get('codigoModalidadeContratacao'),'8');
 assert.throws(()=>publicationUrl(99));
});
test('logs estruturalmente seguros não expõem dados pessoais nem objeto',()=>{
 const result=summarizeStructure({data:[{
  numeroControlePNCP:'PNCP-PRIVADO',numeroCompra:'00001',
  processo:'23349.001122/2026-13',objetoCompra:'NOME PRIVADO',
  unidadeOrgao:{codigoUnidade:'158125'},niFornecedor:'000.123.456-78'
 }],totalPaginas:1});
 const txt=JSON.stringify(result);
 assert.equal(txt.includes('000.123.456-78'),false);
 assert.equal(txt.includes('NOME PRIVADO'),false);
 assert.equal(txt.includes('23349.001122/2026-13'),false);
 assert.match(txt,/unidadeOrgao.codigoUnidade:string/);
});
