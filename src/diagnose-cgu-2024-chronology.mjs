/**
 * Confronto efemero de uma NE 2024 sem origem no acervo, usando exclusivamente:
 * (1) detalhe CGU por codigo SIAFI; (2) historico oficial de itens;
 * (3) listagem CGU filtrada por dataEmissao, fase 1, UG 158459.
 *
 * Nenhuma data candidata e inferida como emissao. Nao grava arquivos ou
 * retorna/relata identificadores, datas exatas, texto livre, valores ou CPF.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateManifest,validateMonth} from './store.mjs';
import {
 missingReferencedNe,fetchCguOriginal,summarizeOriginalIssueFields
} from './recover-cgu-originals.mjs';
import {resolveItems} from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {requestDocuments} from './cgu.mjs';

const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const MAX_ITEMS=4,MAX_DATES=2,MAX_LIST_PAGES=4;
const MAX_ROWS_PER_PAGE=200;
const SAFE_FAILURES=new Set([
 'consulta_indisponivel','resposta_invalida','pagina_repetida',
 'limite_paginacao','item_invalido','movimentacao_invalida',
 'sequencial_duplicado_divergente','acesso_negado','recurso_nao_encontrado',
 'erro_http','invalid_shape','too_large','network','invalid_json'
]);
const allowedFailure=reason=>SAFE_FAILURES.has(reason)?reason:'source_unavailable';
function safeDetailFailure(error){
 const status=Number(error?.status);
 if(status===401||status===403)return 'authentication_required';
 if(status===404)return 'http_404';
 if(status===429)return 'rate_limited';
 if(Number.isSafeInteger(status)&&status>=500&&status<=599)
   return 'server_unavailable';
 if(Number.isSafeInteger(status)&&status>=400&&status<=499)
   return 'http_other';
 if(['network','too_large','invalid_shape','invalid_json'].includes(error?.code))
   return error.code;
 return 'source_unavailable';
}
const isIsoDate=value=>{
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
};
const asBrDate=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
const phase1=raw=>{
 if(raw===1||raw==='1')return true;
 if(typeof raw!=='string')return false;
 return ['empenho','1 - empenho'].includes(raw.trim().normalize('NFD')
   .replace(/[\u0300-\u036f]/g,'').toLowerCase());
};
function sameIdentity(row,id){
 return row&&typeof row==='object'&&!Array.isArray(row)&&
   row.documento===id&&String(row.codigoUg)==='158459'&&phase1(row.fase);
}
function findMissing2024(months){
 const pending=missingReferencedNe(months).filter(x=>NE.exec(x)?.[1]==='2024');
 return pending.sort();
}
async function loadMonths(root){
 const manifest=validateManifest(JSON.parse(await readFile(
   join(root,'data/manifest.json'),'utf8')));
 return Promise.all(manifest.months.map(async month=>
   validateMonth(JSON.parse(await readFile(
     join(root,'data/months',month+'.json'),'utf8')))));
}
/** Data real fica somente no escopo da memoria; resultados apenas contagens. */
export async function checkEmissionListing(id,date,{
 token,requestDayFn=requestDocuments,maxPages=MAX_LIST_PAGES
}={}){
 if(!NE.test(id)||!isIsoDate(date)||date.slice(0,4)!==NE.exec(id)[1]||
   !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_LIST_PAGES)
   throw Error('Consulta de emissao incompatível');
 const seen=new Set();
 let rowsChecked=0;
 for(let page=1;page<=maxPages;page++){
   let rows;
   try{rows=await requestDayFn(asBrDate(date),1,page,{token});}
   catch{return {status:'source_unavailable',rowsChecked,matched:false};}
   if(!Array.isArray(rows)||rows.length>MAX_ROWS_PER_PAGE||
      rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))
     return {status:'invalid_page',rowsChecked,matched:false};
   if(!rows.length)return {status:'complete_no_match',rowsChecked,matched:false};
   const signature=JSON.stringify(rows.map(row=>[
     typeof row.documento==='string'?row.documento:'',
     String(row.codigoUg??''),String(row.fase??'')
   ]));
   if(seen.has(signature))return {
     status:'repeated_page',rowsChecked,matched:false
   };
   seen.add(signature);
   rowsChecked+=rows.length;
   if(rows.some(row=>sameIdentity(row,id)))
     return {status:'exact_id_in_issuance_filter',rowsChecked,matched:true};
 }
 return {status:'pagination_incomplete',rowsChecked,matched:false};
}
export function summarizeChronologyEvents(movements,id){
 if(!NE.test(id)||!Array.isArray(movements))
   throw Error('Historico de NE invalido');
 const expected=NE.exec(id)[1];
 const dates=new Set();
 const result={originalYearEvents:0,laterYearOriginalEvents:0,
   earlierYearOriginalEvents:0,otherTypeEvents:0,invalidOriginalDates:0};
 for(const event of movements){
   if(event?.type!=='original'){result.otherTypeEvents++;continue;}
   if(!isIsoDate(event.date)){result.invalidOriginalDates++;continue;}
   const year=event.date.slice(0,4);
   if(year===expected){
     result.originalYearEvents++;dates.add(event.date);
   }else if(year>expected)result.laterYearOriginalEvents++;
   else result.earlierYearOriginalEvents++;
 }
 return {counts:result,candidateDates:[...dates].sort()};
}
/**
 * Nao tenta fechar a origem por hipotese.
 * Uma coincidencia em listagem filtrada por dataEmissao e evidência documental
 * independente, mas se o detalhe contradiz, exige homologacao.
 */
