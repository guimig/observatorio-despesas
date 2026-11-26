import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterStructuredNotice,filterStructuredContract,parseReaisFilter,filterDates,validityStatus,dateRangeMatch,filterStructuredAta,filterStructuredTenderItem,matchesCatalogSearch} from '../assets/procurement-structured-filters.js';
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

test('intervalos inclusivos, validade real e periodos de publicacao mensal',()=>{
 assert.equal(dateRangeMatch('2026-11-30','2026-11-01','2026-11-30'),true);
 assert.equal(dateRangeMatch('2026-02-30','2026-01-01','2026-12-31'),false);
 assert.equal(dateRangeMatch('2026-11','2026-11-20','2026-12-03',true),true);
 assert.equal(dateRangeMatch(null,'2026-11-01',''),false);
 assert.equal(dateRangeMatch('2026-11-01','2026-12-01','2026-10-01'),false);
});
test('contrato combina assinatura, vencimento e situacao sem presumir datas ausentes',()=>{
 const c={signed:'2026-01-15',starts:'2026-02-01',ends:'2026-12-31'};
 assert.equal(filterStructuredContract(c,{dateKind:'signed',dateFrom:'2026-01-01',dateTo:'2026-01-31',dueFrom:'2026-12-01',validity:'current',today:'2026-11-26'}),true);
 assert.equal(filterStructuredContract(c,{dateKind:'signed',dateTo:'2026-01-14'}),false);
 assert.equal(filterStructuredContract(c,{dueTo:'2026-12-30'}),false);
 assert.equal(validityStatus({...c,cancelled:true},'2026-11-26'),'cancelled');
 assert.equal(validityStatus({starts:c.starts},'2026-11-26'),'unknown');
 assert.equal(validityStatus(c,'2026-12-31'),'current');
 assert.equal(validityStatus(c,'2027-01-01'),'expired');
});
test('ata filtra suas proprias datas e metadados, nunca data de licitacao',()=>{
 const ata={signed:'2026-01-01',starts:'2026-02-01',ends:'2026-12-31',allowsAdhesion:false};
 assert.equal(filterStructuredAta(ata,{files:[{seq:1}],compras:{items:[{}]}},{items:'yes',files:'yes',adhesion:'no',dueFrom:'2026-12-01'}),true);
 assert.equal(filterStructuredAta(ata,{}, {files:'empty'}),false);
 assert.equal(filterStructuredAta(ata,{files:[]}, {files:'empty'}),true);
 assert.equal(filterStructuredAta(ata,{files:[]}, {files:'pending'}),false);
 assert.equal(filterStructuredAta(ata,{}, {files:'pending'}),true);
});
test('itens distinguem resultado ausente, vazio, data de homologacao e publicacao',()=>{
 const i={checkedAt:'2026-11-01',results:[{date:'2026-09-01'}]},n={published:'2026-08-01',srp:true,modality:6};
 assert.equal(filterStructuredTenderItem(i,n,{dateKind:'resultDate',dateFrom:'2026-09-01',result:'has',srp:'yes',modality:'6'}),true);
 assert.equal(filterStructuredTenderItem(i,n,{dateKind:'published',dateFrom:'2026-09-01'}),false);
 assert.equal(filterStructuredTenderItem({},n,{result:'pending'}),true);
 assert.equal(filterStructuredTenderItem({results:[]},n,{result:'empty'}),true);
 assert.equal(matchesCatalogSearch('educacao 12345678000190',['Educação','12.345.678/0001-90']),true);
});
