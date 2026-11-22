import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicNarrativeText,MAX_PUBLIC_NARRATIVE} from '../src/public-narrative.mjs';
import {normalizeDocument} from '../src/cgu.mjs';
import {normalizeNotice} from '../src/pncp-notices.mjs';
import {normalizePncp,normalizeCompras} from '../src/procurement.mjs';
import {validateMonth,emptyMonth,mergeMonth} from '../src/store.mjs';
import {validateNotices,blankNotices,mergeNotices} from '../src/pncp-notices-store.mjs';
import {validateProcurement,blankProcurement,mergeProcurement} from '../src/procurement-store.mjs';
import {showDialogFromTop} from '../assets/dialog-scroll.js';

const longText='Fornecimento de materiais e serviços para laboratórios.\n\n'+
  'Justificativa técnica: '+('descrição da solução em parágrafo. '.repeat(18));
const ne='158459000012026NE000015';
const pncpId='10635424000186-1-000123/2026';
const procurementId='10635424000186-2-000123/2026';

test('mantém narrativa acima de 260 caracteres com quebras de parágrafo',()=>{
 const text=publicNarrativeText(longText);
 assert.equal(text,longText);
 assert.ok(text.length>260);
 assert.equal(publicNarrativeText('a'.repeat(MAX_PUBLIC_NARRATIVE+1)),null);
 assert.equal(publicNarrativeText('texto normal\r\n\r\nsegundo parágrafo'),'texto normal\n\nsegundo parágrafo');
});

test('descarta textos sensíveis sem gravar partes de contatos ou dados pessoais',()=>{
 assert.equal(publicNarrativeText('Falar com autor@example.com para autorizar.'),null);
 assert.equal(publicNarrativeText('CPF 000.123.456-78 identificado'),null);
 assert.equal(publicNarrativeText('Contato https://example.com/portal'),null);
 assert.equal(publicNarrativeText('Telefone: (47) 99999-1234'),null);
});

test('descrição de NE passa por normalização armazenamento e consulta detalhada',()=>{
 const doc=normalizeDocument({codigoUg:'158459',documento:ne,
  valor:'150,25',observacao:longText},'18/11/2026',1);
 assert.equal(doc.description,longText);
 const patch={documents:[doc],links:[],coverage:{
  date:'2026-11-18',phase:1,complete:true,count:1,invalid:0
 }};
 const month=mergeMonth(emptyMonth('2026-11'),'2026-11',[patch]).data;
 assert.equal(month.documents[0].description,longText);
 assert.doesNotThrow(()=>validateMonth(month));
 const replay=mergeMonth(month,'2026-11',[patch]);
 assert.equal(replay.changed,false);
 const unsafe=structuredClone(month);
 unsafe.documents[0].description='foo@example.com';
 assert.throws(()=>validateMonth(unsafe));
});

test('campo livre de NE contendo CPF ou e-mail não é publicado',()=>{
 const doc=normalizeDocument({codigoUg:'158459',documento:ne,
  valor:'50,00',observacao:longText+' user@example.com'},'18/11/2026',1);
 assert.equal(doc.description,undefined);
});

test('PNCP preserva objeto extenso no catálogo de publicações',()=>{
 const raw={numeroControlePNCP:pncpId,numeroCompra:'90024/2026',
  dataPublicacaoPncp:'2026-11-19T12:00:00',modalidadeId:6,
  orgaoEntidade:{cnpj:'10635424000186'},unidadeOrgao:{codigoUnidade:'158125'},
  processo:'23349.000111/2026-18',objetoCompra:longText};
 const normalized=normalizeNotice(raw,6);
 assert.equal(normalized.object,longText);
 const outcome=mergeNotices(blankNotices(),[{month:'2026-11',modality:6,
  status:'complete',records:[normalized]}]);
 assert.equal(outcome.data.notices[0].object,longText);
 assert.doesNotThrow(()=>validateNotices(outcome.data));
});

test('PNCP e Compras preservam objeto contratual extenso',()=>{
 const row={numeroControlePNCP:procurementId,
  orgaoEntidade:{cnpj:'10635424000186'},
  dataPublicacaoPncp:'2026-11-04',numeroContratoEmpenho:'22/2026',
  tipoContrato:{nome:'Contrato (termo inicial)'},objetoContrato:longText};
 const pncp=normalizePncp(row);
 assert.equal(pncp.object,longText);
 const updated=mergeProcurement(blankProcurement(),[{source:'pncp',month:'2026-11',
  status:'complete',records:[pncp]}]);
 assert.equal(updated.data.contracts[0].object,longText);
 assert.doesNotThrow(()=>validateProcurement(updated.data));
 const compras=normalizeCompras({codigoUnidadeGestora:'158459',
  numeroContrato:'22/2026',dataVigenciaInicial:'2026-11-02',objeto:longText});
 assert.equal(compras.object,longText);
});

test('abertura de pop-up novo ou reutilizado reinicia a rolagem do container',()=>{
 let frames=[],focusOptions=[];
 const content={scrollTop:160};
 const button={focus:options=>focusOptions.push(options)};
 const dialog={open:false,scrollTop:230,
  showModal(){this.open=true;},
  querySelector(selector){
   return selector==='.dialog-content'?content:selector==='.dialog-heading button'?button:null;
  }};
 showDialogFromTop(dialog,callback=>frames.push(callback));
 assert.equal(dialog.scrollTop,0);
 assert.equal(content.scrollTop,0);
 assert.deepEqual(focusOptions,[{preventScroll:true}]);
 content.scrollTop=700;dialog.scrollTop=800;
 frames.pop()();
 assert.equal(dialog.scrollTop,0);
 assert.equal(content.scrollTop,0);
 dialog.scrollTop=470;content.scrollTop=390;
 showDialogFromTop(dialog,callback=>frames.push(callback));
 assert.equal(dialog.scrollTop,0);
 assert.equal(content.scrollTop,0);
});

test('tabelas não imprimem objeto integral e modais oferecem ficha com descrição',async()=>{
 const html=await readFile('index.html','utf8');
 const app=await readFile('assets/app.js','utf8');
 assert.match(html,/id="record-dialog"/);
 assert.match(html,/id="record-fields"/);
 assert.match(html,/id="close-record-dialog"/);
 assert.match(app,/showCatalogDetail\(notice,'notice'\)/);
 assert.match(app,/showCatalogDetail\(contract,'contract'\)/);
 assert.match(app,/showDialogFromTop\(\$\('document-dialog'\)\)/);
 assert.match(app,/Descrição \/ observação da nota de empenho/);
 assert.doesNotMatch(app,/element\('td','beneficiary-cell',notice\.object/);
 assert.doesNotMatch(app,/element\('td','beneficiary-cell',contract\.object/);
});
