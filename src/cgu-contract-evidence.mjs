/** Evidencia positiva contrato CGU -> NE integral, independente do PNCP.
 * Somente identidades e metadados administrativos minimos, sem valores/payload.
 * Checkpoints negativos ficam no cache operacional, nao no Git. */
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getCguArray} from './cgu.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {inScopeNe,scopeMonths,inScopeDate} from './collection-scope.mjs';
import {monthBounds} from './procurement.mjs';
import {assertPublicSafe} from './privacy.mjs';
import {stateKey,readOperationalState,saveOperationalState,validDay} from './operational-state.mjs';
export const CGU_CONTRACT_PATH='data/procurement/cgu-contract-links.json';
const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/';
const UG=new Set(['158459','158125']),P=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/,NUM=/^\d{1,6}\/20\d{2}$/,CNPJ=/^\d{14}$/;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const uniq=a=>[...new Set(a)].sort();
const numericId=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<1e13;
const parseId=v=>/^[1-9]\d{0,12}$/.test(String(v??''))?Number(v):null;
const unit=o=>{const s=String(o?.codigo??'');return /^\d{6}$/.test(s)?s:null;};
function day(v){
 if(typeof v!=='string')return null;
 const br=/^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(v);
 const s=br?br[3]+'-'+br[2]+'-'+br[1]:/^(20\d{2}-\d{2}-\d{2})(?:$|T)/.exec(v)?.[1];
 return validDay(s)?s:null;
}
function processNumber(v){
 if(typeof v!=='string')return null;
 if(P.test(v))return v;
 const m=/^(\d{5})(\d{6})(20\d{2})(\d{2})$/.exec(v);
 return m?m[1]+'.'+m[2]+'/'+m[3]+'-'+m[4]:null;
}
function number(v){
 const m=typeof v==='string'&&NUM.exec(v.trim());
 if(!m)return null;
 const [n,y]=m[0].split('/');
 return Number(n)+'/'+y;
}
export function normalizeCguContractIdentity(raw){
 const id=parseId(raw?.id),unitCode=unit(raw?.unidadeGestora),buyingUnit=unit(raw?.unidadeGestoraCompras);
 if(!numericId(id)||(!UG.has(unitCode)&&!UG.has(buyingUnit)))return null;
 const signed=day(raw.dataAssinatura),reference=signed||day(raw.dataPublicacaoDOU)||day(raw.dataInicioVigencia);
 if(!inScopeDate(reference))return null;
 const result={id,reference};
 if(unitCode)result.unitCode=unitCode;
 if(buyingUnit)result.buyingUnit=buyingUnit;
 const n=number(raw.numero),p=processNumber(raw.numeroProcesso);
 if(n)result.number=n;if(p)result.process=p;if(signed)result.signed=signed;
 const vendor=raw.fornecedor?.cnpj;
 if(typeof vendor==='string'&&/^[\d./-]+$/.test(vendor)&&CNPJ.test(vendor.replace(/[./-]/g,'')))result.supplierCnpj=vendor.replace(/[./-]/g,'');
 return result;
}
export function extractCguContractRefs(rows){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('Resposta documental CGU invalida');
 const refs=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.empenho!=='string')throw Error('Campo empenho CGU nao homologado');
  if(inScopeNe(row.empenho))refs.push(row.empenho);
 }
 return uniq(refs);
}
export const emptyCguContractEvidence=()=>({schema_version:1,unit:'158459',contracts:[]});
export function validateCguContractEvidence(data){
 assertPublicSafe(data);
 if(!exact(data,['schema_version','unit','contracts'])||data.schema_version!==1||data.unit!=='158459'||
  !Array.isArray(data.contracts)||data.contracts.length>5000)throw Error('Catalogo CGU invalido');
 const seen=new Set();
 for(const c of data.contracts){
  if(!exact(c,['id','reference','unitCode','buyingUnit','number','process','signed','supplierCnpj','refs'])||
   !numericId(c.id)||seen.has(c.id)||!validDay(c.reference)||!inScopeDate(c.reference)||
   (!UG.has(c.unitCode)&&!UG.has(c.buyingUnit))||
   [c.unitCode,c.buyingUnit].some(v=>v!==undefined&&(typeof v!=='string'||!/^\d{6}$/.test(v)))||
   (c.number!==undefined&&(typeof c.number!=='string'||number(c.number)!==c.number))||
   (c.process!==undefined&&(typeof c.process!=='string'||!P.test(c.process)))||
   (c.signed!==undefined&&!validDay(c.signed))||
   (c.supplierCnpj!==undefined&&(typeof c.supplierCnpj!=='string'||!CNPJ.test(c.supplierCnpj)))||
   !Array.isArray(c.refs)||!c.refs.length||c.refs.length>1000||
   c.refs.some(x=>!inScopeNe(x))||JSON.stringify(c.refs)!==JSON.stringify(uniq(c.refs)))throw Error('Evidencia CGU invalida');
  seen.add(c.id);
 }
 return data;
}
export async function readCguContractEvidence(root){
 try{return validateCguContractEvidence(JSON.parse(await readFile(join(root,CGU_CONTRACT_PATH),'utf8')));}
 catch(e){if(e.code==='ENOENT')return emptyCguContractEvidence();throw e}
}
/** Positivos observados nao comprovam lista completa. Ausencia posterior nao apaga
 * evidencia anterior; divergencias de identidade exigem revisao. */
