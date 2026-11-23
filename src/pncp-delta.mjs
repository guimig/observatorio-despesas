/**
 * Atualizacoes PNCP por data: somente registros contratuais ja catalogados.
 * ID PNCP nao identifica automaticamente a NE financeira da UG 158459.
 * Novos IDs ficam para a coleta mensal, cuja cobertura tem controle proprio.
 */
import {CAMPUS_CNPJ,REITORIA_CNPJ,normalizePncp,requestPublicJSON}
  from './procurement.mjs';
import {validateProcurement} from './procurement-store.mjs';
import {mergePncpRecord} from './pncp-record-revisions.mjs';

export const PNCP_DELTA_ORGS=Object.freeze([REITORIA_CNPJ,CAMPUS_CNPJ]);
export const PNCP_DELTA_PAGE_SIZE=100;
const MAX_PAGES=20;
const DAY=86400000;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const URL='https://pncp.gov.br/api/consulta/v1/contratos/atualizacao';

const problem=(code)=>Object.assign(new Error('Consulta PNCP incompleta'),{code});

function isDate(value){
 if(typeof value!=='string'||!DATE.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function addDays(value,days){
 if(!isDate(value)||!Number.isSafeInteger(days)||Math.abs(days)>3650)
   throw problem('invalid_date');
 return new Date(Date.parse(value+'T00:00:00Z')+DAY*days).toISOString().slice(0,10);
}
function brazilDate(now){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
   throw problem('invalid_clock');
 const parts=new Intl.DateTimeFormat('en-US',{
   timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(now);
 const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return values.year+'-'+values.month+'-'+values.day;
}

/**
 * Primeira janela: ultimos tres dias completos. Depois, avanca o checkpoint,
 * reconsultando um dia para tolerar publicacoes de fronteira.
 * Nao reexecuta a mesma janela se ainda nao houver dia novo.
 */
export function planPncpDelta(catalog,{now=new Date(),days=3}={}){
 validateProcurement(catalog);
 if(!Number.isSafeInteger(days)||days<1||days>7)
   throw problem('invalid_window_days');
 const latest=addDays(brazilDate(now),-1);
 const last=catalog.pncpDelta?.through;
 if(last&&last>latest)throw problem('checkpoint_in_future');
 if(last===latest)return null;
 const from=last||addDays(latest,1-days);
 const to=last?[addDays(from,days-1),latest].sort()[0]:latest;
 if(!isDate(from)||!isDate(to)||from>to)
   throw problem('invalid_window');
 return {from,to,initial:!last};
}
export function pncpDeltaUrl(from,to,org,page=1){
 if(!isDate(from)||!isDate(to)||from>to||
    (Date.parse(to)-Date.parse(from))/DAY>6||
    !PNCP_DELTA_ORGS.includes(org)||
    !Number.isSafeInteger(page)||page<1||page>MAX_PAGES)
   throw problem('invalid_query');
 return URL+'?'+new URLSearchParams({
   dataInicial:from.replaceAll('-',''),dataFinal:to.replaceAll('-',''),
   cnpjOrgao:org,pagina:String(page),
   tamanhoPagina:String(PNCP_DELTA_PAGE_SIZE)
 });
}
function pageContent(body){
 if(!body||typeof body!=='object'||Array.isArray(body))
   throw problem('invalid_envelope');
 const rows=Array.isArray(body.data)?body.data:
   Array.isArray(body.dados)?body.dados:null;
 const pages=Number(body.totalPaginas);
 if(!rows||!Number.isSafeInteger(pages)||pages<0||pages>1000||
    rows.length>PNCP_DELTA_PAGE_SIZE||
    (pages===0&&rows.length!==0)||(pages>0&&rows.length===0))
   throw problem('invalid_envelope');
 const total=body.totalRegistros===undefined?null:Number(body.totalRegistros);
 if(total!==null&&(!Number.isSafeInteger(total)||total<0))
   throw problem('invalid_count');
 return {rows,pages,total};
}

/** Todos os registros ficam em memoria ate a ultima pagina valida. */
export async function scanPncpDelta(from,to,org,{
 fetcher=requestPublicJSON,maxPages=MAX_PAGES,
 wait=()=>Promise.resolve()
}={}){
 pncpDeltaUrl(from,to,org);
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)
   throw problem('invalid_page_limit');
 const records=new Map();
 let declared=null,total=null,pagesRead=0;
 for(let page=1;page<=maxPages;page++){
   const body=await fetcher(pncpDeltaUrl(from,to,org,page));
   const parsed=pageContent(body);
   if(declared===null){
     declared=parsed.pages;
     total=parsed.total;
     if(declared>maxPages)throw problem('pagination_limit');
   }
   if(parsed.pages!==declared||parsed.total!==total)
     throw problem('pagination_changed');
   pagesRead++;
   if(declared===0)break;
   for(const raw of parsed.rows){
     const normalized=normalizePncp(raw);
     if(!normalized||normalized.orgCnpj!==org||
        !normalized.pncpId.startsWith(org+'-2-'))
       throw problem('invalid_contract');
     if(records.has(normalized.id))throw problem('duplicated_pncp_id');
     records.set(normalized.id,normalized);
   }
   if(page===declared)break;
   if(page>=maxPages)throw problem('pagination_limit');
   await wait();
 }
 if(declared===null||pagesRead!==Math.max(1,declared))
   throw problem('pagination_limit');
 if(total!==null&&records.size!==total)
   throw problem('count_mismatch');
 return {org,from,to,complete:true,pages:pagesRead,records:[...records.values()]};
}
function canonical(data){
 const sorted=value=>Array.isArray(value)?value.map(sorted):
   value&&typeof value==='object'?Object.fromEntries(
     Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
 const copy=structuredClone(data);
 delete copy.updated_at;
 return JSON.stringify(sorted(copy));
}

/**
 * Mantem a cobertura do catalogo por mes intacta.
 * Unknown PNCP IDs sao contabilizados, nunca publicados como registros completos
 * sem cobertura mensal. Nao reutiliza IDs ou valores para fabricar vinculo CGU.
 */
export function applyPncpDelta(catalog,plan,scans,{now=new Date()}={}){
 const previous=validateProcurement(structuredClone(catalog));
 if(!plan||!isDate(plan.from)||!isDate(plan.to)||plan.to<plan.from||
    !Array.isArray(scans)||scans.length!==PNCP_DELTA_ORGS.length||
    !(now instanceof Date)||!Number.isFinite(now.getTime()))
   throw problem('invalid_batch');
 const last=previous.pncpDelta?.through;
 if((last&&plan.from!==last)||(!last&&plan.initial!==true)||
    (last&&plan.to<=last))
   throw problem('checkpoint_conflict');
 const next=structuredClone(previous);
 const index=new Map(next.contracts.map((x,i)=>[x.id,i]));
 const seen=new Set(),summary={
   scanned:0,matched:0,unmatched:0,changedRecords:0,
   materialChanges:0,stale:0,pages:0
 };
 for(const org of PNCP_DELTA_ORGS){
   const scan=scans.find(s=>s.org===org);
   if(!scan||scan.complete!==true||scan.from!==plan.from||scan.to!==plan.to||
      !Number.isSafeInteger(scan.pages)||scan.pages<1||
      !Array.isArray(scan.records))throw problem('incomplete_source');
   summary.pages+=scan.pages;
   for(const record of scan.records){
     if(!record||record.orgCnpj!==org||
        typeof record.id!=='string'||!record.id.startsWith('pncp:'+org+'-2-')||
        seen.has(record.id))throw problem('invalid_or_repeated_id');
     seen.add(record.id);summary.scanned++;
     const position=index.get(record.id);
     if(position===undefined){summary.unmatched++;continue;}
     const old=next.contracts[position];
     if(old.sourceUpdatedAt&&!record.sourceUpdatedAt)
       throw problem('missing_update_date');
     const result=mergePncpRecord(old,record,{kind:'contract',now,checked:false});
     summary.matched++;
     if(result.stale){summary.stale++;continue;}
     if(result.changed){
       next.contracts[position]=result.record;
       summary.changedRecords++;
       if(result.materialChanged)summary.materialChanges++;
     }
   }
 }
 next.pncpDelta={
   since:previous.pncpDelta?.since||plan.from,
   through:plan.to
 };
 if(canonical(next)===canonical(previous))
   return {changed:false,data:previous,summary};
 next.updated_at=now.toISOString();
 validateProcurement(next);
 return {changed:true,data:next,summary};
}
