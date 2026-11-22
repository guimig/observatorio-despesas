import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {planNarrativeReviews,applyNarrativeReview,reviewDue,
  planCommitmentNarratives} from '../src/narrative-review.mjs';
import {refreshNarratives} from '../src/collect-public-narratives.mjs';
import {normalizeNotice} from '../src/pncp-notices.mjs';
import {mergeNotices,blankNotices,validateNotices} from '../src/pncp-notices-store.mjs';
import {normalizePncp} from '../src/procurement.mjs';
import {mergeProcurement,blankProcurement,validateProcurement} from '../src/procurement-store.mjs';
import {emptyMonth,mergeMonth,validateMonth} from '../src/store.mjs';

const now=new Date('2026-11-22T18:00:00Z');
const object='Fornecimento de materiais e equipamentos para atividades administrativas.\n\n'+
 'Critérios técnicos: '+('compatibilidade e qualidade documental. '.repeat(18)).trimEnd();
const pncpId='10635424000186-1-000123/2026';
const contractId='10635424000186-2-000123/2026';
const notice=()=>normalizeNotice({
 numeroControlePNCP:pncpId,numeroCompra:'90024/2026',
 dataPublicacaoPncp:'2026-11-19T12:00:00',modalidadeId:6,
 orgaoEntidade:{cnpj:'10635424000186'},unidadeOrgao:{codigoUnidade:'158125'},
 processo:'23349.000111/2026-18'
},6);
const contract=()=>normalizePncp({
 numeroControlePNCP:contractId,orgaoEntidade:{cnpj:'10635424000186'},
 dataPublicacaoPncp:'2026-11-19',numeroContratoEmpenho:'22/2026',
 tipoContrato:{nome:'Contrato (termo inicial)'},
 processo:'23349.000111/2026-18'
});
const noticeCatalog=()=>mergeNotices(blankNotices(),[
 {month:'2026-11',modality:6,status:'complete',records:[notice()]}
],now).data;
const contractCatalog=()=>mergeProcurement(blankProcurement(),[
 {month:'2026-11',source:'pncp',status:'complete',records:[contract()]}
],now).data;

test('planejamento prioriza objetos ausentes e respeita prazo entre consultas',()=>{
 const catalog=noticeCatalog();
 assert.deepEqual(planNarrativeReviews(catalog,{kind:'notice',now,batch:5}),
  [{id:'pncp:'+pncpId,pncpId}]);
 const first=applyNarrativeReview(catalog,'pncp:'+pncpId,null,{kind:'notice',now});
 assert.equal(first.changed,true);
 assert.equal(first.data.notices[0].object,undefined);
 assert.equal(first.data.notices[0].objectCheckedAt,'2026-11-22');
 assert.equal(planNarrativeReviews(first.data,{kind:'notice',now}).length,0);
 assert.equal(reviewDue('2026-11-22',now),false);
 assert.equal(reviewDue('2026-10-01',now),true);
});

test('reconsulta oficial incorpora objeto extenso sem apagar outros campos',()=>{
 const before=noticeCatalog();
 const outcome=applyNarrativeReview(before,'pncp:'+pncpId,object,{kind:'notice',now});
 assert.equal(outcome.data.notices[0].object,object);
 assert.equal(outcome.data.notices[0].process,before.notices[0].process);
 assert.doesNotThrow(()=>validateNotices(outcome.data));
 const again=applyNarrativeReview(outcome.data,'pncp:'+pncpId,object,{kind:'notice',now});
 assert.equal(again.changed,false);
 assert.deepEqual(planNarrativeReviews(outcome.data,{kind:'notice',now}),[]);
});

test('contrato rejeita texto sensível e mantém objeto antigo após nova listagem',()=>{
 let catalog=contractCatalog();
 const first=applyNarrativeReview(catalog,'pncp:'+contractId,object,
  {kind:'contract',now}).data;
 assert.equal(first.contracts[0].object,object);
 assert.doesNotThrow(()=>validateProcurement(first));
 const merged=mergeProcurement(first,[{
  month:'2026-11',source:'pncp',status:'complete',records:[contract()]
 }],new Date('2026-11-23T00:00:00Z')).data;
 assert.equal(merged.contracts[0].object,object);
 assert.equal(merged.contracts[0].objectCheckedAt,'2026-11-22');
 const unsafe=applyNarrativeReview(catalog,'pncp:'+contractId,
  'Solicitar user@example.com CPF 000.123.456-78',{kind:'contract',now});
 assert.equal(unsafe.data.contracts[0].object,undefined);
 assert.equal(unsafe.data.contracts[0].objectCheckedAt,'2026-11-22');
});

