import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditInterannualCgu} from '../src/audit-cgu-interannual.mjs';

const prefix='15845926422';
const ne2025=prefix+'2025NE000001',ne2024=prefix+'2024NE000002';
const ne2026=prefix+'2026NE000003',ne2027=prefix+'2027NE000004';
const ns=prefix+'2026NS000010',ob=prefix+'2026OB000011';
const df=prefix+'2026DF000012';
const two=[{
 documents:[{id:ne2025,phase:1,date:'2025-12-03'}],
 relations:[],
 itemsByDocument:{[ne2025]:[
   {seq:1,historyChecked:true,movements:[],historyCheckedAt:'2026-11-02'},
   {seq:2,historyChecked:false}
 ]}
},{
 documents:[
   {id:ns,phase:2,date:'2026-11-10',liquidationLinksChecked:true},
   {id:ob,phase:3,date:'2026-11-10',paymentLinksChecked:false},
   {id:df,phase:3,date:'2026-11-10',paymentLinksChecked:true},
   {id:ne2026,phase:1,date:'2026-11-10'}
 ],
 relations:[{from:ns,to:ne2025,cents:100},
   {from:ns,to:ne2024,cents:200},
   {from:ob,to:ne2024,cents:300},
   {from:df,to:ne2026,cents:10},
   {from:df,to:ne2027,cents:10},
   {from:ns,to:ne2024,cents:200}],
 itemsByDocument:{}
}];
test('somente vinculos oficiais interanuais, sem inferir saldos de RP',()=>{
 const x=auditInterannualCgu(two);
 assert.deepEqual(x.earlierYearRelationships,{NS:2,OB:1,DF:0});
 assert.deepEqual(x.documentsWithEarlierYearNe,{NS:1,OB:1,DF:0});
 assert.equal(x.earlierYearNeDistinct,2);
 assert.equal(x.earlierYearNeWithoutOriginal,1);
 assert.deepEqual(x.missingOriginalByYear,{'2024':1});
 assert.equal(x.documentsWithMultipleEarlierYearNe,1);
 assert.equal(x.sameYearRelationships,1);
 assert.equal(x.futureYearRelationships,1);
 assert.equal(x.invalidSourceRelationships,0);
 assert.deepEqual(x.relationCoverage,{checked:{liquidation:1,payment:1},
   pending:{liquidation:0,payment:1}});
 assert.deepEqual(x.itemHistories,{checked:1,emptyButChecked:1,
   checkedWithoutDate:0,notChecked:1});
 for(const raw of [ne2025,ne2024,ne2026,'100','200','300','CPF'])
   assert.equal(JSON.stringify(x).includes(raw),false);
});
test('nunca trata empenho inexistente no acervo como inexistente na CGU',()=>{
 const withoutOriginal=two.map((d,i)=>i===0?{
   documents:[],relations:[],itemsByDocument:{}
 }:d);
 const x=auditInterannualCgu(withoutOriginal);
 assert.equal(x.earlierYearNeWithoutOriginal,2);
 assert.deepEqual(x.missingOriginalByYear,{'2024':1,'2025':1});
});
test('ids e datas documentais divergentes nao entram em relacoes fabricadas',()=>{
 const bad=[...two,{documents:[{id:ns,phase:2,date:'2026-11-11'}],
   relations:[],itemsByDocument:{}}];
 assert.throws(()=>auditInterannualCgu(bad),/divergente/);
 assert.throws(()=>auditInterannualCgu([{documents:[],relations:{}}]),
   /Competencia documental/);
 assert.equal(auditInterannualCgu([]).earlierYearNeDistinct,0);
});
