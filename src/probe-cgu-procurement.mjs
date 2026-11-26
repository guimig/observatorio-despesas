/** Sondagem de vinculos diretos CGU, sem gravar payloads ou atribuir a PNCP.
 * Usa processos ja presentes no acervo IFC e identidades declaradas pela CGU;
 * uma pagina de cada rota nao comprova completude. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {getCguArray} from './cgu.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {validatePublishedData} from './store.mjs';
import {readNotices} from './pncp-notices-store.mjs';
import {readProcurement} from './procurement-store.mjs';
const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/';
const P=/^\d{5}\.\d{6}\/(20\d{2})-\d{2}$/;
const UG=new Set(['158459','158125']);
const label=s=>typeof s==='string'?s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase():'';
const fieldNames=obj=>obj&&typeof obj==='object'&&!Array.isArray(obj)?Object.keys(obj).filter(k=>/^[A-Za-z0-9_-]{1,60}$/.test(k)).sort().slice(0,60):[];
function digits(value,pattern){return ['string','number'].includes(typeof value)&&pattern.test(String(value))?String(value):null}
export function selectProcesses(notices=[],contracts=[]){
 const candidates=[...notices,...contracts].map(r=>r.process).filter(p=>typeof p==='string'&&P.test(p)&&Number(P.exec(p)[1])>=2024);
 return [...new Set(candidates)].sort((a,b)=>Number(b.startsWith('23349.'))-Number(a.startsWith('23349.'))||b.slice(13,17).localeCompare(a.slice(13,17))||a.localeCompare(b)).slice(0,5);
}
export function procurementKey(row,modalities){
 const codigoUG=digits(row?.unidadeGestora?.codigo??row?.unidadeGestora?.codigoUg??row?.unidadeGestora?.codigoUG,/^\d{6}$/);
 const raw=typeof row?.licitacao?.numero==='string'?row.licitacao.numero.trim():'';
 const number=/^(\d{1,6})\/(20\d{2})$/.exec(raw);
 const plain=number?number[1]+number[2]:/^\d{5,10}$/.test(raw)?raw:null;
 if(!UG.has(codigoUG)||!plain||!/^20\d{2}$/.test(plain.slice(-4))||Number(plain.slice(-4))<2024)return null;
 const name=label(row?.modalidadeLicitacao);
 const codes=[...new Set(modalities.filter(m=>name&&label(m?.descricao)===name).map(m=>digits(m.codigo,/^\d{1,6}$/)).filter(Boolean))];
 if(codes.length!==1)return null;
 return {codigoUG,numero:plain,codigoModalidade:codes[0]};
}
export function identityCounts(rows,known,field){
 const full=new Set(),out={rows:rows.length,fullCampusNe:0,knownCampusNe:0,shortNe:0,otherOrUnknown:0,fullCampusLiquidation:0,fullCampusPayment:0};
 for(const r of rows){
  const v=r?.[field]??(field==='empenho'?r?.documento:undefined);
  if(typeof v==='string'&&/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/.test(v)&&Number(v.slice(11,15))>=2024){
   const s=v.slice(15,17);
   if(s==='NE'){full.add(v);continue;}
   if(s==='NS'){out.fullCampusLiquidation++;continue;}
   if(['OB','DF','DR','GP'].includes(s)){out.fullCampusPayment++;continue;}
  }
  if(typeof v==='string'&&/^20\d{2}NE\d{6}$/.test(v))out.shortNe++;
  else out.otherOrUnknown++;
 }
 out.fullCampusNe=full.size;out.knownCampusNe=[...full].filter(id=>known.has(id)).length;
 return out;
}
const safeStatus=e=>Number.isInteger(e?.status)?'http_'+e.status:'unavailable_or_invalid';
export async function probeCguProcurement({token,notices=[],contracts=[],months=[],request=getCguArray,budget=createCguBudget({requests:25,durationMs:180000}),now=new Date()}={}){
 if(!token)throw Error('CGU_API_KEY ausente');
 const known=new Set(months.flatMap(m=>m.documents.filter(d=>d.phase===1).map(d=>d.id)));
 const report={sampleOnly:true,processLookups:[],purchaseLookups:[],contractLookups:[]};
 const call=async(path,query={})=>{
  if(budget.stopped())return {status:'deferred_budget',rows:[]};
  try{const rows=await request(BASE+path+'?'+new URLSearchParams(query),{token,budget});if(!Array.isArray(rows)||rows.length>2000)throw Error('invalid');return {status:'ok',rows};}
  catch(e){return {status:safeStatus(e),rows:[]};}
 };
 const modalities=await call('licitacoes/modalidades');
 report.modalities={status:modalities.status,count:modalities.rows.length,fields:fieldNames(modalities.rows[0])};
 const purchases=[],contractRows=[];
 const summarizeList=r=>({status:r.status,count:r.rows.length,fields:fieldNames(r.rows[0]),
  purchaseFields:fieldNames(r.rows[0]?.licitacao),unitFields:fieldNames(r.rows[0]?.unidadeGestora)});
 for(const process of selectProcesses(notices,contracts)){
  const r=await call('licitacoes/por-processo',{processo:process.replace(/\D/g,'')});
  report.processLookups.push(summarizeList(r));
  // A consulta por processo e somente um caminho de descoberta; nao equivale a vinculo PNCP.
  purchases.push(...r.rows);
 }
 // Pequenas janelas fechadas recentes, inclusive exercicio anterior, sem extrapolar o recorte.
 const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
 date.setUTCMonth(date.getUTCMonth()-1);
 const dates=year=>{
  const month=date.getUTCMonth()+1,mm=String(month).padStart(2,'0'),last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return {dataInicial:'01/'+mm+'/'+year,dataFinal:String(last)+'/'+mm+'/'+year,codigoOrgao:'26422',pagina:'1'};
 };
 report.monthlySamples=[];
 for(const year of [date.getUTCFullYear(),date.getUTCFullYear()-1].filter(y=>y>=2024)){
  const q=dates(year),r=await call('licitacoes',q),c=await call('contratos',q);
  report.monthlySamples.push({year,purchase:summarizeList(r),contract:{status:c.status,count:c.rows.length,fields:fieldNames(c.rows[0]),unitFields:fieldNames(c.rows[0]?.unidadeGestora)}});
  purchases.push(...r.rows);contractRows.push(...c.rows);
 }
 const keys=new Map();
 for(const row of purchases){const key=procurementKey(row,modalities.rows);if(key)keys.set(JSON.stringify(key),key);}
 report.purchaseKeys={rows:purchases.length,usable:keys.size};
 for(const key of [...keys.values()].slice(0,3)){
  const r=await call('licitacoes/empenhos',{...key,pagina:'1'});
  report.purchaseLookups.push({status:r.status,fields:fieldNames(r.rows[0]),...identityCounts(r.rows,known,'empenho')});
  const c=await call('licitacoes/contratos-relacionados-licitacao',key);
  report.purchaseLookups.at(-1).contracts={status:c.status,count:c.rows.length,fields:fieldNames(c.rows[0])};
  contractRows.push(...c.rows);
 }
 const ids=new Set();
 for(const c of contractRows){
  const ug=digits(c?.unidadeGestora?.codigo??c?.unidadeGestora?.codigoUg??c?.unidadeGestora?.codigoUG,/^\d{6}$/);
  const buying=digits(c?.unidadeGestoraCompras?.codigo??c?.unidadeGestoraCompras?.codigoUg??c?.unidadeGestoraCompras?.codigoUG,/^\d{6}$/);
  const id=digits(c?.id,/^[1-9]\d{0,12}$/);
  const year=[c?.dataAssinatura,c?.dataPublicacaoDOU,c?.dataInicioVigencia].filter(v=>typeof v==='string').map(v=>/^(20\d{2})-/.exec(v)?.[1]||/\/(20\d{2})$/.exec(v)?.[1]).filter(Boolean);
  if(id&&(UG.has(ug)||UG.has(buying))&&year.some(v=>Number(v)>=2024))ids.add(id);
 }
 report.contractKeys={rows:contractRows.length,usable:ids.size};
 for(const id of [...ids].slice(0,3)){
  const r=await call('contratos/documentos-relacionados',{id});
  report.contractLookups.push({status:r.status,fields:fieldNames(r.rows[0]),...identityCounts(r.rows,known,'empenho')});
 }
 report.telemetry=budget.snapshot();
 return report;
}
async function main(){
 const {months}=await validatePublishedData(process.cwd());
 const notices=await readNotices(process.cwd()),contracts=await readProcurement(process.cwd());
 const result=await probeCguProcurement({token:process.env.CGU_API_KEY,notices:notices?.notices||[],contracts:contracts?.contracts||[],months});
 console.log('Sondagem CGU licitacoes e contratos: '+JSON.stringify(result));
 console.log('Somente contagens e nomes de campos; nenhum identificador individual, payload, valor, nome, CPF ou token. Sem persistencia de vinculos.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error('Sondagem CGU de contratacoes indisponivel');process.exitCode=1;});
