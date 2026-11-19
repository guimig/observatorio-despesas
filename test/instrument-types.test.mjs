import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  classifyPncpInstrument,isFormalContract,
  groupPublishedInstruments,summarizeInstrumentTypes
} from '../assets/instrument-types.js';
import {documentSpecies,financialPhaseDescription} from '../assets/document-species.js';

const formal=(id='formal')=>({id,kind:'Contrato (termo inicial)',
  procurementId:'10635424000186-1-000115/2026',number:'00090'});
const ne=(id='note')=>({id,kind:'Empenho',
  procurementId:'10635424000186-1-000115/2026',number:'2026NE000266',unitCode:'158459'});

test('registros Empenho do PNCP não são contratos formais, ainda que estejam em /contratos',()=>{
 assert.equal(classifyPncpInstrument(ne()),'commitment_substitute');
 assert.equal(isFormalContract(ne()),false);
 assert.equal(classifyPncpInstrument(formal()),'formal_contract');
 assert.equal(isFormalContract(formal()),true);
});
test('contrato formal com NE na referência do número não vira empenho automaticamente',()=>{
 assert.equal(classifyPncpInstrument({...formal(),number:'2026NE000266'}),
   'formal_contract');
});
test('sem informação de tipo o contrato fica pendente de classificação, não entra no quadro',()=>{
 for(const v of [{kind:null},{kind:''},{kind:'Termo aditivo'},{number:'2026NE000266'}]){
  assert.equal(classifyPncpInstrument(v),'unclassified');
  assert.equal(isFormalContract(v),false);
 }
});
test('instrumentos equivalentes são separados de contratos e desconhecidos',()=>{
 assert.equal(classifyPncpInstrument({kind:'Nota de Empenho'}),'commitment_substitute');
 assert.equal(classifyPncpInstrument({kind:'Autorização de compra'}),'other_substitute');
 assert.equal(classifyPncpInstrument({kind:'Ordem de execução de serviço'}),'other_substitute');
 assert.equal(classifyPncpInstrument({kind:'Carta-contrato'}),'other_substitute');
});
test('licitação pode gerar N contratos, N NEs substitutivas e nenhum instrumento',()=>{
 const rows=[formal('c1'),formal('c2'),ne('n1'),ne('n2'),
  {...formal('c3'),procurementId:'10635424000186-1-000999/2026'}];
 const match=groupPublishedInstruments(rows,'10635424000186-1-000115/2026');
 assert.deepEqual(match.formal.map(x=>x.id),['c1','c2']);
 assert.deepEqual(match.commitments.map(x=>x.id),['n1','n2']);
 const empty=groupPublishedInstruments(rows,'10635424000186-1-000001/2026');
 assert.deepEqual(empty,{formal:[],commitments:[],other:[],unclassified:[]});
 assert.deepEqual(summarizeInstrumentTypes(rows),{
  formal:3,commitments:2,other:0,unclassified:0
 });
});
test('arquivo PNCP real é categorizável sem duplicar NEs na relação de contratos formais',async()=>{
 const data=JSON.parse(await readFile(new URL('../data/procurement/contracts.json',import.meta.url),'utf8'));
 const summary=summarizeInstrumentTypes(data.contracts);
 assert.equal(summary.formal+summary.commitments+summary.other+summary.unclassified,
   data.contracts.length);
 assert.ok(summary.commitments>0);
 const all=data.contracts.filter(isFormalContract);
 assert.equal(all.some(row=>row.kind==='Empenho'),false);
 assert.equal(data.contracts.filter(row=>row.kind==='Empenho')
   .every(row=>classifyPncpInstrument(row)==='commitment_substitute'),true);
});
test('NE, NS, OB, DF são espécies diferentes, embora fase agrupada seja 1,2,3',()=>{
 const p='158459264222026';
 assert.deepEqual(documentSpecies(p+'NE000001'),
   {code:'NE',label:'Nota de Empenho'});
 assert.equal(documentSpecies(p+'NS000001').label,'Nota de Sistema');
 assert.equal(documentSpecies(p+'OB000001').label,'Ordem Bancária');
 assert.match(documentSpecies(p+'DF000001').label,/DARF/);
 assert.equal(documentSpecies(p+'ZZ000001').code,'ZZ');
 assert.match(financialPhaseDescription(2),/CGU/);
});
test('documento sem sigla SIAFI validada não recebe tipo ou situação inventados',()=>{
 assert.equal(documentSpecies('documento livre').code,null);
 assert.equal(documentSpecies('158125264222026OB000001').code,null);
 assert.match(financialPhaseDescription(8),/não reconhecida/);
});
