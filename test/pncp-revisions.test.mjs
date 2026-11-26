import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeNotice} from '../src/pncp-notices.mjs';
import {normalizePncp} from '../src/procurement.mjs';
import {blankNotices,mergeNotices,validateNotices} from '../src/pncp-notices-store.mjs';
import {blankProcurement,mergeProcurement,validateProcurement} from '../src/procurement-store.mjs';
import {mergePncpRecord} from '../src/pncp-record-revisions.mjs';
import {planPncpRevisions,applyNoticeRevision,applyContractRevision,
  recheckPncpRevisions,safePncpFailure,revisionKey} from '../src/pncp-revision-collector.mjs';
const today=new Date('2026-11-22T19:00:00Z');
const pncpId='10635424000186-1-000123/2026';
const contractId='10635424000186-2-000123/2026';
const noticeRow=(extra={})=>({
 numeroControlePNCP:pncpId,numeroCompra:'90024/2026',
 dataPublicacaoPncp:'2026-11-19T12:00:00',modalidadeId:6,
 orgaoEntidade:{cnpj:'10635424000186'},unidadeOrgao:{codigoUnidade:'158125'},
 processo:'23349.000111/2026-18',objetoCompra:'Objeto original',
 valorTotalEstimado:2000,srp:true,...extra
});
const contractRow=(extra={})=>({
 numeroControlePNCP:contractId,numeroControlePncpCompra:pncpId,
 orgaoEntidade:{cnpj:'10635424000186'},
 dataPublicacaoPncp:'2026-11-19',numeroContratoEmpenho:'22/2026',
 tipoContrato:{nome:'Contrato (termo inicial)'},processo:'23349.000111/2026-18',
 valorGlobal:1000,objetoContrato:'Objeto original',
 tipoPessoa:'PJ',niFornecedor:'12.345.678/0001-90',nomeRazaoSocialFornecedor:'Empresa Pública Ltda',
 ...extra
});
const notices=()=>mergeNotices(blankNotices(),[{month:'2026-11',modality:6,
 status:'complete',records:[normalizeNotice(noticeRow(),6)]}],today).data;
const contracts=()=>mergeProcurement(blankProcurement(),[{
 source:'pncp',month:'2026-11',status:'complete',
 records:[normalizePncp(contractRow())]}],today).data;

test('atualizacao oficial, data do PNCP e registros sem versionamento convivem',()=>{
 const row=normalizeNotice(noticeRow({dataAtualizacao:'2026-11-21T13:00:00'}),6);
 assert.equal(row.sourceUpdatedAt,'2026-11-21');
 const from=notices();
 const next=applyNoticeRevision(from,'pncp:'+pncpId,row,today);
 assert.equal(next.materialChanged,false);
 assert.equal(next.data.notices[0].sourceUpdatedAt,'2026-11-21');
 assert.equal(next.data.notices[0].recheckedAt,'2026-11-22');
 assert.equal(next.data.notices[0].revisionCount,undefined);
 assert.doesNotThrow(()=>validateNotices(next.data));
 const again=applyNoticeRevision(next.data,'pncp:'+pncpId,row,today);
 assert.equal(again.changed,false);
});

test('retificacao valor estimado e objeto nao equivale a empenho ou pagamento',()=>{
 let base=notices();
 const update=normalizeNotice(noticeRow({
  valorTotalEstimado:2700,objetoCompra:'Objeto retificado',dataAtualizacaoGlobal:'2026-11-22'
 }),6);
 const r=applyNoticeRevision(base,'pncp:'+pncpId,update,today);
 assert.equal(r.materialChanged,true);
 const doc=r.data.notices[0];
 assert.equal(doc.estimatedCents,270000);
 assert.equal(doc.object,'Objeto retificado');
 assert.equal(doc.revisionCount,1);
 assert.equal(doc.lastChangedAt,'2026-11-22');
 assert.equal(doc.srp,true);
 assert.equal(doc.homologatedCents,undefined);
 assert.equal(applyNoticeRevision(r.data,'pncp:'+pncpId,update,today).changed,false);
 const stale=normalizeNotice(noticeRow({
  valorTotalEstimado:1000,dataAtualizacao:'2026-11-20'
 }),6);
 assert.equal(applyNoticeRevision(r.data,'pncp:'+pncpId,stale,today).stale,true);
 assert.equal(applyNoticeRevision(r.data,'pncp:'+pncpId,stale,today).data.notices[0].estimatedCents,270000);
 const scan=mergeNotices(r.data,[{month:'2026-11',modality:6,
  status:'complete',records:[stale]}],today).data;
 assert.equal(scan.notices[0].estimatedCents,270000);
 assert.equal(scan.notices[0].revisionCount,1);
});

