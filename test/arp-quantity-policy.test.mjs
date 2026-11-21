import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArpQuantity,summarizeArpQuantity} from '../src/arp-quantity-policy.mjs';
const base={source:'https://pncp.gov.br/app/atas',observedAt:'2026-11-21'};
test('quantidade institucional exige fonte e data',()=>{
 assert.equal(normalizeArpQuantity({...base,type:'registered',value:100}).scope,'institutional');
 assert.throws(()=>normalizeArpQuantity({type:'registered',value:100}));
 assert.throws(()=>normalizeArpQuantity({...base,type:'registered',value:-1}));
});
test('saldo de adesao nao se transforma em saldo contratavel',()=>{
 const r=summarizeArpQuantity([{...base,type:'adhesion_balance',value:20}]);
 assert.equal(r.available,undefined);
 assert.equal(r.adhesion_balance.value,20);
});
test('reserva do campus nao e inferida de quantidade IFC',()=>{
 const r=summarizeArpQuantity([{...base,type:'tendered',value:1000},{...base,type:'registered',value:900}]);
 assert.equal(r.campus_reserved,undefined);
 assert.throws(()=>summarizeArpQuantity([
  {...base,type:'registered',value:10},{...base,type:'registered',value:10}
 ]));
});
