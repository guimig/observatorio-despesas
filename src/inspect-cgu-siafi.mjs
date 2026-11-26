/**
 * Diagnóstico autenticado, somente em memória e exclusivamente estrutura agregada.
 * Nunca persiste respostas, não imprime IDs SIAFI, fornecedores, processos ou CPF.
 * Usa a chave já armazenada em secrets.CGU_API_KEY no GitHub Actions.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCguArray } from './cgu.mjs';

const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/despesas';
const DOC=/^158459\d{5}20\d{2}(NE|NS|OB|DF)\d{6}$/;
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const FASES={NE:1,NS:2,OB:3,DF:3};
const safeField=/^[a-zA-Z][a-zA-Z0-9_]{0,55}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function safeDocumentDateComparison(payload,{listingDate=null,firstItemDate=null}={}){
 const raw=payload?.data;
 const parse=v=>{
   if(typeof v!=='string')return null;
   let match=/^(20\d{2}-\d{2}-\d{2})/.exec(v);
   if(match)return match[1];
   match=/^(\d{2})\/(\d{2})\/(20\d{2})/.exec(v);
   return match?match[3]+'-'+match[2]+'-'+match[1]:null;
 };
 const source=parse(raw);
 return {dateFieldPresent:typeof raw==='string',validDate:Boolean(source),
   matchesListing:source&&parse(listingDate)?source===parse(listingDate):null,
   matchesFirstItemInclusion:source&&parse(firstItemDate)?
     source===parse(firstItemDate):null};
}
export function docType(id) {
  const match=typeof id==='string'&&DOC.exec(id);
  return match ? match[1] : null;
}
function valid(document) {
  if(!docType(document))throw Error('Identificador SIAFI/UG inválido');
  return document;
}
export function detailUrl(id) {
  return BASE+'/documentos/'+encodeURIComponent(valid(id));
}
export function relatedUrl(id,phase) {
  valid(id);
  if(!Number.isInteger(phase)||phase!==FASES[docType(id)])
    throw Error('Fase CGU não corresponde ao documento');
  return BASE+'/documentos-relacionados?'+new URLSearchParams({
    codigoDocumento:id,fase:String(phase)
  });
}
export function impactUrl(id,phase,page=1) {
  valid(id);
  if(![2,3].includes(phase)||phase!==FASES[docType(id)]||
     !Number.isSafeInteger(page)||page<1||page>100)
    throw Error('Fase/página CGU inválida');
  return BASE+'/empenhos-impactados?'+new URLSearchParams({
    codigoDocumento:id,fase:String(phase),pagina:String(page)
  });
}
export function itemHistoryUrl(ne,seq,page=1) {
  if(!NE.test(ne)||!Number.isSafeInteger(seq)||seq<1||seq>100000||
     !Number.isSafeInteger(page)||page<1||page>100)
    throw Error('Item de empenho inválido');
  return BASE+'/itens-de-empenho/historico?'+new URLSearchParams({
    codigoDocumento:ne,sequencial:String(seq),pagina:String(page)
  });
}
export function structuralFields(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return [];
  return Object.keys(payload).filter(field=>safeField.test(field)).sort()
    .slice(0,90).map(field=>{
      const v=payload[field];
      const type=v===null?'null':Array.isArray(v)?'array':typeof v;
      return field+':'+type;
    });
}
export function classifyMovement(op){
  if(typeof op!=='string')return 'unknown';
  const value=op.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/anula/.test(value))return 'annulment';
  if(/reforc/.test(value))return 'reinforcement';
  if(/cancel/.test(value))return 'cancellation';
  if(/estorn/.test(value))return 'reversal';
  if(/emiss|inclus|original/.test(value))return 'original';
  return 'other';
}
export function summarizeItems(rows){
  if(!Array.isArray(rows))throw Error('Lista da CGU inválida');
  const counts={original:0,reinforcement:0,annulment:0,cancellation:0,
    reversal:0,other:0,unknown:0};
  for(const x of rows){
    counts[classifyMovement(x?.operacao)]++;
  }
  return {count:rows.length,fields:structuralFields(rows[0]),operations:counts};
}
export function summarizeImpacts(rows){
  if(!Array.isArray(rows))throw Error('Lista da CGU inválida');
  const doc=new Set();let withoutNe=0,negative=0;
  for(const row of rows){
    const raw=typeof row?.empenho==='string'?row.empenho:
      typeof row?.empenho?.documento==='string'?row.empenho.documento:'';
    if(NE.test(raw))doc.add(raw);
    else withoutNe++;
    for(const name of ['valorLiquidado','valorPago','valorRestoPago']){
      const v=row?.[name];
      if(typeof v==='string' && /^\s*-/.test(v) || typeof v==='number'&&v<0){
        negative++;break;
      }
    }
  }
  return {
    count:rows.length,uniqueNe:doc.size,missingNe:withoutNe,
    negativeRows:negative,fields:structuralFields(rows[0]),
    pageOnly:true
  };
}
export function selectSamples(month){
  if(!month||!Array.isArray(month.documents)||!Array.isArray(month.relations))
    throw Error('Competência CGU incompatível');
  const links=new Map();
  for(const row of month.relations){
    const s=links.get(row.from)||new Set();
    if(NE.test(row.to))s.add(row.to);
    links.set(row.from,s);
  }
  const documents=[];
  for(const kind of ['NE','NS','OB','DF']){
    let options=month.documents.filter(row=>docType(row.id)===kind &&
      row.phase===FASES[kind]);
    if(kind==='NE'){
      options=options.sort((a,b)=>{
        const priority=doc=>{
          const items=month.itemsByDocument?.[doc.id]||[];
          const originals=items.flatMap(item=>(item.movements||[])
            .filter(m=>m.type==='original').map(m=>m.date));
          return originals.length&&originals.sort()[0]!==doc.date?2:
            items.length?1:0;
        };
        return priority(b)-priority(a);
      });
    }
    if(kind==='NS'){
      options=options.sort((a,b)=>
        (links.get(b.id)?.size||0)-(links.get(a.id)?.size||0));
    }
    if(kind==='OB'||kind==='DF'){
      options=options.sort((a,b)=>
        Number(b.paymentLinksChecked===true)-Number(a.paymentLinksChecked===true));
    }
    const row=options[0];
    if(row){
      const item=month.itemsByDocument?.[row.id]?.[0];
      const firstItemDate=kind==='NE'?
        (month.itemsByDocument?.[row.id]||[]).flatMap(i=>(i.movements||[])
          .filter(m=>m.type==='original').map(m=>m.date)).sort()[0]:null;
      documents.push({id:row.id,phase:row.phase,kind,
        ...(row.date?{listingDate:row.date}:{}),
        ...(firstItemDate?{firstItemDate}:{}),
        ...(kind==='NE'&&Number.isSafeInteger(item?.seq)?{seq:item.seq}:{})});
    }
  }
  return documents;
}
function statusOf(err){
  const msg=typeof err?.message==='string'?err.message:'';
  const matched=/^CGU HTTP (\d{3})$/.exec(msg);
  return matched?'HTTP '+matched[1]:'indisponivel/formato';
}
/** Conta somente identificadores estruturados, sem expor valores ou nomes.
 * Mesmo se houver NS e OB no retorno, nao presumir uma aresta de quitacao. */
