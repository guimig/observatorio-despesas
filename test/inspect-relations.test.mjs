import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentImpactUrl,itemsUrl,structuralSummary } from '../src/inspect-relations-cgu.mjs';

const p='158459000012026OB000001';
const ne='158459000012026NE000001';
test('URLs usam apenas documento oficial e fase 3',()=>{
 const a=new URL(paymentImpactUrl(p,2));
 assert.equal(a.searchParams.get('fase'),'3');
 assert.equal(a.searchParams.get('codigoDocumento'),p);
 assert.equal(a.searchParams.get('pagina'),'2');
 assert.equal(new URL(itemsUrl(ne)).pathname,'/api-de-dados/despesas/itens-de-empenho');
 assert.throws(()=>paymentImpactUrl('00012345678'));
 assert.throws(()=>itemsUrl(p));
});
test('inspeção não revela valores sensíveis, apenas formatos e contagens',()=>{
 const s=JSON.stringify(structuralSummary([
  {empenho:ne, valorPago:'150,00',valorRestoPago:null,descricao:'CPF 000.123.456-78'},
  {empenho:ne, valorPago:null,valorRestoPago:'123,00',descricao:'NOME PRIVADO'}
 ]));
 assert.equal(s.includes('000.123.456-78'),false);
 assert.equal(s.includes('NOME PRIVADO'),false);
 assert.equal(s.includes(ne),false);
 assert.equal(JSON.parse(s).present.valorPago.filled,1);
 assert.equal(JSON.parse(s).present.valorRestoPago.filled,1);
});
