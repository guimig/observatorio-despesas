import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItem,resolveItems} from '../src/enrich-cgu.mjs';
import {normalizeMovement,resolveItemMovements,historyUrl,officialDecimal,movementClass} from '../src/item-movements.mjs';
import {normalizeDocument} from '../src/cgu.mjs';
import {emptyMonth,mergeMonth,validateMonth,applyDocumentEnrichment} from '../src/store.mjs';
import {planEnrichment} from '../src/enrich-month.mjs';

const ne='158459264222026NE000288';
const rows=[
 {sequencial:1,codigoItemEmpenho:ne,codigoSubelemento:'11',descricaoSubelemento:'MATERIAL QUIMICO',
  descricao:'Item compra: 00006 - ACETATO DE ETILA, '+
   ('ASPECTO FISICO LIQUIDO INCOLOR, LIMPIDO, INFLAMAVEL. '.repeat(10)).trim(),
  valorAtual:'300,00'},
 {sequencial:2,codigoItemEmpenho:ne,codigoSubelemento:'11',descricaoSubelemento:'MATERIAL QUIMICO',
  descricao:'Item compra: 00008 - ACETONA, ASPECTO FISICO LIQUIDO LIMPIDO TRANSPARENTE',
  valorAtual:'150,00'},
 {sequencial:3,codigoItemEmpenho:ne,codigoSubelemento:'11',descricaoSubelemento:'MATERIAL QUIMICO',
  descricao:'Item compra: 00142 - ETER DIETILICO, '+
   ('COMPOSICAO QUIMICA, ASPECTO FISICO LIQUIDO LIMPIDO E INCOLOR. '.repeat(9)).trim(),
  valorAtual:'200,00'},
 {sequencial:4,codigoItemEmpenho:ne,codigoSubelemento:'11',descricaoSubelemento:'MATERIAL QUIMICO',
  descricao:'Item compra: 00157 - HEXANO, PUREZA MINIMA DE 97%',
  valorAtual:'144,85'}
];
const history=(quantity,unit,total,operation='Inclusão',date='18/11/2026')=>({
 data:date,operacao:operation,quantidade:quantity,valorUnitario:unit,valorTotal:total
});
test('NE 2026NE000288: quatro sequenciais, quatro compras, quatro descricoes e R$ 794,85',async()=>{
 const outcome=await resolveItems(ne,{token:'fake',request:async(_,page)=>page===1?rows:[]});
 assert.equal(outcome.ok,true);
 assert.deepEqual(outcome.items.map(x=>x.seq),[1,2,3,4]);
 assert.deepEqual(outcome.items.map(x=>x.purchaseItem),['00006','00008','00142','00157']);
 assert.ok(outcome.items[0].description.length>260);
 assert.ok(outcome.items[2].description.length>260);
 assert.match(outcome.items[0].description,/ACETATO DE ETILA/);
 assert.match(outcome.items[2].description,/ETER DIETILICO/);
 assert.ok(outcome.items.every(x=>x.sub==='11'&&x.subdesc==='MATERIAL QUIMICO'));
 assert.deepEqual(outcome.items.map(x=>x.cents),[30000,15000,20000,14485]);
 assert.equal(outcome.items.reduce((s,x)=>s+x.cents,0),79485);
 const month=mergeMonth(emptyMonth('2026-11'),'2026-11',[{
  documents:[{id:ne,date:'2026-11-18',phase:1,cents:79485}],
  links:[],coverage:{date:'2026-11-18',phase:1,complete:true,count:1,invalid:0}
 }]).data;
 const old=applyDocumentEnrichment(month,ne,{kind:'items',items:rows.map(row=>({
  seq:row.sequencial,sub:'11',subdesc:'MATERIAL QUIMICO',
  ...(row.sequencial===2?{description:'ACETONA'}:{}),cents:100
 }))}).data;
 const legacy=structuredClone(old);
 delete legacy.documents[0].itemsDetailVersion;
 assert.deepEqual(planEnrichment(legacy).items,[ne]);
 const upgraded=applyDocumentEnrichment(legacy,ne,{kind:'items',items:outcome.items}).data;
 assert.equal(upgraded.documents[0].itemsDetailVersion,2);
 assert.equal(planEnrichment(upgraded).items.length,0);
 assert.equal(planEnrichment(upgraded).itemHistories.length,4);
 assert.doesNotThrow(()=>validateMonth(upgraded));
});
test('historico de itens preserva data, operacao, quantidade, unitario e total',async()=>{
 const records=[
  history('10,00000','30,0000','300,00'),
  history('2,00000','30,0000','60,00','Reforço','20/11/2026'),
  history('1,00000','30,0000','30,00','Anulação','21/11/2026')
 ];
 const output=await resolveItemMovements(ne,1,{token:'fake',
  request:async(_,seq,page)=>page===1?records:[]});
 assert.equal(output.ok,true);
 assert.deepEqual(output.movements.map(x=>x.type),['original','reinforcement','annulment']);
 assert.deepEqual(output.movements.map(x=>x.date),
  ['2026-11-18','2026-11-20','2026-11-21']);
 assert.equal(output.movements[0].quantity,'10.00000');
 assert.equal(output.movements[0].unitPrice,'30.0000');
 assert.equal(output.movements[0].cents,30000);
 assert.equal(output.movements[2].cents,3000);
 assert.equal(movementClass('ESTORNO'),'reversal');
 assert.equal(officialDecimal('1.234,56789'),'1234.56789');
 assert.match(historyUrl(ne,1),/sequencial=1/);
});
test('NAO infere quantidade ou saldo a partir de valor atual sem historico',()=>{
 const item=normalizeItem(rows[0]);
 assert.equal(item.quantity,undefined);
 assert.equal(item.unitPrice,undefined);
 assert.equal(item.movements,undefined);
 assert.equal(item.historyChecked,undefined);
});
test('dados de movimentos ficam isolados por item e persistem no reprocessamento',()=>{
 const base=mergeMonth(emptyMonth('2026-11'),'2026-11',[{
  documents:[{id:ne,date:'2026-11-18',phase:1,cents:79485}],
  links:[],coverage:{date:'2026-11-18',phase:1,complete:true,count:1,invalid:0}
 }]).data;
 let next=applyDocumentEnrichment(base,ne,{kind:'items',items:rows.map(normalizeItem)}).data;
 const movements=[normalizeMovement(history('5,00000','30,0000','150,00'))];
 next=applyDocumentEnrichment(next,ne,{kind:'itemHistory',seq:2,movements}).data;
 assert.equal(next.itemsByDocument[ne][0].historyChecked,undefined);
 assert.equal(next.itemsByDocument[ne][1].movements[0].quantity,'5.00000');
 assert.equal(planEnrichment(next).itemHistories.length,3);
 const same=applyDocumentEnrichment(next,ne,{kind:'items',items:rows.map(normalizeItem)});
 assert.equal(same.changed,false);
 const cloned=mergeMonth(next,'2026-11',[{
  documents:[{id:ne,date:'2026-11-18',phase:1,cents:79485}],
  links:[],coverage:{date:'2026-11-18',phase:1,complete:true,count:1,invalid:0}
 }]);
 assert.equal(cloned.data.itemsByDocument[ne][1].historyChecked,true);
 assert.doesNotThrow(()=>validateMonth(cloned.data));
});
test('multiplos subelementos nao confundem o codigo da compra com a rubrica',()=>{
 const first=normalizeItem(rows[0]);
 const second=normalizeItem({...rows[1],codigoSubelemento:'16',
  descricaoSubelemento:'MATERIAL DE EXPEDIENTE'});
 assert.equal(first.sub,'11');
 assert.equal(second.sub,'16');
 assert.equal(second.purchaseItem,'00008');
});
test('historico incompleto nao e publicado como concluido',async()=>{
 const partial=await resolveItemMovements(ne,1,{token:'fake',limit:1,
  request:async()=>[history('10,00000','30,0000','300,00')]});
 assert.deepEqual(partial,{ok:false,reason:'limite_paginacao'});
 const invalid=await resolveItemMovements(ne,1,{token:'fake',
  request:async(_,__,page)=>page===1?[history('10,00000','30,0000','abc')]:[]});
 assert.deepEqual(invalid,{ok:false,reason:'movimentacao_invalida'});
});
test('descricoes longas para NS e OB preservadas apenas quando publicaveis',()=>{
 const idNS='158459264222026NS000288';
 const idOB='158459264222026OB000288';
 const text='LIQUIDACAO REFERENTE A PRESTACAO DE SERVICOS PREVISTOS NO PROCESSO ADMINISTRATIVO.';
 const ns=normalizeDocument({codigoUg:'158459',documento:idNS,
  valor:'10,00',observacao:text},'18/11/2026',2);
 const ob=normalizeDocument({codigoUg:'158459',documento:idOB,
  valor:'10,00',observacao:'Pagamento conforme comprovantes.'},'18/11/2026',3);
 assert.equal(ns.description,text);
 assert.equal(ob.description,'Pagamento conforme comprovantes.');
 const unsafe=normalizeDocument({codigoUg:'158459',documento:idOB,
  valor:'10,00',observacao:'Contato user@example.com'},'18/11/2026',3);
 assert.equal(unsafe.description,undefined);
});

import {historyKey,historyCheckpoint} from '../src/enrich-month.mjs';
test('checkpoint operacional de historico depende do conteudo e nao altera documento',()=>{
 const doc={id:ne,cents:100};
 const item={seq:1,cents:100,historyChecked:true,historyCheckedAt:'2026-10-01',movements:[]};
 const state={[historyKey(doc,item)]:'2026-11-24'};
 assert.equal(historyCheckpoint(doc,item,state,'2026-11-24'),'2026-11-24');
 assert.equal(historyCheckpoint({...doc,cents:101},item,state,'2026-11-24'),'2026-10-01');
 assert.equal(historyCheckpoint(doc,item,state,'2026-11-23'),'2026-10-01');
 assert.equal(item.historyCheckedAt,'2026-10-01');
});
