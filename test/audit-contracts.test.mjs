import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyPncpInstrument,groupPublishedInstruments,summarizeInstrumentTypes} from '../assets/instrument-types.js';

test('AUD-02: empenho publicado na coleção contratos não vira contrato formal',()=>{
 const rows=[
  {kind:'Contrato (termo inicial)',procurementId:'p1'},
  {kind:'Nota de Empenho',procurementId:'p1'},
  {kind:'Autorização de Compra',procurementId:'p1'},
  {kind:'Tipo desconhecido',procurementId:'p1'},
  {kind:'Contrato',procurementId:'p2'}
 ];
 const groups=groupPublishedInstruments(rows,'p1');
 assert.deepEqual([groups.formal.length,groups.commitments.length,groups.other.length,groups.unclassified.length],[1,1,1,1]);
 assert.deepEqual(summarizeInstrumentTypes(rows),{formal:2,commitments:1,other:1,unclassified:1});
 assert.equal(classifyPncpInstrument({kind:'Nota de Empenho'}),'commitment_substitute');
 assert.equal(classifyPncpInstrument({kind:'Tipo desconhecido'}),'unclassified');
});

test('AUD-02: classificação não é inferida por número, processo ou identificador',()=>{
 assert.equal(classifyPncpInstrument({number:'123/2026',pncpId:'123',process:'123'}),'unclassified');
 assert.equal(classifyPncpInstrument({kind:'Termo de Contrato'}),'formal_contract');
});
