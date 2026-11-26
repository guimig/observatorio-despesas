/** Sondagem anual Contratos.gov.br, sem token, sem persistir dados nem IDs.
 * Compara somente identidades SIAFI integrais declaradas no retorno.
 * Alias de schema sao candidatos estruturais, nunca campos homologados.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {FIRST_YEAR,brazilMonth,inScopeNe} from './collection-scope.mjs';
import {validatePublishedData} from './store.mjs';
import {readProcurement} from './procurement-store.mjs';
const HOST='https://contratos.comprasnet.gov.br',MAX_BYTES=4*1024*1024,MAX_ROWS=10000;
const ALIASES=Object.freeze({
 ne:['numeroEmpenho','numero_empenho','empenho','numero','codigoEmpenho','codigo_empenho','ne'],
 pi:['numeroPlanoInterno','numero_plano_interno','planoInterno','plano_interno','pi'],
 nd:['codigoNaturezaDespesa','codigo_natureza_despesa','natureza_despesa','naturezaDespesa','nd'],
 source:['fonte','fonte_recurso','fonte_recursos','fonteRecursos','codigoFonteRecurso'],
 ptres:['ptres','codigo_ptres','codigoPtres'],ugr:['ugr','codigo_ugr','codigoUgr'],
 ug:['ug','codigoUg','codigo_ug','unidade_gestora','unidadeGestora','codigo_unidade_emitente'],
 management:['gestao','codigo_gestao','codigoGestao'],
 committed:['valor','valor_empenhado','valorEmpenhado','valorTotal','valor_total'],
 liquidated:['valor_liquidado','valorLiquidado'],paid:['valor_pago','valorPago'],
 rp:['rp','restos_a_pagar','valorRestoInscrito','valor_rp','saldo_rp'],
 date:['data_emissao','dataEmissao','dataEmissaoEmpenho'],
 contract:['contrato_id','contratoId','contrato','contratos']
});
const normalized=v=>typeof v==='string'?v.toUpperCase().replace(/\s/g,''):'';
function available(value){return value!==null&&value!==undefined&&value!==''&&
 !(Array.isArray(value)&&value.length===0);}
function countValues(row,keys){
 return keys.some(k=>Object.hasOwn(row,k)&&available(row[k]));
}
function fullNe(row,year){
 const found=[...new Set(ALIASES.ne.map(k=>normalized(row[k])).filter(x=>inScopeNe(x)&&Number(x.slice(11,15))===year))];
 return found.length===1?found[0]:null;
}
function knownFormal(catalog){
 return new Set((catalog?.contracts||[]).filter(c=>c.source==='pncp'&&c.commitmentStatus==='complete')
  .flatMap(c=>c.commitmentRefs||[]).filter(inScopeNe));
}
export function annualUrl(year,now=new Date()){
 const current=Number(brazilMonth(now).slice(0,4));
 if(!Number.isInteger(year)||year<FIRST_YEAR||year>current)throw Error('Exercicio fora do recorte');
 return HOST+'/api/v1/empenho/ano/'+year+'/ug/158459';
}
export function compareSample(payload,{year,documents=[],catalog=null}={}){
 const rows=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:
  Array.isArray(payload?.dados)?payload.dados:null;
 if(!rows||rows.length>MAX_ROWS||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))
  return {status:'invalid_or_oversized_shape'};
 // A rota anual nao documenta necessariamente uma garantia de cobertura completa.
 const status=Array.isArray(payload)?'array_received_completeness_unverified':
  Number(payload.totalPaginas??payload.last_page)>1?'sample_incomplete':'wrapper_received_completeness_unverified';
 const fields=Object.fromEntries(Object.keys(ALIASES).map(k=>[k,0]));
 const candidates=Object.fromEntries(Object.keys(ALIASES).map(k=>[k,[]]));
 const local=new Set(documents.filter(d=>d.phase===1&&inScopeNe(d.id)&&Number(d.id.slice(11,15))===year).map(d=>d.id));
 const linked=knownFormal(catalog);
 const matched=new Set(),ids=new Set(),withPi=new Set();let shortOnly=0,fullRows=0;
 for(const row of rows){
  for(const [k,keys] of Object.entries(ALIASES)){
   if(countValues(row,keys))fields[k]++;
   for(const name of keys)if(Object.hasOwn(row,name)&&!candidates[k].includes(name))candidates[k].push(name);
  }
  const id=fullNe(row,year);
  if(!id){if(ALIASES.ne.some(k=>/^20\d{2}NE\d{6}$/.test(normalized(row[k]))))shortOnly++;continue;}
  fullRows++;ids.add(id);
  if(local.has(id)){matched.add(id);if(countValues(row,ALIASES.pi))withPi.add(id);}
 }
 return {status,rows:rows.length,fields,candidates,localNe:local.size,fullRows,
  distinctFullNe:ids.size,shortOnly,matchedLocal:matched.size,matchedWithPi:withPi.size,
  matchedWithKnownPncpLink:[...matched].filter(id=>linked.has(id)).length,
  matchedWithoutKnownPncpLink:[...matched].filter(id=>!linked.has(id)).length};
}
export async function probeAnnual(year,{now=new Date(),fetchFn=fetch,documents=[],catalog=null}={}){
 const url=annualUrl(year,now);let response;
 try{response=await fetchFn(url,{headers:{Accept:'application/json'},redirect:'error',
  signal:AbortSignal.timeout(20000)});}
 catch{return {year,status:'network_unavailable'};}
 if(!response.ok){await response.body?.cancel().catch(()=>{});return {year,status:'http_'+response.status};}
 const reader=response.body?.getReader();if(!reader)return {year,status:'invalid_body'};
 let size=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>MAX_BYTES){await reader.cancel();return {year,status:'oversized_body'};}
   chunks.push(value);}
  return {year,...compareSample(JSON.parse(Buffer.concat(chunks).toString('utf8')),{year,documents,catalog})};
 }catch{return {year,status:'invalid_json_or_body'};}finally{reader.releaseLock();}
}
async function main(){
 const {months}=await validatePublishedData(process.cwd());
 const documents=months.flatMap(m=>m.documents),catalog=await readProcurement(process.cwd());
 const now=new Date(),current=Number(brazilMonth(now).slice(0,4));
 for(let year=FIRST_YEAR;year<=current;year++){
  const result=await probeAnnual(year,{now,documents,catalog});
  console.log('Contratos.gov empenhos por UG: '+JSON.stringify(result));
 }
 console.log('Ausencia de vinculo PNCP conhecido nao comprova ausencia de contrato. Nenhum ID, PI, valor ou corpo foi salvo.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Sondagem Contratos.gov inconclusiva');process.exitCode=1;});