export async function diagnoseCgu2024Chronology({
 root=process.cwd(),sources=null,token,now=new Date(),
 requestDetail=fetchCguOriginal,resolveItemsFn=resolveItems,
 resolveHistoryFn=resolveItemMovements,requestDayFn=requestDocuments
}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
   throw Error('Data do diagnóstico invalida');
 const months=sources??await loadMonths(root);
 const pending=findMissing2024(months);
 if(!pending.length)return {status:'no_2024_pending',pending:0};
 if(pending.length!==1)return {status:'ambiguous_2024_pending',pending:pending.length};
 if(typeof token!=='string'||!token)throw Error('CGU_API_KEY ausente');
 const id=pending[0];
 let payload,detail,detailStatus='verified',detailFailure=null;
 try{payload=await requestDetail(id,{token});}
 catch(error){
   // As duas rotas seguintes consultam a MESMA NE por codigo completo.
   // Podem gerar evidencia diagnostica mesmo quando o detalhe falha,
   // mas nunca autorizam gravar origem nem presumir data de emissao.
   detailStatus='unavailable';
   detailFailure=safeDetailFailure(error);
 }
 if(payload!==undefined){
   try{detail=summarizeOriginalIssueFields(id,payload,{now});}
   catch{return {status:'detail_invalid',pending:1};}
   if(detail.identityConfirmed!==true||detail.phaseConfirmed!==true)
     return {status:'detail_identity_unverified',pending:1,
       identityConfirmed:detail.identityConfirmed,
       phaseConfirmed:detail.phaseConfirmed};
 }else if(detailStatus==='verified'){
   return {status:'detail_invalid',pending:1};
 }
 let items;
 try{items=await resolveItemsFn(id,{token,limit:4});}
 catch{items={ok:false,reason:'consulta_indisponivel'};}
 if(items?.ok!==true||!Array.isArray(items.items))
   return {status:'items_unavailable',pending:1,
     ...(detail?{detail}:{detailStatus,detailFailure}),
     reason:allowedFailure(items?.reason)};
 const ordered=[...items.items].sort((a,b)=>a.seq-b.seq);
 if(ordered.some(x=>!Number.isSafeInteger(x.seq)||x.seq<1)||
    new Set(ordered.map(x=>x.seq)).size!==ordered.length)
   return {status:'items_invalid',pending:1,detail};
 // Primeiro/ultimo item e ate dois itens intermediarios; leitura AMOSTRAL.
 const picks=ordered.length<=MAX_ITEMS?ordered:
   [ordered[0],ordered[1],ordered.at(-2),ordered.at(-1)];
 let completed=0,unavailable=0,totals={
   originalYearEvents:0,laterYearOriginalEvents:0,
   earlierYearOriginalEvents:0,otherTypeEvents:0,invalidOriginalDates:0
 };
 const candidateDates=new Set();
 const failures={};
 for(const item of picks){
   let history;
   try{history=await resolveHistoryFn(id,item.seq,{token,limit:4});}
   catch{history={ok:false,reason:'consulta_indisponivel'};}
   if(history?.ok!==true||!Array.isArray(history.movements)){
     unavailable++;
     const reason=allowedFailure(history?.reason);
     failures[reason]=(failures[reason]||0)+1;
     continue;
   }
   completed++;
   const result=summarizeChronologyEvents(history.movements,id);
   for(const [name,count] of Object.entries(result.counts))
     totals[name]+=count;
   for(const date of result.candidateDates)candidateDates.add(date);
 }
 const dates=[...candidateDates].sort();
 const selected=dates.slice(0,MAX_DATES),listing={
   candidateDaysObserved:dates.length,
   candidateDaysChecked:0,exactMatches:0,
   completeWithoutMatch:0,partialOrUnavailable:0,
   rowsExamined:0,statuses:{}
 };
 for(const date of selected){
   const outcome=await checkEmissionListing(id,date,{token,requestDayFn});
   listing.candidateDaysChecked++;
   listing.rowsExamined+=outcome.rowsChecked;
   listing.statuses[outcome.status]=(listing.statuses[outcome.status]||0)+1;
   if(outcome.matched)listing.exactMatches++;
   else if(outcome.status==='complete_no_match')listing.completeWithoutMatch++;
   else listing.partialOrUnavailable++;
 }
 const assessment=listing.exactMatches?
   (detailStatus==='verified'?
     'listing_corrob_or_requires_review':'listing_match_detail_unavailable'):
   dates.length?
     'item_history_only_not_issuance_proof':
     'no_original_date_candidate';
 return {
   status:'observed',pending:1,
   ...(detail?{detail}:{detailStatus,detailFailure}),
   items:{total:ordered.length,examined:picks.length,
     unexamined:ordered.length-picks.length},
   history:{completed,unavailable,failures,...totals},
   listing,assessment,originRecorded:false,
   note:'Dados amostrais; inclusao de item nao prova emissao. Nenhum registro foi incorporado.'
 };
}
async function main(){
 try{
   const result=await diagnoseCgu2024Chronology({
     root:resolve(process.cwd()),token:process.env.CGU_API_KEY
   });
   console.log('Diagnostico CGU cronologia NE 2024 (sem ID/data/valor): '+
     JSON.stringify(result));
 }catch{
   console.error('Diagnostico historico CGU inconclusivo; nenhum dado alterado.');
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();
