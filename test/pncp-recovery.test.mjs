import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CAMPUS_CNPJ,REITORIA_CNPJ,normalizePncp}
 from '../src/procurement.mjs';
import {blankProcurement,mergeProcurement,validateProcurement}
 from '../src/procurement-store.mjs';
import {planPncpDelta,applyPncpDelta} from '../src/pncp-delta.mjs';
import {planPncpRecovery,recoverPncpPending}
 from '../src/recover-pncp-publications.mjs';

const NOW=new Date('2026-11-23T16:00:00Z');
const OLD_ID=REITORIA_CNPJ+'-2-000123/2026';
const UNKNOWN_ID=REITORIA_CNPJ+'-2-000999/2026';
function raw(id,{published='2026-11-10',updated='2026-11-22'}={}){
 return {
   numeroControlePNCP:id,
   orgaoEntidade:{cnpj:id.slice(0,14)},
   dataPublicacaoPncp:published,
   dataAtualizacaoGlobal:updated,
   numeroContratoEmpenho:'123/2026',
   unidadeOrgao:{codigoUnidade:'158125'},
   processo:'23349.000123/2026-18',
   valorGlobal:1000,
   tipoContrato:{nome:'Contrato (termo inicial)'},
   tipoPessoa:'PJ',niFornecedor:'12.345.678/0001-90',
   nomeRazaoSocialFornecedor:'Fornecedor Teste'
 };
}
function original(){
 return mergeProcurement(blankProcurement(),[{
   source:'pncp',month:'2026-11',status:'complete',skipped:0,
   records:[normalizePncp(raw(OLD_ID))]
 }],NOW).data;
}
function queued(){
 const old=original(),p=planPncpDelta(old,{now:NOW});
 const scans=[
   {org:REITORIA_CNPJ,from:p.from,to:p.to,complete:true,pages:1,
     records:[normalizePncp(raw(UNKNOWN_ID,{published:'2026-09-08'}))]},
   {org:CAMPUS_CNPJ,from:p.from,to:p.to,complete:true,pages:1,records:[]}
 ];
 return applyPncpDelta(old,p,scans,{now:NOW});
}
async function withCatalog(catalog,fn){
 const root=await mkdtemp(join(tmpdir(),'pncp-pending-'));
 try{
   await mkdir(join(root,'data','procurement'),{recursive:true});
   const file=join(root,'data','procurement','contracts.json');
   await writeFile(file,JSON.stringify(catalog)+'\n','utf8');
   await fn(root,file);
 }finally{await rm(root,{recursive:true,force:true});}
}
const scanned=()=>({records:[normalizePncp(raw(UNKNOWN_ID,{
 published:'2026-09-08'}))],skipped:0});