test('recoleta de listagem de aviso não apaga objeto ja seguro',()=>{
 const initial=applyNarrativeReview(noticeCatalog(),'pncp:'+pncpId,object,
  {kind:'notice',now}).data;
 const again=mergeNotices(initial,[{month:'2026-11',modality:6,
  status:'complete',records:[notice()]}],new Date('2026-11-23T00:00:00Z')).data;
 assert.equal(again.notices[0].object,object);
 assert.equal(again.notices[0].objectCheckedAt,'2026-11-22');
});

test('seleção de NEs sem descrição não se repete após revisão recente',()=>{
 const id='158459000012026NE000001';
 const m=mergeMonth(emptyMonth('2026-11'),'2026-11',[{
  documents:[{id,date:'2026-11-18',phase:1,cents:100}],
  links:[],coverage:{date:'2026-11-18',phase:1,complete:true,count:1,invalid:0}
 }]).data;
 assert.deepEqual(planCommitmentNarratives([m],{now}),['2026-11-18']);
 m.documents[0].descriptionCheckedAt='2026-11-22';
 assert.deepEqual(planCommitmentNarratives([m],{now}),[]);
 assert.doesNotThrow(()=>validateMonth(m));
});

test('integração retroativa publica somente catálogo validado em lote sem token CGU',async()=>{
 const root=await mkdtemp(join(tmpdir(),'observatorio-narrativas-'));
 try{
  await mkdir(join(root,'data','procurement'),{recursive:true});
  await writeFile(join(root,'data','manifest.json'),JSON.stringify({
   schema_version:1,unit:'158459',status:'aguardando_primeira_coleta',months:[]
  }));
  await writeFile(join(root,'data','procurement','notices.json'),JSON.stringify(noticeCatalog()));
  await writeFile(join(root,'data','procurement','contracts.json'),JSON.stringify(contractCatalog()));
  const preview=await refreshNarratives({root,now,token:'',dryRun:true});
  assert.equal(preview.notices,1);
  assert.equal(preview.contracts,1);
  const result=await refreshNarratives({root,now,token:'',
   noticeDetail:async id=>({pncpId:id,object}),
   contractDetail:async id=>({numeroControlePNCP:id,objetoContrato:object})
  });
  assert.equal(result.reviewedNotices,1);
  assert.equal(result.reviewedContracts,1);
  const n=JSON.parse(await readFile(join(root,'data','procurement','notices.json')));
  const c=JSON.parse(await readFile(join(root,'data','procurement','contracts.json')));
  assert.equal(n.notices[0].object,object);
  assert.equal(c.contracts[0].object,object);
  assert.equal((await refreshNarratives({root,now,token:'',dryRun:true})).notices,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('CGU incrementa descrições de NE e registra consulta sem repetir proximo dia',async()=>{
 const root=await mkdtemp(join(tmpdir(),'observatorio-narrativas-ne-'));
 try{
  await mkdir(join(root,'data','months'),{recursive:true});
  const id='158459000012026NE000002';
  const patch={documents:[{id,date:'2026-11-18',phase:1,cents:100}],
    links:[],coverage:{date:'2026-11-18',phase:1,complete:true,count:1,invalid:0}};
  const month=mergeMonth(emptyMonth('2026-11'),'2026-11',[patch],now).data;
  await writeFile(join(root,'data','manifest.json'),JSON.stringify({
    schema_version:1,unit:'158459',status:'dados_publicados',months:['2026-11']
  }));
  await writeFile(join(root,'data','months','2026-11.json'),JSON.stringify(month));
  const result=await refreshNarratives({root,now,token:'dummy',
    collect:async()=>({documents:[{...patch.documents[0],description:object}],
      links:[],coverage:patch.coverage})
  });
  assert.equal(result.reviewedCommitmentDates,1);
  const saved=JSON.parse(await readFile(join(root,'data','months','2026-11.json')));
  assert.equal(saved.documents[0].description,object);
  assert.equal(saved.documents[0].descriptionCheckedAt,'2026-11-22');
  assert.doesNotThrow(()=>validateMonth(saved));
  const preview=await refreshNarratives({root,now,token:'dummy',dryRun:true});
  assert.equal(preview.commitmentDates,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
