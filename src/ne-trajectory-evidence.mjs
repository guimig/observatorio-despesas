/**
 * Sondagem efemera de trajetorias NE -> documentos impactados pela CGU.
 * Relacoes locais sao apenas criterios de amostragem; a linha de impacto
 * so e atribuida a NE quando a fonte repete sua identidade SIAFI integral.
 * Nunca produz saldo, valor nominal, documento ou texto livre no resultado.
 */
import {getCguArray,parseMoneyCents} from './cgu.mjs';
import {classifyCguFailure} from './enrich-cgu.mjs';
import {impactUrl} from './inspect-cgu-siafi.mjs';
import {IMPACT_FIELDS} from './inspect-cgu-rap.mjs';

const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const DOC=/^158459\d{5}(20\d{2})(NS|OB|DF)\d{6}$/;
const PHASE={NS:2,OB:3,DF:3};
const SIGNS=['missing','invalid','negative','zero','positive'];
const HINTS=['reinscricao','inscricao','restos_a_pagar','baixa',
 'liquidacao','pagamento','transferencia','exclusao','retificacao','ajuste','sem_pista'];
const patterns=[
 ['reinscricao',/\breinscri/],['inscricao',/\binscri/],
 ['restos_a_pagar',/\brestos?\s+a\s+pagar\b/],
 ['baixa',/\bbaix/],['liquidacao',/\bliquid/],
 ['pagamento',/\bpag/],['transferencia',/\btransfer/],
 ['exclusao',/\bexclu/],['retificacao',/\bretific/],
 ['ajuste',/\bajust/]
];
const isValidYear=(n)=>Number.isInteger(n)&&n>=2000&&n<=2099;
const emptyFields=()=>Object.fromEntries(IMPACT_FIELDS.map(name=>
 [name,Object.fromEntries(SIGNS.map(sign=>[sign,0]))]));
const addFields=(destination,source)=>{
 for(const name of IMPACT_FIELDS)for(const sign of SIGNS)
   destination[name][sign]+=source[name][sign];
};

/**
 * Apenas pista lexical em classe fechada: NAO e operacao contabil validada.
 * Texto bruto, numeros e palavras desconhecidas nunca retornam ao resumo.
 */
export function otherOperationHint(operation){
 if(typeof operation!=='string')return 'sem_pista';
 const value=operation.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return patterns.find(([,pattern])=>pattern.test(value))?.[0]||'sem_pista';
}
export function emptyOperationHints(){
 return Object.fromEntries(HINTS.map(hint=>[hint,0]));
}
function safeIdentity(row){
 const raw=typeof row?.empenho==='string'?row.empenho:
   typeof row?.empenho?.documento==='string'?row.empenho.documento:'';
 return NE.test(raw)?raw:null;
}
function classifyAmount(value){
 if(value===null||value===undefined||value==='')return 'missing';
 const cents=parseMoneyCents(value);
 if(cents===null)return 'invalid';
 return cents===0?'zero':cents<0?'negative':'positive';
}
function validSource(source){
 return /^\d{4}-\d{2}$/.test(source?.month)&&
   Array.isArray(source?.data?.documents)&&
   Array.isArray(source?.data?.relations);
}

/**
 * Planeja no maximo 4 NEs com operacao 'other' em exercicio posterior.
 * Escolhe, quando disponiveis, um documento fase 3 e um fase 2 por NE.
 * Documentos N:M sao consultados uma vez e podem confirmar varias NEs.
 * A funcao retorna IDs apenas para uso efemero INTERNO.
 */
export function planLinkedNeEvidence(months,targets,{
 maxNotes=4,maxDocuments=8,maxPerNe=2
}={}){
 if(!Array.isArray(months)||!Array.isArray(targets)||
   ![maxNotes,maxDocuments,maxPerNe].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=12))
   throw Error('Plano documental invalido');
 const docs=new Map(),ambiguous=new Set(),linked=new Map();
 for(const source of months){
   if(!validSource(source))throw Error('Competencia documental invalida');
   const local=new Map();
   for(const document of source.data.documents){
     const match=DOC.exec(document?.id||'');
     if(!match||document.phase!==PHASE[match[2]])continue;
     local.set(document.id,document);
     const previous=docs.get(document.id);
     if(previous&&(previous.phase!==document.phase||previous.date!==document.date))
       ambiguous.add(document.id);
     else docs.set(document.id,{id:document.id,kind:match[2],
       phase:document.phase,year:Number(match[1])});
   }
   for(const edge of source.data.relations){
     if(!NE.test(edge?.to||'')||!local.has(edge?.from))continue;
     if(!linked.has(edge.to))linked.set(edge.to,new Set());
     linked.get(edge.to).add(edge.from);
   }
 }
 const accepted=[],seen=new Set();
 for(const item of targets){
   const match=NE.exec(item?.id||'');
   if(!match||item.year!==Number(match[1])||
     !Number.isSafeInteger(item.otherLater)||item.otherLater<0)
     throw Error('Empenho de referencia invalido');
   if(item.otherLater===0||seen.has(item.id))continue;
   seen.add(item.id);accepted.push(item);
 }
 const selected=new Map();
 let notesWithCandidates=0,notesSelected=0,notesWithoutCandidates=0;
 for(const target of accepted.slice(0,maxNotes)){
   const candidates=[...(linked.get(target.id)||[])].filter(id=>
     docs.has(id)&&!ambiguous.has(id)&&docs.get(id).year>target.year)
     .map(id=>docs.get(id)).sort((a,b)=>b.id.localeCompare(a.id));
   if(!candidates.length){notesWithoutCandidates++;continue;}
   notesWithCandidates++;
   const ordered=[],seenDoc=new Set();
   function add(doc){if(doc&&!seenDoc.has(doc.id)){
     seenDoc.add(doc.id);ordered.push(doc);
   }}
   add(candidates.find(doc=>doc.phase===3));
   add(candidates.find(doc=>doc.phase===2));
   for(const doc of candidates)add(doc);
   let added=0;
   for(const doc of ordered.slice(0,maxPerNe)){
     let record=selected.get(doc.id);
     if(!record&&selected.size>=maxDocuments)continue;
     if(!record){
       record={id:doc.id,phase:doc.phase,kind:doc.kind,year:doc.year,neIds:[]};
       selected.set(doc.id,record);
     }
     if(!record.neIds.includes(target.id)){
       record.neIds.push(target.id);added++;
     }
   }
   if(added)notesSelected++;
 }
 const documents=[...selected.values()];
 return {documents,counts:{
   targetsWithLaterOther:accepted.length,
   targetsConsidered:Math.min(accepted.length,maxNotes),
   notesWithCandidates,notesWithoutCandidates,notesSelected,
   documentsPlanned:documents.length,
   relationshipsPlanned:documents.reduce((n,d)=>n+d.neIds.length,0),
   documentsWithMultipleTargets:documents.filter(d=>d.neIds.length>1).length
 }};
}
function incomplete(status,reason){
 return {status,reason,rows:0,matchedRows:0,matchedTargets:0,
   rowsOtherNE:0,rowsUnknownNE:0,fields:emptyFields()};
}

