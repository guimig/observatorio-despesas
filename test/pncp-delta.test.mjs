import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {REITORIA_CNPJ,CAMPUS_CNPJ,normalizePncp} from '../src/procurement.mjs';
import {blankProcurement,mergeProcurement,validateProcurement}
 from '../src/procurement-store.mjs';
import {planPncpDelta,pncpDeltaUrl,scanPncpDelta,applyPncpDelta}
 from '../src/pncp-delta.mjs';
import {updatePncpDelta} from '../src/collect-pncp-delta.mjs';

const now=new Date('2026-11-23T16:00:00Z');
const ifcId=REITORIA_CNPJ+'-2-000123/2026';
const campusId=CAMPUS_CNPJ+'-2-000124/2026';
const otherId=REITORIA_CNPJ+'-2-000999/2026';
const ne='158459264222026NE000123';
function row(id,org,overrides={}){
 return {
   numeroControlePNCP:id,orgaoEntidade:{cnpj:org},
   dataPublicacaoPncp:'2026-11-10T12:00:00',
   dataAtualizacaoGlobal:'2026-11-20T10:00:00',
   numeroContratoEmpenho:'123/2026',
   numeroControlePncpCompra:org+'-1-000101/2026',
   processo:'23349.000123/2026-18',
   unidadeOrgao:{codigoUnidade:'158125'},
   valorGlobal:1000,
   objetoContrato:'Objeto de teste',
   tipoContrato:{nome:'Contrato (termo inicial)'},
   tipoPessoa:'PJ',niFornecedor:'12.345.678/0001-90',
   nomeRazaoSocialFornecedor:'Fornecedor Teste LTDA',
   ...overrides
 };
}
const before=()=>{
 const records=[normalizePncp(row(ifcId,REITORIA_CNPJ)),
   normalizePncp(row(campusId,CAMPUS_CNPJ))];
 const data=mergeProcurement(blankProcurement(),[{
   source:'pncp',month:'2026-11',records,status:'complete'
 }],now).data;
 const record=data.contracts.find(c=>c.pncpId===ifcId);
 record.commitmentStatus='complete';
 record.commitmentAt='2026-11-20';
 record.commitmentRefs=[ne];
 validateProcurement(data);
 return data;
};
const scan=(org,from,to,records)=>({org,from,to,records,
 complete:true,pages:1});
const plan=(catalog=before())=>planPncpDelta(catalog,{now});
function pages(rows,total=1,totalRecords=rows.length){
 return {data:rows,totalPaginas:total,totalRegistros:totalRecords};
}

