import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBudgetNature,normalizeDocument} from '../src/cgu.mjs';
import {mergeMonth,emptyMonth,validateMonth} from '../src/store.mjs';
const date='26/11/2026', day='2026-11-26', month='2026-11';
const row={codigoUg:'158459',documento:'158459264222026NE000123',valor:'1,00',
 grupo:'Outras Despesas Correntes',elemento:'Material de consumo',programa:'Programa',
 acao:'20RL',funcao:'Educação',subfuncao:'Ensino profissional',planoOrcamentario:'0000',
 localizador:'0042',categoriaEconomica:'Despesas Correntes',autorEmenda:'Autor público',
 fonte:'Nao inferir',ptres:'123456',planoInterno:'Nao inferir'};
test('CGU preserva classificacao explicitamente mapeada e nao infere celula orcamentaria',()=>{
 const doc=normalizeDocument(row,date,1);
 assert.equal(doc.nature.function,'Educação');
 assert.equal(doc.nature.subfunction,'Ensino profissional');
 assert.equal(doc.nature.budgetPlan,'0000');
 assert.equal(doc.nature.locator,'0042');
 assert.equal(doc.nature.economicCategory,'Despesas Correntes');
 assert.equal(doc.nature.amendmentAuthor,'Autor público');
 assert.equal(doc.nature.ptres,undefined);assert.equal(doc.nature.fundingSource,undefined);
 assert.deepEqual(normalizeBudgetNature({planoOrcamentario:null,localizador:{code:'0042'},funcao:' '.repeat(10)}),{});
});
test('campo novo opcional compativel com schema 1 e preservado em reconsulta incompleta de atributos',()=>{
 const patch=doc=>({documents:[doc],links:[],coverage:{date:day,phase:1,complete:true,count:1,invalid:0}});
 const old=mergeMonth(emptyMonth(month),month,[patch(normalizeDocument(row,date,1))]).data;
 validateMonth(old);
 const changed=normalizeDocument({codigoUg:row.codigoUg,documento:row.documento,valor:row.valor,acao:'20RK'},date,1);
 const updated=mergeMonth(old,month,[patch(changed)]).data;
 validateMonth(updated);
 assert.equal(updated.documents[0].nature.budgetPlan,undefined);
 assert.equal(updated.documents[0].nature.action,'20RK');
});

test('PO e localizador permanecem quando a reconsulta omite campos sem alterar o contexto',()=>{
 const patch=doc=>({documents:[doc],links:[],coverage:{date:day,phase:1,complete:true,count:1,invalid:0}});
 const old=mergeMonth(emptyMonth(month),month,[patch(normalizeDocument(row,date,1))]).data;
 const same=normalizeDocument({codigoUg:row.codigoUg,documento:row.documento,valor:row.valor,acao:'20RL'},date,1);
 const updated=mergeMonth(old,month,[patch(same)]).data;
 assert.equal(updated.documents[0].nature.budgetPlan,'0000');
 assert.equal(updated.documents[0].nature.locator,'0042');
});
