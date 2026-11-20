import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessContractAttribution,assessNoticeAttribution,matchDocumentContract} from '../assets/procurement-links.js';
import {normalizePncp,normalizeCompras} from '../src/procurement.mjs';
import {normalizeContractPurchaseLink} from '../src/pncp-contract-link.mjs';

const ne='158459000012026NE000123';
const document={id:ne,phase:1,process:'23349.000001/2026-01',partyRef:'12345678000190'};
const central={source:'pncp',scope:'ifc',unitCode:'158125',process:'23349.000001/2026-01',supplierCnpj:'12345678000190'};

test('AUD-05: publicacao centralizada e processo 23349 nao comprovam despesa do campus',()=>{
 assert.equal(assessContractAttribution(central).level,'process_indication');
 assert.equal(assessContractAttribution(central,[document]).level,'context');
 assert.equal(matchDocumentContract(document,central).level,'context');
 assert.equal(assessNoticeAttribution({pncpId:'10635424000186-1-000001/2026',process:central.process}).level,'process_indication');
});

test('AUD-05: vinculo oficial de NE integral da UG confirma atribuicao, sem exigir processo',()=>{
 const contract={...central,process:'23348.000001/2026-01',commitmentRefs:[ne]};
 assert.equal(assessContractAttribution(contract).level,'confirmed');
 assert.equal(matchDocumentContract(document,contract).level,'confirmed');
 const notice={pncpId:'10635424000186-1-000001/2026'};
 assert.equal(assessNoticeAttribution(notice,[{...contract,procurementId:notice.pncpId}]).level,'confirmed');
});

test('AUD-05: numero curto de NE com UG e apenas indicio sem documento CGU',()=>{
 const contract={...central,commitmentRefs:['158459-2026NE000123']};
 assert.equal(assessContractAttribution(contract).level,'ne_indication');
 assert.equal(assessContractAttribution({...central,commitmentRefs:['2026NE000123']}).level,'process_indication');
});

test('AUD-05: edital sem ID oficial de contratacao nao herda atribuicao',()=>{
 const contract={...central,commitmentRefs:[ne],procurementId:'10635424000186-1-000002/2026'};
 assert.equal(assessNoticeAttribution({pncpId:'10635424000186-1-000001/2026'},[contract]).level,'unverified');
});

test('AUD-05: normalizacao PNCP preserva escopo do publicador, nao do beneficiario',()=>{
 const row={
  numeroControlePNCP:'10635424000186-2-000001/2026',
  orgaoEntidade:{cnpj:'10635424000186'},
  dataPublicacaoPncp:'2026-11-01',
  unidadeOrgao:{codigoUnidade:'158125'},
  tipoContrato:{nome:'Contrato'},
  processo:'23349.000001/2026-01'
 };
 const result=normalizePncp(row);
 assert.equal(result.scope,'ifc');
 assert.equal(result.unitCode,'158125');
 assert.equal(assessContractAttribution(result).level,'process_indication');
 assert.equal(normalizeCompras({codigoUnidadeGestora:'158125',numeroContrato:'1/2026',dataVigenciaInicial:'2026-01-01'}),null);
});

test('AUD-05: vinculo contrato-licitacao requer ID PNCP explicitamente informado',()=>{
 const id='10635424000186-2-000001/2026';
 assert.deepEqual(normalizeContractPurchaseLink({numeroControlePNCP:id,numeroControlePncpCompra:'10635424000186-1-000001/2026'},id),{
  status:'linked',procurementId:'10635424000186-1-000001/2026'
 });
 assert.deepEqual(normalizeContractPurchaseLink({numeroControlePNCP:id},id),{status:'not_reported'});
 assert.throws(()=>normalizeContractPurchaseLink({numeroControlePNCP:id,numeroControlePncpCompra:'invalido'},id));
});
