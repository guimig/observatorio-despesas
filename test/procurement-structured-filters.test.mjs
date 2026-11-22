import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterStructuredNotice,filterStructuredContract,parseReaisFilter} from '../assets/procurement-structured-filters.js';
test('SRP distingue sim, nao e nao informado',()=>{
 assert.equal(filterStructuredNotice({srp:true},{srp:'yes'}),true);
 assert.equal(filterStructuredNotice({},{srp:'no'}),false);
 assert.equal(filterStructuredNotice({srp:false},{srp:'no'}),true);
});
test('limites monetarios exigem campo existente e respeitam centavos',()=>{
 assert.equal(parseReaisFilter('1.234'),null);
 assert.equal(parseReaisFilter('1234,56'),123456);
 assert.equal(filterStructuredNotice({estimatedCents:123456},{minCents:123456,maxCents:123456}),true);
 assert.equal(filterStructuredNotice({},{minCents:0}),false);
 assert.equal(filterStructuredContract({amountCents:100},{maxCents:99}),false);
});
test('vigencia requer inicio e fim e respeita inclusao dos extremos',()=>{
 const c={starts:'2026-01-01',ends:'2026-12-31'};
 assert.equal(filterStructuredContract(c,{activeOn:'2026-12-31'}),true);
 assert.equal(filterStructuredContract(c,{activeOn:'2027-01-01'}),false);
 assert.equal(filterStructuredContract({starts:'2026-01-01'},{activeOn:'2026-06-01'}),false);
});