test('plano consulta dias completos de Sao Paulo e avanca com sobreposicao controlada',()=>{
 const catalog=before();
 assert.deepEqual(plan(catalog),{from:'2026-11-20',to:'2026-11-22',initial:true});
 assert.equal(new URL(pncpDeltaUrl('2026-11-20','2026-11-22',REITORIA_CNPJ)).searchParams.get('tamanhoPagina'),'100');
 assert.throws(()=>pncpDeltaUrl('2026-11-20','2026-11-22','00000000000000'));
 catalog.pncpDelta={since:'2026-11-20',through:'2026-11-22'};
 assert.equal(plan(catalog),null);
 const tomorrow=new Date('2026-11-24T16:00:00Z');
 assert.deepEqual(planPncpDelta(catalog,{now:tomorrow}),{
   from:'2026-11-22',to:'2026-11-23',initial:false});
 assert.deepEqual(planPncpDelta(catalog,{now:tomorrow,days:1}),{
   from:'2026-11-23',to:'2026-11-23',initial:false});
 assert.throws(()=>planPncpDelta(catalog,{days:50}));
});
test('scan integral valida duas paginas, conteudo e somente CNPJ permitido',async()=>{
 const f=async(url)=>{
   const p=new URL(url).searchParams;
   assert.equal(p.get('cnpjOrgao'),REITORIA_CNPJ);
   return p.get('pagina')==='1'?
     pages([row(ifcId,REITORIA_CNPJ)],2,2):
     pages([row(otherId,REITORIA_CNPJ)],2,2);
 };
 const result=await scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:f,maxPages:2
 });
 assert.equal(result.complete,true);
 assert.equal(result.pages,2);
 assert.deepEqual(result.records.map(r=>r.pncpId),[ifcId,otherId]);
 assert.equal(result.records[0].sourceUpdatedAt,'2026-11-20');
});
test('lista vazia com pagina terminal completa nao equivale a API indisponivel',async()=>{
 const result=await scanPncpDelta('2026-11-20','2026-11-22',CAMPUS_CNPJ,{
   fetcher:async()=>pages([],0,0)
 });
 assert.equal(result.complete,true);
 assert.deepEqual(result.records,[]);
 assert.equal(result.pages,1);
});
test('consulta com limite de paginas, duplicata, paginacao alterada e CNPJ indevido falha',async()=>{
 const f=async()=>pages([row(ifcId,REITORIA_CNPJ)],5,5);
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:f,maxPages:2
 }),e=>e.code==='pagination_limit');
 let requests=0;
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:async()=>{requests++;return pages([row(ifcId,REITORIA_CNPJ)],2,2);}
 }),e=>e.code==='duplicated_pncp_id');
 assert.equal(requests,2);
 requests=0;
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:async()=>pages([row(requests++?otherId:ifcId,REITORIA_CNPJ)],requests===1?2:3,2)
 }),e=>e.code==='pagination_changed');
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:async()=>pages([row(campusId,CAMPUS_CNPJ)])
 }),e=>e.code==='invalid_contract');
});
test('contagem declarada divergente e esquema parcial nao passam silenciosamente',async()=>{
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:async()=>pages([row(ifcId,REITORIA_CNPJ)],1,5)
 }),e=>e.code==='count_mismatch');
 await assert.rejects(scanPncpDelta('2026-11-20','2026-11-22',REITORIA_CNPJ,{
   fetcher:async()=>({data:{},totalPaginas:1})
 }),e=>e.code==='invalid_envelope');
});
test('merge atualiza revisao por ID, preserva NE e jamais soma contratos a despesas',()=>{
 const orig=before();const p=plan(orig);
 const newRow=normalizePncp(row(ifcId,REITORIA_CNPJ,{
   valorGlobal:1400,dataAtualizacaoGlobal:'2026-11-22'
 }));
 const missing=normalizePncp(row(otherId,REITORIA_CNPJ,{
   dataPublicacaoPncp:'2026-09-01',
   dataAtualizacaoGlobal:'2026-11-22'
 }));
 const scans=[scan(REITORIA_CNPJ,p.from,p.to,[newRow,missing]),
   scan(CAMPUS_CNPJ,p.from,p.to,[])];
 const result=applyPncpDelta(orig,p,scans,{now});
 assert.equal(result.changed,true);
 assert.equal(result.summary.matched,1);
 assert.equal(result.summary.unmatched,1);
 assert.equal(result.summary.materialChanges,1);
 assert.equal(result.data.contracts.length,orig.contracts.length);
 assert.equal(result.data.contracts.find(c=>c.pncpId===ifcId).amountCents,140000);
 assert.deepEqual(result.data.contracts.find(c=>c.pncpId===ifcId).commitmentRefs,[ne]);
 assert.deepEqual(result.data.pncpDelta,{
   since:'2026-11-20',through:'2026-11-22',
   pendingPublications:[{id:'pncp:'+otherId,publishedMonth:'2026-09'}]
 });
 assert.deepEqual(result.data.coverage,orig.coverage);
 assert.equal(JSON.stringify(result.summary).includes(ne),false);
 assert.equal(JSON.stringify(result.summary).includes(ifcId),false);
 assert.doesNotThrow(()=>validateProcurement(result.data));
});
test('retorno antigo nao substitui alteracao posterior e lote incompleto nao avanca',()=>{
 const orig=before(),p=plan(orig);
 orig.contracts.find(c=>c.pncpId===ifcId).sourceUpdatedAt='2026-11-22';
 const old=normalizePncp(row(ifcId,REITORIA_CNPJ,{
   valorGlobal:900,dataAtualizacaoGlobal:'2026-11-20'
 }));
 const complete=[scan(REITORIA_CNPJ,p.from,p.to,[old]),
   scan(CAMPUS_CNPJ,p.from,p.to,[])];
 const r=applyPncpDelta(orig,p,complete,{now});
 assert.equal(r.summary.stale,1);
 assert.equal(r.data.contracts.find(c=>c.pncpId===ifcId).amountCents,100000);
 assert.equal(r.changed,true); // checkpoint confirma janela completa
 assert.throws(()=>applyPncpDelta(orig,p,[complete[0]],{now}),/Consulta PNCP incompleta/);
 const missingDate=normalizePncp(row(ifcId,REITORIA_CNPJ,{
   dataAtualizacaoGlobal:null,dataAtualizacao:null
 }));
 assert.throws(()=>applyPncpDelta(orig,p,[
   scan(REITORIA_CNPJ,p.from,p.to,[missingDate]),complete[1]
 ],{now}),e=>e.code==='missing_update_date');
});
test('metadados de checkpoint impedem duplicidade e formatos falsos',()=>{
 const catalog=before();
 catalog.pncpDelta={since:'2026-11-23',through:'2026-11-22'};
 assert.throws(()=>validateProcurement(catalog),/Checkpoint/);
 catalog.pncpDelta={since:'2026-11-20',through:'2026-11-22',extra:'123'};
 assert.throws(()=>validateProcurement(catalog),/externo/);
});
test('rotina escreve arquivo so apos duas fontes completas; segunda execucao e no-op',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pncp-delta-'));
 try{
   await mkdir(join(root,'data/procurement'),{recursive:true});
   const path=join(root,'data/procurement/contracts.json');
   await writeFile(path,JSON.stringify(before())+'\n');
   let calls=0;
   const fetcher=async(url)=>{
     calls++;
     const p=new URL(url).searchParams;
     if(p.get('cnpjOrgao')===REITORIA_CNPJ)
       return pages([row(ifcId,REITORIA_CNPJ,{
         valorGlobal:1200,dataAtualizacaoGlobal:'2026-11-22'
       })]);
     return pages([],0,0);
   };
   const dry=await updatePncpDelta({root,now,fetcher,dryRun:true});
   assert.equal(dry.status,'dry_run');
   assert.equal(calls,0);
   const result=await updatePncpDelta({root,now,fetcher,wait:async()=>{}});
   assert.equal(result.status,'complete');
   assert.equal(result.changed,true);
   assert.equal(calls,2);
   const saved=JSON.parse(await readFile(path,'utf8'));
   assert.equal(saved.contracts.length,2);
   assert.equal(saved.contracts.find(c=>c.pncpId===ifcId).amountCents,120000);
   assert.equal(saved.pncpDelta.through,'2026-11-22');
   const beforeAgain=await readFile(path,'utf8');
   assert.equal((await updatePncpDelta({root,now,fetcher})).status,'up_to_date');
   assert.equal(calls,2);
   assert.equal(await readFile(path,'utf8'),beforeAgain);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('falha na segunda fonte preserva integralmente arquivo e checkpoint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pncp-delta-failure-'));
 try{
   await mkdir(join(root,'data/procurement'),{recursive:true});
   const path=join(root,'data/procurement/contracts.json');
   const original=JSON.stringify(before())+'\n';
   await writeFile(path,original);
   await assert.rejects(updatePncpDelta({root,now,wait:async()=>{},
     fetcher:async(url)=>{
       if(new URL(url).searchParams.get('cnpjOrgao')===CAMPUS_CNPJ)
         throw Error('CPF 12345678900 TOKEN privado');
       return pages([row(ifcId,REITORIA_CNPJ)]);
     }
   }));
   assert.equal(await readFile(path,'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
