import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialAtaId,comprasAtaUrls,scanComprasArp,scanAtaInstruments,inspectArpBalances,applyArpDetail,validateArpDetails,planArpDetails,arpKey,allPages} from '../src/arp-details.mjs';
import {validateParticipantReferences} from '../src/collect-pncp-ata-participants.mjs';
const purchase='10635424000186-1-000054/2026';
const ata={id:purchase+':ata:1',procurementId:purchase,sequence:1,starts:'2026-05-21'};
const notice={pncpId:purchase,unitCode:'158125',number:'90114'};
const header={numeroControlePncpAta:purchase+'-000001',numeroControlePncpCompra:purchase,codigoUnidadeGerenciadora:158125,dataVigenciaInicial:ata.starts,numeroAtaRegistroPreco:'00078/2026',quantidadeItens:1};
const row={...header,numeroItem:'1',niFornecedor:'00012345678',quantidadeHomologadaVencedor:2.5,valorUnitario:1.234,quantidadeEmpenhada:0,itemExcluido:false,nomeRazaoSocialFornecedor:'PESSOA PRIVADA'};
const envelope=rows=>({resultado:rows,totalRegistros:rows.length,totalPaginas:rows.length?1:0,paginasRestantes:0});
test('chave oficial, recorte e filtros documentados',()=>{
 assert.equal(officialAtaId(ata),header.numeroControlePncpAta);
 const u=new URL(comprasAtaUrls(ata,notice).items(1));
 assert.equal(u.searchParams.get('dataVigenciaInicialMin'),ata.starts);
 assert.equal(u.searchParams.get('numeroCompra'),'90114');
 assert.throws(()=>officialAtaId({...ata,id:ata.id.replace('2026','2023'),procurementId:purchase.replace('2026','2023')}));
 assert.throws(()=>comprasAtaUrls(ata,{...notice,unitCode:'999999'}));
});
test('correspondencia completa; nenhum CPF integral, nenhum saldo presumido',async()=>{
 const fetcher=async u=>u.includes('1_consultarARP?')?envelope([header]):envelope([row,{...row,numeroControlePncpAta:purchase+'-000002'}]);
 const r=await scanComprasArp(ata,notice,{fetcher});
 assert.equal(r.ok,true);assert.equal(r.data.items.length,1);
 assert.equal(r.data.items[0].supplierCpfMasked,'***.123.456-**');
 assert.equal(r.data.items[0].committedQuantity,'0');assert.equal(r.data.items[0].unitPrice,'1.234');
 assert.equal(r.data.items[0].saldo,undefined);assert.ok(!JSON.stringify(r).includes('00012345678'));assert.ok(!JSON.stringify(r).includes('PESSOA PRIVADA'));
 const next=applyArpDetail(null,ata,'compras',r.data);
 assert.equal(applyArpDetail(next,ata,'compras',r.data),next);
 assert.doesNotThrow(()=>validateParticipantReferences({schema_version:1,checks:[],details:[next]},[ata]));
 assert.throws(()=>validateArpDetails([next],[]));
});
test('numero de ata coincidente nao basta; contagem e paginacao divergentes impedem publicacao',async()=>{
 const wrong={...header,numeroControlePncpAta:purchase+'-000002'};
 assert.equal((await scanComprasArp(ata,notice,{fetcher:async()=>envelope([wrong])})).reason,'unmatched_header');
 const r=await scanComprasArp(ata,notice,{fetcher:async u=>u.includes('1_consultarARP?')?envelope([{...header,quantidadeItens:2}]):envelope([row])});
 assert.equal(r.reason,'item_count_conflict');
 await assert.rejects(allPages(()=>'',{fetcher:async()=>({resultado:[row],totalPaginas:1,totalRegistros:2})}));
});
test('vinculo direto PNCP, corte e protecao de dados anteriores',async()=>{
 const pncpId='10635424000186-2-000123/2026';
 const link={numeroControle:pncpId,sequencialContrato:123,orgaoEntidade:{cnpj:'10635424000186'},unidadeExecutora:{codigo:'158125'},frutoAdesao:false};
 const result=await scanAtaInstruments(ata,{fetcher:async()=>envelope([link,{...link,numeroControle:pncpId.replace('2026','2023')}])});
 assert.deepEqual(result,[{pncpId,unitCode:'158125',adhesion:false}]);
 const d=applyArpDetail(null,ata,'instruments',result);
 assert.throws(()=>applyArpDetail(d,ata,'instruments',[]));
 assert.equal(applyArpDetail(d,ata,'instruments',result),d);
});
test('saldo sem exercicio explicito nao e consultado; sondagem so retorna contagens',async()=>{
 let calls=0;const base={control:officialAtaId(ata),manager:'158125',number:'00078',items:[{number:1}]};
 assert.equal((await inspectArpBalances(ata,base,{fetcher:async()=>{calls++}})).eligible,false);
 assert.equal(calls,0);
 const r=await inspectArpBalances(ata,{...base,number:'00078/2026'},{fetcher:async()=>{calls++;return envelope([{unidade:'158459',saldoEmpenho:99,nome:'DADO'}])}});
 assert.equal(calls,2);assert.equal(r.balances.exactCampus,0);assert.ok(!JSON.stringify(r).includes('DADO'));assert.ok(!JSON.stringify(r).includes('99'));
});
test('cache evita consultas repetidas e perda nao apaga dados',()=>{
 const now=new Date('2026-11-24'),state={[arpKey(ata,'compras')]:'2026-11-24'};
 assert.equal(planArpDetails([ata],[],{kind:'compras',now,state}).length,0);
 assert.equal(planArpDetails([ata],[],{kind:'compras',now}).length,1);
});