test('ausencia de campo em detalhe nao apaga objeto, valor ou vinculo existente',()=>{
 const before=contracts();
 const raw=contractRow({objetoContrato:null,valorGlobal:null,
  dataAtualizacao:'2026-11-22'});
 const outcome=applyContractRevision(before,'pncp:'+contractId,normalizePncp(raw),today);
 assert.equal(outcome.data.contracts[0].object,'Objeto original');
 assert.equal(outcome.data.contracts[0].amountCents,100000);
 assert.equal(outcome.data.contracts[0].procurementId,pncpId);
 assert.doesNotThrow(()=>validateProcurement(outcome.data));
});

test('mudanca comprovada de fornecedor ou numero invalida NE confirmada',()=>{
 const initial=contracts();
 const extended=structuredClone(initial);
 extended.contracts[0].commitmentStatus='complete';
 extended.contracts[0].commitmentAt='2026-11-20';
 extended.contracts[0].commitmentRefs=['158459264222026NE000266'];
 const changed=normalizePncp(contractRow({
  niFornecedor:'11.111.111/0001-91',nomeRazaoSocialFornecedor:'Nova Empresa Ltda',
  valorGlobal:1900
 }));
 const r=applyContractRevision(extended,'pncp:'+contractId,changed,today);
 const doc=r.data.contracts[0];
 assert.equal(doc.supplierCnpj,'11111111000191');
 assert.equal(doc.amountCents,190000);
 assert.equal(doc.commitmentStatus,undefined);
 assert.equal(doc.commitmentRefs,undefined);
 assert.equal(doc.revisionCount,1);
 assert.doesNotThrow(()=>validateProcurement(r.data));
});

test('mesmo contrato com valor novo preserva vinculo confirmado sem inferir pagamento',()=>{
 const before=contracts();
 before.contracts[0].commitmentStatus='complete';
 before.contracts[0].commitmentAt='2026-11-20';
 before.contracts[0].commitmentRefs=['158459264222026NE000266'];
 const next=applyContractRevision(before,'pncp:'+contractId,
  normalizePncp(contractRow({valorGlobal:2100})),today).data;
 assert.equal(next.contracts[0].amountCents,210000);
 assert.deepEqual(next.contracts[0].commitmentRefs,['158459264222026NE000266']);
});

test('troca de data de publicacao ou identidade PNCP e rejeitada',()=>{
 const before=notices();
 const shifted=normalizeNotice(noticeRow({dataPublicacaoPncp:'2026-10-31'}),6);
 assert.throws(()=>applyNoticeRevision(before,'pncp:'+pncpId,shifted,today),/Periodo/);
 assert.throws(()=>mergePncpRecord(before.notices[0],{...shifted,pncpId:'outro'},
  {kind:'notice'}),/Identidade/);
 const old=normalizeNotice(noticeRow({objetoCompra:'Novo objeto'}),6);
 const bad=structuredClone(before);
 bad.notices[0].revisionCount=0;
 assert.throws(()=>validateNotices(bad));
 assert.equal(applyNoticeRevision(before,'pncp:'+pncpId,old,today).materialChanged,true);
});

test('planejamento preserva cooldown e limita lote mesmo com registros antigos',()=>{
 const now=new Date('2026-11-25T12:00:00Z');
 const before=notices();
 assert.equal(planPncpRevisions(before,{kind:'notice',now,batch:4}).length,1);
 const checked=applyNoticeRevision(before,'pncp:'+pncpId,before.notices[0],now).data;
 assert.equal(planPncpRevisions(checked,{kind:'notice',now,batch:4}).length,0);
 assert.equal(planPncpRevisions(checked,{kind:'notice',
  now:new Date('2026-12-04T12:00:00Z'),batch:4}).length,1);
 assert.throws(()=>planPncpRevisions(checked,{kind:'notice',now,batch:50}));
});