export function summarizeRelatedRows(rows){
 const counts={fullCampusNe:0,fullCampusNs:0,fullCampusPayment:0,shortOnly:0,otherOrUnknown:0};
 const fields=new Set();
 for(const row of rows){
  for(const field of ['documento','codigoDocumento','documentoRelacionado','codigo']){
   if(typeof row?.[field]==='string')fields.add(field);
  }
  const candidates=[row?.documento,row?.codigoDocumento,row?.documentoRelacionado,row?.codigo,
   row?.documento?.codigo,row?.documento?.documento].filter(v=>typeof v==='string');
  const full=[...new Set(candidates.filter(v=>/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/.test(v)))];
  if(full.length!==1){
   if(candidates.some(v=>/^20\d{2}[A-Z]{2}\d{6}$/.test(v)))counts.shortOnly++;
   else counts.otherOrUnknown++;
   continue;
  }
  const id=full[0],species=id.slice(15,17);
  if(Number(id.slice(11,15))<2024){counts.otherOrUnknown++;continue;}
  if(species==='NE')counts.fullCampusNe++;
  else if(species==='NS')counts.fullCampusNs++;
  else if(['OB','DF','DR','GP'].includes(species))counts.fullCampusPayment++;
  else counts.otherOrUnknown++;
 }
 return {count:rows.length,fields:structuralFields(rows[0]),pageOnly:false,
  identifierFields:[...fields].sort(),identityCounts:counts};
}
async function listSummary(url,{token,request=getCguArray,mode='related'}={}){
  try{
    const rows=await request(url,{token});
    const result=mode==='history'?summarizeItems(rows):
      mode==='impacts'?summarizeImpacts(rows):
      summarizeRelatedRows(rows);
    return {status:'ok',...result};
  }catch(error){return {status:statusOf(error)};}
}
export async function inspectDocumentDetails(id,{
  token,fetcher=fetch,listingDate=null,firstItemDate=null
}={}){
  if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
  const url=detailUrl(id);
  let resp;
  try{
    resp=await fetcher(url,{
      headers:{Accept:'application/json','chave-api-dados':token},
      signal:AbortSignal.timeout(18000)
    });
  }catch{return {status:'indisponivel/rede'};}
  if(!resp?.ok) return {status:resp?.status>=400&&resp?.status<=599 ?
    'HTTP '+resp.status:'indisponivel/formato'};
  try{
    const data=await resp.json();
    if(!data||typeof data!=='object'||Array.isArray(data))
      return {status:'indisponivel/formato'};
    return {status:'ok',fields:structuralFields(data),
      dateComparison:safeDocumentDateComparison(data,{listingDate,firstItemDate})};
  }catch{return {status:'indisponivel/formato'};}
}
export async function inspectCguSample(sample,{
  token,request=getCguArray,detail=inspectDocumentDetails
}={}){
  if(!sample||docType(sample.id)!==sample.kind ||
     sample.phase!==FASES[sample.kind])throw Error('Amostra não reconhecida');
  const result={kind:sample.kind,
    details:await detail(sample.id,{token,listingDate:sample.listingDate,
      firstItemDate:sample.firstItemDate})};
  result.related=await listSummary(relatedUrl(sample.id,sample.phase),
    {token,request});
  if(sample.phase===2||sample.phase===3){
    result.impacts=await listSummary(impactUrl(sample.id,sample.phase),
      {token,request,mode:'impacts'});
  }
  if(sample.kind==='NE'&&Number.isSafeInteger(sample.seq)){
    result.itemHistory=await listSummary(itemHistoryUrl(sample.id,sample.seq),
      {token,request,mode:'history'});
  }
  return result;
}
async function main(){
  const token=process.env.CGU_API_KEY;
  if(!token)throw Error('CGU_API_KEY não configurada no workflow');
  const manifest=JSON.parse(await readFile(join(process.cwd(),'data','manifest.json'),'utf8'));
  const month=[...manifest.months].sort().reverse()[0];
  if(!month)throw Error('Não há competência CGU para inspeção');
  const dataset=JSON.parse(await readFile(join(process.cwd(),'data','months',month+'.json'),'utf8'));
  const sample=selectSamples(dataset);
  console.log('Sondagem SIAFI/CGU: mês '+month+'; '+sample.length+
    ' espécies documentais selecionadas. Sem escrita em disco.');
  for(let i=0;i<sample.length;i++){
    if(i)await pause(800);
    const findings=await inspectCguSample(sample[i],{token});
    console.log('Espécie '+findings.kind+': '+JSON.stringify(findings));
  }
  console.log('Diagnóstico concluído: somente tipos de campos, contagens e '+
    'classes gerais de operação. Nenhum ID, valor, nome, CPF, resposta bruta ou token em log.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(error=>{
    console.error(/CGU_API_KEY/.test(error.message)?'Secret CGU_API_KEY ausente':
      'Sondagem CGU não concluída; nenhum dado modificado.');
    process.exitCode=1;
  });
}
