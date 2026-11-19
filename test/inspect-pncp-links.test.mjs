import{test}from'node:test';
import assert from'node:assert/strict';
import{linkedContractsUrl,contractDetailUrl,summarizeShape}from'../src/inspect-pncp-links.mjs';
test('URLs oficiais derivadas do ID PNCP, nunca de processo digitado',()=>{
 assert.equal(new URL(linkedContractsUrl('10635424000186-1-000263/2026')).pathname,
  '/api/pncp/v1/orgaos/10635424000186/contratos/contratacao/2026/263');
 assert.equal(new URL(contractDetailUrl('10635424000186-2-001685/2026')).pathname,
  '/api/pncp/v1/orgaos/10635424000186/contratos/2026/1685');
 assert.throws(()=>linkedContractsUrl('23349.000111/2026-18'));
});
test('diagnóstico não contém valores pessoais ou números de contrato',()=>{
 const s=JSON.stringify(summarizeShape([{
  numeroControlePNCP:'10635424000186-2-001685/2026',
  nomeFornecedor:'NOME DE PESSOA',
  cpf:'000.123.456-78',
  processo:'23349.000111/2026-18'
 }]));
 assert.equal(s.includes('001685'),false);
 assert.equal(s.includes('NOME DE PESSOA'),false);
 assert.equal(s.includes('000.123.456-78'),false);
 assert.equal(s.includes('23349.000111'),false);
});
