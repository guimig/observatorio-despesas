/** Auditoria agregada de atribuicao documental, sem persistencia nem dados pessoais. */
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assessContractAttribution,assessNoticeAttribution} from '../assets/procurement-links.js';
import {classifyPncpInstrument} from '../assets/instrument-types.js';

const LEVELS=['confirmed','ne_indication','context','process_indication','unverified'];
const INSTRUMENTS=['formal_contract','commitment_substitute','other_substitute','unclassified'];
const blank=keys=>Object.fromEntries(keys.map(k=>[k,0]));
const count=(target,key)=>{if(!Object.hasOwn(target,key))throw Error('Categoria inesperada');target[key]++;};

export function auditAttribution({contracts=[],notices=[],documents=[]}={}){
 if(!Array.isArray(contracts)||!Array.isArray(notices)||!Array.isArray(documents))
  throw Error('Catalogos de auditoria invalidos');
 const commitmentDocs=documents.filter(d=>d.phase===1);
 const contractCounts=blank(LEVELS),noticeCounts=blank(LEVELS),instrumentCounts=blank(INSTRUMENTS);
 const bySource={};
 const contractEvidence=new Map();
 for(const contract of contracts){
  const level=assessContractAttribution(contract,commitmentDocs).level;
  count(contractCounts,level);
  count(instrumentCounts,classifyPncpInstrument(contract));
  const source=contract.source||'unknown';
  if(!Object.hasOwn(bySource,source))bySource[source]=blank(LEVELS);
  count(bySource[source],level);
  contractEvidence.set(contract.id,level);
 }
 let relatedNotices=0,confirmedNotices=0;
 const srpCounts={published:0,withoutPublishedInstrument:0,withPublishedInstrument:0};
 let otherNoticesWithoutInstrument=0;
 const relatedIds=new Set(contracts.map(c=>c.procurementId).filter(Boolean));
 for(const notice of notices){
  const level=assessNoticeAttribution(notice,contracts,commitmentDocs).level;
  count(noticeCounts,level);
  const hasInstrument=relatedIds.has(notice.pncpId);
  if(hasInstrument)relatedNotices++;
  if(notice.srp===true){
   srpCounts.published++;
   if(hasInstrument)srpCounts.withPublishedInstrument++;
   else srpCounts.withoutPublishedInstrument++;
  }else if(!hasInstrument)otherNoticesWithoutInstrument++;
  if(level==='confirmed')confirmedNotices++;
 }
 const referencedNes=new Set(contracts.flatMap(c=>c.commitmentRefs||[]));
 const knownNes=new Set(commitmentDocs.map(d=>d.id));
 const fullRefs=[...referencedNes].filter(id=>/^158459\d{5}20\d{2}NE\d{6}$/.test(id));
 return {
  schemaVersion:1,unit:'158459',
  contracts:{total:contracts.length,attribution:contractCounts,bySource,
   instrumentTypes:instrumentCounts,withOfficialPurchaseId:contracts.filter(c=>c.procurementLinkStatus==='linked'&&c.procurementId).length,
   purchaseIdReported:contracts.filter(c=>Boolean(c.procurementId)).length,
   withCommitmentRefs:contracts.filter(c=>Array.isArray(c.commitmentRefs)&&c.commitmentRefs.length>0).length,
   completeCommitmentQueries:contracts.filter(c=>c.commitmentStatus==='complete').length},
  notices:{total:notices.length,attribution:noticeCounts,withRelatedContract:relatedNotices,confirmedWithEvidence:confirmedNotices,
   srp:srpCounts,otherWithoutPublishedInstrument:otherNoticesWithoutInstrument},
  documents:{collectedCommitments:knownNes.size,uniqueFullNeRefs:fullRefs.length,
   fullNeRefsWithCguDocument:fullRefs.filter(id=>knownNes.has(id)).length},
  cautions:[
   'Atribuicao confirmada nao representa valor pago nem cobertura integral da contratacao.',
   'Publicacao centralizada da Reitoria nao identifica automaticamente o campus beneficiario.',
   'Processo e fornecedor coincidentes nao comprovam vinculacao contratual.',
   'Amostra corresponde exclusivamente aos registros atualmente armazenados; ausencia nao significa zero.',
   'Licitacao e ata de registro de precos nao exigem empenho imediato; ausencia de NE nao e irregularidade.',
   'SRP sem instrumento publicado nao e pendencia: a ata pode nunca gerar contratacao; ARPs ainda nao estao inventariadas.',
   'Contratos PNCP ausentes no acervo nao demonstram inexistencia de contratos, atas ou empenhos na origem.'
  ]
 };
}

async function main(){
 const root=process.cwd();
 const [catalog,notices,files]=await Promise.all([
  readFile(join(root,'data/procurement/contracts.json'),'utf8').then(JSON.parse),
  readFile(join(root,'data/procurement/notices.json'),'utf8').then(JSON.parse),
  readdir(join(root,'data/months'))
 ]);
 const names=files.filter(name=>/^20\d{2}-(0[1-9]|1[0-2])\.json$/.test(name)).sort();
 const months=await Promise.all(names.map(name=>readFile(join(root,'data/months',name),'utf8').then(JSON.parse)));
 const result=auditAttribution({
  contracts:catalog.contracts,notices:notices.notices,
  documents:months.flatMap(m=>m.documents)
 });
 console.log(JSON.stringify({...result,revision:process.env.GITHUB_SHA||'unknown',
  monthsExamined:names.map(name=>name.slice(0,7))},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(error=>{console.error('Auditoria quantitativa indisponivel: '+error.message);process.exitCode=1;});
