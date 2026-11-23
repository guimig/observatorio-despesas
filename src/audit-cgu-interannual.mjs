/** Evidencias documentais interanuais CGU; sem somatorios financeiros ou IDs em logs. */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMonth,validateManifest} from './store.mjs';

const DOC=/^158459\d{5}(20\d{2})(NS|OB|DF)\d{6}$/;
const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const PHASE={NS:2,OB:3,DF:3};
const TYPES=['NS','OB','DF'];
const groups=()=>Object.fromEntries(TYPES.map(x=>[x,0]));
/** Prova somente a relacao entre documentos observados no acervo local. */
export function auditInterannualCgu(sources){
 if(!Array.isArray(sources))throw Error('Colecao CGU invalida');
 const originals=new Set(),docs=new Map(),edges=new Set();
 let checkedHistory=0,emptyHistory=0,withoutHistory=0,legacyNoDate=0;
 const checked={liquidation:0,payment:0},pending={liquidation:0,payment:0};
 for(const data of sources){
   if(!data||!Array.isArray(data.documents)||!Array.isArray(data.relations)||
      (data.itemsByDocument!==undefined&&
       (!data.itemsByDocument||typeof data.itemsByDocument!=='object'||
         Array.isArray(data.itemsByDocument))))
     throw Error('Competencia documental invalida');
   for(const doc of data.documents){
     if(NE.test(doc.id)&&doc.phase===1) originals.add(doc.id);
     const match=DOC.exec(doc.id);
     if(!match||doc.phase!==PHASE[match[2]])continue;
     const previous=docs.get(doc.id);
     if(previous&&
       (previous.date!==doc.date||previous.phase!==doc.phase))
       throw Error('Documento CGU divergente entre competencias');
     docs.set(doc.id,{phase:doc.phase,type:match[2],year:Number(match[1])});
     if(!previous){
       const field=doc.phase===2?'liquidation':'payment';
       if(doc[field+'LinksChecked']===true)checked[field]++;
       else pending[field]++;
     }
   }
   for(const rel of data.relations){
     if(DOC.test(rel?.from)&&NE.test(rel?.to))
       edges.add(rel.from+'|'+rel.to);
   }
   for(const items of Object.values(data.itemsByDocument||{})){
     for(const item of items){
       if(item.historyChecked===true){
         checkedHistory++;
         if(!item.movements?.length)emptyHistory++;
         if(!item.historyCheckedAt)legacyNoDate++;
       }else withoutHistory++;
     }
   }
 }
 const prior=groups(),crossYearDocs=Object.fromEntries(TYPES.map(x=>[x,new Set()]));
 const distinctNE=new Set(),withoutOriginal=new Set(),missingByYear=new Map();
 const edgesPerDoc=new Map();
 let sameYear=0,futureYear=0,invalidSource=0;
 for(const key of edges){
   const [from,to]=key.split('|'),doc=docs.get(from),note=NE.exec(to);
   if(!doc||!note){invalidSource++;continue;}
   const targetYear=Number(note[1]);
   if(targetYear>doc.year){futureYear++;continue;}
   if(targetYear===doc.year){sameYear++;continue;}
   prior[doc.type]++;crossYearDocs[doc.type].add(from);distinctNE.add(to);
   edgesPerDoc.set(from,(edgesPerDoc.get(from)||0)+1);
   if(!originals.has(to)){
     withoutOriginal.add(to);
     const bucket=missingByYear.get(targetYear)||new Set();
     bucket.add(to);missingByYear.set(targetYear,bucket);
   }
 }
 const missingOriginalByYear=Object.fromEntries(
   [...missingByYear.entries()].sort(([a],[b])=>a-b)
     .map(([year,ids])=>[String(year),ids.size]));
 return {
   documentsWithEarlierYearNe:Object.fromEntries(
     TYPES.map(x=>[x,crossYearDocs[x].size])),
   earlierYearRelationships:prior,
   earlierYearNeDistinct:distinctNE.size,
   earlierYearNeWithoutOriginal:withoutOriginal.size,
   missingOriginalByYear,
   documentsWithMultipleEarlierYearNe:[...edgesPerDoc.values()].filter(x=>x>1).length,
   sameYearRelationships:sameYear,futureYearRelationships:futureYear,
   invalidSourceRelationships:invalidSource,
   relationCoverage:{checked,pending},
   itemHistories:{checked:checkedHistory,emptyButChecked:emptyHistory,
     checkedWithoutDate:legacyNoDate,notChecked:withoutHistory},
   caution:'Vinculo documental nao comprova RP inscrito, pagamento, saldo ou irregularidade'
 };
}
export async function main(){
 const root=process.cwd();
 const manifest=validateManifest(JSON.parse(await readFile(
   join(root,'data/manifest.json'),'utf8')));
 const data=await Promise.all(manifest.months.map(async month=>
   validateMonth(JSON.parse(await readFile(
     join(root,'data/months',month+'.json'),'utf8')))));
 console.log('Auditoria interanual CGU, somente contagens: '+
   JSON.stringify(auditInterannualCgu(data)));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(()=>{
   console.error('Auditoria interanual nao concluida: nenhum dado alterado');
   process.exitCode=1;
 });
}