/**
 * Sem pagina terminal nao publica sequer os sinais monetarios parciais.
 * Campos referem-se APENAS a linhas da API com NE integral que tambem
 * conste da relacao documental selecionada do acervo.
 */
export async function inspectLinkedNeEvidence(sample,{
 token,maxPages=4,request=getCguArray
}={}){
 const match=DOC.exec(sample?.id||'');
 if(!match||sample.kind!==match[2]||sample.phase!==PHASE[match[2]]||
    sample.year!==Number(match[1])||
    !Array.isArray(sample.neIds)||!sample.neIds.length||
    sample.neIds.length>12||new Set(sample.neIds).size!==sample.neIds.length||
    !sample.neIds.every(id=>NE.test(id)&&Number(NE.exec(id)[1])<sample.year)||
    !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>8)
   throw Error('Amostra de vinculo invalida');
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 const selected=new Set(sample.neIds),seenPages=new Set(),matchedTargets=new Set();
 const fields=emptyFields();
 let rows=0,matchedRows=0,rowsOtherNE=0,rowsUnknownNE=0;
 for(let page=1;page<=maxPages;page++){
   let response;
   try{response=await request(impactUrl(sample.id,sample.phase,page),{token});}
   catch(error){return incomplete('unavailable',classifyCguFailure(error));}
   if(!Array.isArray(response))return incomplete('unavailable','resposta_invalida');
   if(!response.length){
     return {status:rows?(matchedRows?'complete':'no_match'):'empty',
       reason:rows?'terminal_page':'no_rows',rows,matchedRows,
       matchedTargets:matchedTargets.size,rowsOtherNE,rowsUnknownNE,fields};
   }
   const fingerprint=JSON.stringify(response);
   if(seenPages.has(fingerprint))return incomplete('unavailable','pagina_repetida');
   seenPages.add(fingerprint);
   for(const row of response){
     if(!row||typeof row!=='object'||Array.isArray(row))
       return incomplete('unavailable','linha_invalida');
     rows++;
     const id=safeIdentity(row);
     if(!id){rowsUnknownNE++;continue;}
     if(!selected.has(id)){rowsOtherNE++;continue;}
     matchedTargets.add(id);matchedRows++;
     for(const key of IMPACT_FIELDS)
       fields[key][classifyAmount(row[key])]++;
   }
 }
 return incomplete('partial','limite_paginacao');
}

/** Resumo apenas de contagens e categorias; nao inclui IDs das amostras. */
export function summarizeLinkedNeEvidence(plan,audits){
 if(!plan||!Array.isArray(plan.documents)||!Array.isArray(audits)||
    plan.documents.length!==audits.length)
   throw Error('Resultado documental invalido');
 const byKind=Object.fromEntries(['NS','OB','DF'].map(kind=>[kind,{
   consulted:0,status:{complete:0,no_match:0,empty:0,partial:0,unavailable:0},
   matchedRows:0,matchedRelationships:0,rowsOtherNE:0,rowsUnknownNE:0,
   withPositiveRestoInscrito:0,withPositiveRestoCancelado:0,
   withPositiveRestoPago:0,fields:emptyFields()
 }]));
 for(let i=0;i<audits.length;i++){
   const sample=plan.documents[i],audit=audits[i],bucket=byKind[sample.kind];
   if(!bucket||!Object.hasOwn(bucket.status,audit?.status))
     throw Error('Categoria de consulta invalida');
   bucket.consulted++;bucket.status[audit.status]++;
   if(audit.status!=='complete'&&audit.status!=='no_match'&&audit.status!=='empty')
     continue;
   bucket.matchedRows+=audit.matchedRows;
   // Relacoes confirmadas por linhas do endpoint, NAO unicas entre documentos.
   bucket.matchedRelationships+=audit.matchedTargets;
   bucket.rowsOtherNE+=audit.rowsOtherNE;
   bucket.rowsUnknownNE+=audit.rowsUnknownNE;
   addFields(bucket.fields,audit.fields);
   for(const [key,field] of [['withPositiveRestoInscrito','valorRestoInscrito'],
     ['withPositiveRestoCancelado','valorRestoCancelado'],
     ['withPositiveRestoPago','valorRestoPago']])
     if(audit.fields[field].positive>0)bucket[key]++;
 }
 return {plan:plan.counts,byKind};
}