test('ID desconhecido gera pendencia por mes sem criar instrumento/NE no catalogo',()=>{
 const x=queued();
 assert.equal(x.changed,true);
 assert.equal(x.summary.unmatched,1);
 assert.equal(x.summary.newlyQueued,1);
 assert.equal(x.summary.pendingPublications,1);
 assert.equal(x.data.contracts.length,1);
 assert.deepEqual(x.data.pncpDelta.pendingPublications,[{
   id:'pncp:'+UNKNOWN_ID,publishedMonth:'2026-09'
 }]);
 assert.deepEqual(planPncpRecovery(x.data,{now:NOW}),{
   status:'ready',month:'2026-09',pendingInMonth:1
 });
 assert.equal(JSON.stringify(x.summary).includes(UNKNOWN_ID),false);
 assert.doesNotThrow(()=>validateProcurement(x.data));
});
test('a mesma pendencia na janela seguinte nao duplica fila de publicacoes',()=>{
 const first=queued().data;
 const following=new Date('2026-11-24T16:00:00Z');
 const p=planPncpDelta(first,{now:following});
 const next=applyPncpDelta(first,p,[
   {org:REITORIA_CNPJ,from:p.from,to:p.to,complete:true,pages:1,
     records:[normalizePncp(raw(UNKNOWN_ID,{published:'2026-09-08',updated:'2026-11-23'}))]},
   {org:CAMPUS_CNPJ,from:p.from,to:p.to,complete:true,pages:1,records:[]}
 ],{now:following});
 assert.equal(next.summary.alreadyPending,1);
 assert.equal(next.summary.newlyQueued,0);
 assert.equal(next.data.pncpDelta.pendingPublications.length,1);
});
test('recuperacao completa confirma o mesmo ID oficial e preserva acervo e cobertura',async()=>{
 await withCatalog(queued().data,async(root,file)=>{
   let scans=0;
   const scanFn=async(month,{maxPages})=>{
     assert.equal(month,'2026-09');
     assert.equal(maxPages,25);
     scans++;
     return scanned();
   };
   const dry=await recoverPncpPending({root,now:NOW,scanFn,dryRun:true});
   assert.equal(dry.status,'dry_run');
   assert.equal(scans,0);
   const result=await recoverPncpPending({root,now:NOW,scanFn});
   assert.equal(result.status,'recovered');
   assert.equal(result.recoveredIds,1);
   assert.equal(result.remainingPending,0);
   const data=validateProcurement(JSON.parse(await readFile(file,'utf8')));
   assert.equal(data.contracts.length,2);
   assert.deepEqual(data.contracts.map(x=>x.pncpId).sort(),[OLD_ID,UNKNOWN_ID].sort());
   assert.equal(data.pncpDelta.through,'2026-11-22');
   assert.equal(data.pncpDelta.pendingPublications,undefined);
   assert.equal(data.coverage.find(x=>x.source==='pncp'&&x.month==='2026-09').status,'complete');
   assert.equal(data.coverage.find(x=>x.source==='pncp'&&x.month==='2026-11').count,1);
   const again=await recoverPncpPending({root,now:NOW,scanFn});
   assert.equal(again.status,'no_pending');
   assert.equal(scans,1);
 });
});
test('404, falha de rede e IDs ausentes nao removem pendencia nem mudam arquivo',async()=>{
 await withCatalog(queued().data,async(root,file)=>{
   const before=await readFile(file,'utf8');
   const network=await recoverPncpPending({root,now:NOW,
     scanFn:async()=>{throw Error('CPF 123.456.789-00 Token privado');}});
   assert.equal(network.status,'unavailable');
   assert.equal(JSON.stringify(network).includes('123.456.789-00'),false);
   const missing=await recoverPncpPending({root,now:NOW,
     scanFn:async()=>({records:[],skipped:0})});
   assert.equal(missing.status,'unresolved_publications');
   assert.equal(missing.missingCount,1);
   const partial=await recoverPncpPending({root,now:NOW,
     scanFn:async()=>({...scanned(),skipped:1})});
   assert.equal(partial.status,'invalid_month_scan');
   assert.equal(await readFile(file,'utf8'),before);
 });
});
test('fila tem identificador completo validado, ordem definida e limite de tamanho',()=>{
 const x=queued().data;
 x.pncpDelta.pendingPublications.push({
   id:'pncp:'+OLD_ID,publishedMonth:'2026-01'
 });
 assert.throws(()=>validateProcurement(x),/Fila PNCP/);
 x.pncpDelta.pendingPublications=[{id:'pncp:2026NE000123',
   publishedMonth:'2026-09'}];
 assert.throws(()=>validateProcurement(x),/Fila PNCP/);
 x.pncpDelta.pendingPublications=[];
 assert.doesNotThrow(()=>validateProcurement(x));
});
test('limite de pendencias impede perda silenciosa de novos IDs',()=>{
 const x=original();
 const p=planPncpDelta(x,{now:NOW});
 x.pncpDelta={since:p.from,through:p.from,
   pendingPublications:Array.from({length:500},(_,i)=>({
     id:'pncp:'+REITORIA_CNPJ+'-2-'+String(i+1).padStart(6,'0')+'/2026',
     publishedMonth:'2026-09'
   }))};
 const next={from:'2026-11-20',to:'2026-11-22',initial:false};
 assert.doesNotThrow(()=>validateProcurement(x));
 assert.throws(()=>applyPncpDelta(x,next,[
   {org:REITORIA_CNPJ,from:next.from,to:next.to,complete:true,pages:1,
     records:[normalizePncp(raw(UNKNOWN_ID,{published:'2026-09-08'}))]},
   {org:CAMPUS_CNPJ,from:next.from,to:next.to,complete:true,pages:1,records:[]}
 ],{now:NOW}),e=>e.code==='pending_limit');
});

test('mudanca do mes de publicacao de ID ainda pendente exige revisao',()=>{
 const first=queued().data,now=new Date('2026-11-24T16:00:00Z');
 const p=planPncpDelta(first,{now});
 assert.throws(()=>applyPncpDelta(first,p,[
   {org:REITORIA_CNPJ,from:p.from,to:p.to,complete:true,pages:1,
     records:[normalizePncp(raw(UNKNOWN_ID,{published:'2026-10-08',
       updated:'2026-11-23'}))]},
   {org:CAMPUS_CNPJ,from:p.from,to:p.to,complete:true,pages:1,records:[]}
 ],{now}),e=>e.code==='pending_month_changed');
 assert.equal(first.pncpDelta.pendingPublications[0].publishedMonth,'2026-09');
});