export function mergeCguContractEvidence(previous,identity,refs){
 validateCguContractEvidence(previous);
 if(!refs.length)return {changed:false,data:previous};
 const old=previous.contracts.find(c=>c.id===identity.id);
 const row={...identity,refs:uniq([...(old?.refs||[]),...refs])};
 if(old&&['reference','unitCode','buyingUnit','number','process','signed','supplierCnpj'].some(k=>old[k]!==undefined&&row[k]!==undefined&&old[k]!==row[k]))throw Error('Identidade CGU alterada; revisar');
 const record={...old,...row};
 const data=validateCguContractEvidence({...previous,contracts:previous.contracts.filter(c=>c.id!==record.id).concat(record).sort((a,b)=>a.id-b.id)});
 return {changed:JSON.stringify(data)!==JSON.stringify(previous),data};
}
const pageKey=(month,page)=>stateKey(['cgu-contract-discovery-v1',month,page]);
const emptyKey=(month,page)=>stateKey(['cgu-contract-empty-v1',month,page]);
const contractKey=id=>stateKey(['cgu-contract-related-v1',id]);
const fresh=(stamp,now,days=30)=>validDay(stamp)&&stamp<=now.toISOString().slice(0,10)&&now.getTime()-Date.parse(stamp+'T00:00:00Z')<days*86400000;
export function planCguContractDiscovery({state={},now=new Date(),limit=3}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>4)throw Error('Limite de janelas CGU invalido');
 const months=scopeMonths(now,{includeCurrent:false}),last=months.at(-1);
 const seed=[last,...[1,2].map(n=>last?String(Number(last.slice(0,4))-n)+last.slice(4):'')].filter(m=>months.includes(m));
 const candidates=[];
 for(const month of months){
  for(let page=1;page<=8;page++){
   if(page>1&&fresh(state[emptyKey(month,page-1)],now))break;
   if(!fresh(state[pageKey(month,page)],now)){candidates.push({month,page,priority:page===1&&seed.includes(month)?0:page===1?1:2});break;}
  }
 }
 candidates.sort((a,b)=>a.priority-b.priority||String(state[pageKey(a.month,a.page)]||'').localeCompare(String(state[pageKey(b.month,b.page)]||''))||b.month.localeCompare(a.month));
 return candidates.slice(0,limit).map(({month,page})=>({month,page}));
}
const br=d=>d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4);
export async function collectCguContractEvidence({previous=emptyCguContractEvidence(),state={},now=new Date(),token,request=getCguArray,budget=createCguBudget({requests:40,durationMs:180000}),limit=3,dryRun=false}={}){
 validateCguContractEvidence(previous);
 const plan=planCguContractDiscovery({state,now,limit}),nextState={...state},today=now.toISOString().slice(0,10);
 let data=previous;
 const report={plannedWindows:plan.length,windows:0,contractsDiscovered:0,contractsQueried:0,positiveContracts:0,references:0,changes:0,failures:{}};
 const fail=e=>{const k=Number.isInteger(e?.status)?'http_'+e.status:'invalid_or_unavailable';report.failures[k]=(report.failures[k]||0)+1};
 const call=(path,query)=>request(BASE+path+'?'+new URLSearchParams(query),{token,budget});
 if(dryRun)return {data,state:nextState,report};
 if(!token)throw Error('CGU_API_KEY ausente');
 for(const {month,page} of plan){
  if(budget.stopped())break;
  try{
   const bounds=monthBounds(month,now);
   const rows=await call('contratos',{codigoOrgao:'26422',dataInicial:br(bounds.start),dataFinal:br(bounds.end),pagina:String(page)});
   if(!Array.isArray(rows)||rows.length>2000)throw Error('Lista de contratos CGU invalida');
   report.windows++;
   const identities=new Map();
   for(const row of rows){const c=normalizeCguContractIdentity(row);if(c&&c.reference<=today)identities.set(c.id,c);}
   report.contractsDiscovered+=identities.size;
   let complete=true;
   for(const identity of identities.values()){
    if(fresh(nextState[contractKey(identity.id)],now))continue;
    if(budget.stopped()){complete=false;break;}
    try{
     const refs=extractCguContractRefs(await call('contratos/documentos-relacionados',{id:String(identity.id)}));
     report.contractsQueried++;report.references+=refs.length;
     if(refs.length){report.positiveContracts++;const merged=mergeCguContractEvidence(data,identity,refs);data=merged.data;if(merged.changed)report.changes++;}
     nextState[contractKey(identity.id)]=today;
    }catch(e){complete=false;fail(e);}
   }
   if(complete){nextState[pageKey(month,page)]=today;if(!rows.length)nextState[emptyKey(month,page)]=today;}
  }catch(e){fail(e);}
 }
 return {data,state:nextState,report:{...report,telemetry:budget.snapshot()}};
}
async function main(){
 const root=process.cwd(),statePath=process.env.CGU_CONTRACT_STATE_PATH;
 const previous=await readCguContractEvidence(root),state=await readOperationalState(statePath);
 const result=await collectCguContractEvidence({previous,state,token:process.env.CGU_API_KEY,dryRun:process.argv.includes('--dry-run')});
 console.log('Evidencia contratual CGU (somente contagens): '+JSON.stringify(result.report));
 if(process.argv.includes('--dry-run'))return;
 if(JSON.stringify(previous)!==JSON.stringify(result.data)){
  const path=join(root,CGU_CONTRACT_PATH),tmp=path+'.tmp';
  await mkdir(join(root,'data/procurement'),{recursive:true});
  try{await writeFile(tmp,JSON.stringify(result.data)+'\n');await rename(tmp,path)}catch(e){await unlink(tmp).catch(()=>{});throw e}
 }
 await saveOperationalState(statePath,result.state);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error('Coleta de evidencias contratuais CGU interrompida; sem payload bruto.');process.exitCode=1;});
