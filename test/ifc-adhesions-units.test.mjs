import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePncp,REITORIA_CNPJ} from '../src/procurement.mjs';
import {blankProcurement,mergeProcurement,validateProcurement} from '../src/procurement-store.mjs';
import {mergePncpRecord} from '../src/pncp-record-revisions.mjs';
import {isIfcAdhesion} from '../assets/procurement-structured-filters.js';
import {officialAtaId,scanArpUnit,applyArpUnit,planArpUnitProbes,unitProbeKey} from '../src/arp-details.mjs';
const now=new Date('2026-11-25T12:00:00Z'),id=REITORIA_CNPJ+'-2-000001/2026',purchase='01612452000197-1-000005/2025';
const raw={numeroControlePNCP:id,orgaoEntidade:{cnpj:REITORIA_CNPJ},numeroControlePncpCompra:purchase,numeroControlePncpAta:purchase+'-000001',dataPublicacaoPncp:'2026-11-01',frutoAdesao:true,temRemanejamento:false};
const base=()=>normalizePncp(raw);
test('IFC aderente a ata externa, nao autorizacao de terceiros nem desconhecido',()=>{
 const c=base();assert.equal(c.adhesion,true);assert.equal(c.ataControl,purchase+'-000001');assert.equal(c.remanejamento,false);assert.ok(isIfcAdhesion(c));
 assert.equal(isIfcAdhesion({...c,orgCnpj:'01612452000197'}),false);
 assert.equal(isIfcAdhesion(normalizePncp({...raw,frutoAdesao:false})),false);
 assert.equal(isIfcAdhesion(normalizePncp({...raw,frutoAdesao:undefined,possibilidadeAdesao:true})),false);
 assert.equal(normalizePncp({...raw,numeroControlePncpAta:'01612452000197-1-000006/2025-000001'}).ataControl,undefined);
});
test('coleta e reconsulta preservam evidencia omitida, falso explicito muda registro',()=>{
 const c=base(),scan=record=>({source:'pncp',month:'2026-11',records:[record],status:'complete',skipped:0});
 const initial=mergeProcurement(blankProcurement(),[scan(c)],now).data;
 const incoming=normalizePncp({...raw,frutoAdesao:undefined,numeroControlePncpAta:undefined});
 assert.equal(mergeProcurement(initial,[scan(incoming)],now).changed,false);
 const result=mergePncpRecord(c,incoming,{kind:'contract',now});assert.equal(result.record.adhesion,true);
 assert.equal(mergePncpRecord(c,{...c,adhesion:false},{kind:'contract',now}).record.adhesion,false);
 assert.throws(()=>validateProcurement({...initial,contracts:[{...c,adhesion:'true'}]}));
});
const local=REITORIA_CNPJ+'-1-000229/2025',ata={id:local+':ata:1',procurementId:local,sequence:1};
const compras={control:officialAtaId(ata),number:'00471/2025',manager:'158125',items:[{number:3,supplierCnpj:'12345678000190',unitPrice:'10'}]};
const row={numeroAta:compras.number,unidadeGerenciadora:'158125',numeroItem:3,codigoUnidade:'158459',quantidadeRegistrada:20,dataHoraAtualizacao:'2026-11-23T12:00:00',saldoAdesoes:999,fornecedor:'PESSOA'};
const envelope=rows=>({resultado:rows,totalRegistros:rows.length,totalPaginas:rows.length?1:0,paginasRestantes:0});
test('somente codigoUnidade explicito, chave completa e nenhuma agregacao ou saldo presumido',async()=>{
 const r=await scanArpUnit(ata,compras,3,{fetcher:async()=>envelope([row,{...row,codigoUnidade:'158125',quantidadeRegistrada:40},{...row,codigoUnidade:'999999'}])});
 assert.equal(r.ok,true);assert.deepEqual(r.data.units,[{unitCode:'158125',registered:'40',sourceUpdatedAt:'2026-11-23'},{unitCode:'158459',registered:'20',sourceUpdatedAt:'2026-11-23'}]);
 assert.ok(!JSON.stringify(r).includes('999'));assert.ok(!JSON.stringify(r).includes('PESSOA'));
 const d={ataId:ata.id,compras},next=applyArpUnit(d,ata,r.data);assert.equal(applyArpUnit(next,ata,r.data),next);
 assert.throws(()=>applyArpUnit(next,ata,{number:3,units:[r.data.units[0]]}));
});
test('vazio, identidade divergente, duplicidade e unidade de medida nao viram quantitativo',async()=>{
 assert.equal((await scanArpUnit(ata,compras,3,{fetcher:async()=>envelope([])})).reason,'empty');
 assert.equal((await scanArpUnit(ata,compras,3,{fetcher:async()=>envelope([{...row,numeroAta:'00471/2024'}])})).reason,'identity_mismatch');
 assert.equal((await scanArpUnit(ata,compras,3,{fetcher:async()=>envelope([row,row])})).reason,'ambiguous_quantity');
 assert.equal((await scanArpUnit(ata,compras,3,{fetcher:async()=>envelope([{...row,codigoUnidade:undefined,unidade:'158459'}])})).reason,'no_verified_ifc_unit');
});
test('sondagem independente usa atas ja catalogadas e respeita cache',()=>{
 const d={ataId:ata.id,compras},key=unitProbeKey(ata,compras,3);
 assert.equal(planArpUnitProbes([ata],[d],{now}).length,1);
 assert.equal(planArpUnitProbes([ata],[d],{now,state:{[key]:'2026-11-24'}}).length,0);
});