test('rotina real em diretorio temporario grava so JSONs validados, sem duplicacao',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pncp-revisoes-'));
 try{
  await mkdir(join(root,'data','procurement'),{recursive:true});
  await writeFile(join(root,'data/procurement/notices.json'),JSON.stringify(notices()));
  await writeFile(join(root,'data/procurement/contracts.json'),JSON.stringify(contracts()));
  const preview=await recheckPncpRevisions({root,now:today,dryRun:true});
  assert.equal(preview.noticePlanned,1);
  assert.equal(preview.contractPlanned,1);
  const result=await recheckPncpRevisions({root,now:today,
   fetchNotice:async()=>normalizeNotice(noticeRow({valorTotalEstimado:3200}),6),
   fetchContract:async()=>contractRow({valorGlobal:4300})
  });
  assert.equal(result.failed,0);
  assert.equal(result.materialChanged,2);
  const n=JSON.parse(await readFile(join(root,'data/procurement/notices.json')));
  const c=JSON.parse(await readFile(join(root,'data/procurement/contracts.json')));
  assert.equal(n.notices.length,1);
  assert.equal(n.notices[0].estimatedCents,320000);
  assert.equal(c.contracts.length,1);
  assert.equal(c.contracts[0].amountCents,430000);
  assert.equal((await recheckPncpRevisions({root,now:today,dryRun:true})).noticePlanned,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('classificacao segura revela categoria e etapa sem vazar payload',async()=>{
 assert.equal(safePncpFailure({status:404,message:'CPF 000.123.456-78'},'fetch'),'http_404');
 assert.equal(safePncpFailure({status:429},'fetch'),'http_429');
 assert.equal(safePncpFailure(Error('detalhe incorreto'),'identity'),'identity_mismatch');
 assert.equal(safePncpFailure(Error('pessoa privada'),'normalize'),'normalization_failed');
 assert.equal(safePncpFailure(Error('processo privado'),'apply'),'schema_or_provenance');
 const root=await mkdtemp(join(tmpdir(),'pncp-falhas-'));
 try{
  await mkdir(join(root,'data','procurement'),{recursive:true});
  await writeFile(join(root,'data/procurement/notices.json'),JSON.stringify(notices()));
  await writeFile(join(root,'data/procurement/contracts.json'),JSON.stringify(contracts()));
  const result=await recheckPncpRevisions({root,now:today,
   fetchNotice:async()=>normalizeNotice(noticeRow(),6),
   fetchContract:async()=>{const e=Error('privado');e.status=429;throw e;}
  });
  assert.equal(result.noticeChecked,1);
  assert.equal(result.contractChecked,0);
  assert.equal(result.failureKinds.http_429,1);
  assert.equal(JSON.stringify(result).includes('privado'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('reconferencia PNCP identica usa checkpoint sem esconder mudanca de centavo ou revisao da fonte',()=>{
 const from=noticeCatalog();
 const record=from.notices[0],id=record.id;
 const first=applyNoticeRevision(from,id,record,new Date('2026-08-01'),{operational:true}).data;
 const old=first.notices[0],now=new Date('2026-11-26T12:00:00Z');
 assert.equal(applyNoticeRevision(first,id,old,now,{operational:true}).changed,false);
 assert.equal(planPncpRevisions(first,{kind:'notice',now,batch:4,state:{[revisionKey('notice',old)]:'2026-11-26'}}).length,0);
 const cents=(old.estimatedCents||0)+1;
 const next=applyNoticeRevision(first,id,{...old,estimatedCents:cents},now,{operational:true});
 assert.equal(next.changed,true);assert.equal(next.data.notices[0].estimatedCents,cents);
 const source=applyNoticeRevision(first,id,{...old,sourceUpdatedAt:'2026-11-26'},now,{operational:true});
 assert.equal(source.changed,true);
});
