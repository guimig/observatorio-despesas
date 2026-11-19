import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pncpUrl,comprasUasgUrl,comprasContractsUrl,safeSummary} from '../src/inspect-procurement.mjs';
test('consultas limitadas ao campus, sem credencial, com paginação',()=>{
 const p=new URL(pncpUrl('20261001','20261031'));
 assert.equal(p.searchParams.get('cnpjOrgao'),'10635424000348');
 assert.equal(p.searchParams.get('pagina'),'1');
 const c=new URL(comprasUasgUrl());
 assert.equal(c.searchParams.get('codigoUasg'),'158459');
 assert.equal(new URL(comprasContractsUrl(26422)).searchParams.get('codigoUnidadeGestora'),'158459');
 assert.throws(()=>comprasContractsUrl('../../secret'));
});
test('diagnóstico não revela nomes, CPFs, CNPJ de fornecedor ou objetos',()=>{
 const s=JSON.stringify(safeSummary({status:200,body:{
  dados:[{numeroControlePNCP:'test',niFornecedor:'000.123.456-78',nomeRazaoSocialFornecedor:'DADO PESSOAL',
  objetoContrato:'informações restritas',orgaoEntidade:{cnpj:'10635424000348'}}],
  totalPaginas:1
 }}));
 assert.equal(s.includes('000.123.456-78'),false);
 assert.equal(s.includes('DADO PESSOAL'),false);
 assert.equal(s.includes('informações restritas'),false);
 assert.match(s,/orgaoEntidade.cnpj:string/);
});
