/** Metadados de empenhos publicados no PNCP, nao saldos nem atos SIAFI.
 * Apenas identidade integral da UG 158459 desde 2024 permite guardar atributos.
 * Numero curto, UG publicadora e processo nunca provam identidade financeira.
 */
import {extractAraquariNeEvidence} from '../assets/procurement-links.js';
import {inScopeNe} from './collection-scope.mjs';
import {containsRawCpf} from './privacy.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
import {parseMoneyCents} from './cgu.mjs';
const FIELDS=['pi','nature','amendment','issueDate','status','statusDate','totalCents','subitemCents','updated','included'];
const FORMATS=['fullCampus','campusShort','shortOnly','otherUg','outOfScope','unknown'];
const MAX_ROWS=1500;
const CODE=/^[A-Za-z0-9][A-Za-z0-9._/ -]{0,49}$/;
const ND=/^\d{6,10}$/;
const dateRe=/^20\d{2}-\d{2}-\d{2}$/;
function validDay(v){
 if(typeof v!=='string'||!dateRe.test(v))return false;
 const d=new Date(v+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function day(v){
 if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}(?:$|T|\s)/.test(v))return undefined;
 return validDay(v.slice(0,10))?v.slice(0,10):undefined;
}
function code(v,re=CODE){
 return typeof v==='string'&&re.test(v.trim())&&!containsRawCpf(v.trim())?v.trim():undefined;
}
function money(v){const cents=typeof v==='number'?parseMoneyCents(v):null;
 return Number.isSafeInteger(cents)&&cents>=0?cents:undefined;}
function isCount(v,max=MAX_ROWS){return Number.isSafeInteger(v)&&v>=0&&v<=max;}
function exactKeys(obj,keys){return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).every(k=>keys.includes(k));}
function metadata(row){
 return Object.fromEntries(Object.entries({
  pi:code(row.numeroPlanoInterno),nature:code(row.codigoNaturezaDespesa,ND),
  amendment:code(row.codigoEmenda),issueDate:day(row.dataEmissaoEmpenho),
  status:[1,2].includes(row.situacaoEmpenhoId)?row.situacaoEmpenhoId:undefined,
  statusDate:day(row.dataSituacaoEmpenho),totalCents:money(row.valorTotal),
  subitemCents:money(row.valorSubItem),updated:day(row.dataAtualizacao),included:day(row.dataInclusao)
 }).filter(([,v])=>v!==undefined));
}
function emenda(row,meta){
 const raw=row.emendaParlamentar;
 if(!meta.amendment||!raw||code(raw.codigoEmenda)!==meta.amendment)return undefined;
 const result={};
 if(Number.isSafeInteger(raw.ano)&&raw.ano>=2000&&raw.ano<=2099)result.year=raw.ano;
 for(const [k,v] of [['type',raw.tipoEmenda],['author',raw.nomeAutor||raw.autor]]){
  const text=publicNarrativeText(v,120);
  if(text&&!/[\r\n]/.test(text))result[k]=text;
 }
 return Object.keys(result).length?result:undefined;
}
function format(raw){
 const parsed=extractAraquariNeEvidence(raw);
 if(parsed?.kind==='full')return inScopeNe(parsed.ne)?'fullCampus':'outOfScope';
 if(parsed?.kind==='ug_short')return Number(parsed.short.slice(0,4))>=2024?'campusShort':'outOfScope';
 const n=typeof raw==='string'?raw.toUpperCase().replace(/\s/g,''):'';
 if(/^20\d{2}NE\d{6}$/.test(n))return 'shortOnly';
 if(/^\d{6}(?:\d{5})?[-/]?20\d{2}NE\d{6}$/.test(n))return 'otherUg';
 return 'unknown';
}
/** A chave do instrumento na propria linha, se presente, deve concordar com a rota. */
function assertInstrument(row,contract){
 if(!contract?.pncpId)return;
 const m=/^(\d{14})-2-(\d{6})\/(20\d{2})$/.exec(contract.pncpId);
 if(!m)throw Error('Identidade PNCP invalida');
 for(const [field,expected] of [['cnpj',m[1]],['ano',m[3]],['sequencialContrato',String(Number(m[2]))]]){
  if(row[field]!==undefined&&row[field]!==null&&String(row[field])!==expected)
   throw Error('Empenho PNCP de instrumento divergente');
 }
}
export function extractCommitmentMetadata(rows,contract){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw Error('Amostra PNCP invalida');
 const audit={rows:rows.length,formats:Object.fromEntries(FORMATS.map(k=>[k,0])),
  fields:Object.fromEntries(FIELDS.map(k=>[k,0])),fullWithPi:0};
 const details=new Map();
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Linha PNCP invalida');
  assertInstrument(row,contract);
  const type=format(row.numeroEmpenho),meta=metadata(row);
  audit.formats[type]++;
  for(const key of Object.keys(meta))audit.fields[key]++;
  if(type!=='fullCampus')continue;
  if(meta.pi)audit.fullWithPi++;
  if(!Number.isSafeInteger(row.sequencialEmpenho)||row.sequencialEmpenho<1)continue;
  const id=extractAraquariNeEvidence(row.numeroEmpenho).ne;
  const amendmentInfo=emenda(row,meta);
  const detail={id,seq:row.sequencialEmpenho,...meta,...(amendmentInfo?{amendmentInfo}:{})};
  const key=detail.seq;
  if(details.has(key)&&JSON.stringify(details.get(key))!==JSON.stringify(detail))
   throw Error('Sequencial de empenho PNCP conflitante');
  details.set(key,detail);
 }
 return {audit,details:[...details.values()].sort((a,b)=>a.seq-b.seq)};
}
export function validateCommitmentMetadata(audit,details,refs){
 if(!exactKeys(audit,['rows','formats','fields','fullWithPi'])||!isCount(audit.rows)||
  !exactKeys(audit.formats,FORMATS)||!FORMATS.every(k=>isCount(audit.formats[k],audit.rows))||
  FORMATS.reduce((sum,k)=>sum+audit.formats[k],0)!==audit.rows||
  !exactKeys(audit.fields,FIELDS)||!FIELDS.every(k=>isCount(audit.fields[k],audit.rows))||
  !isCount(audit.fullWithPi,Math.min(audit.formats.fullCampus,audit.fields.pi))||
  !Array.isArray(details)||details.length>audit.formats.fullCampus||details.length>MAX_ROWS||
  !Array.isArray(refs)||new Set(details.map(d=>d?.seq)).size!==details.length)
  throw Error('Auditoria PNCP de empenhos invalida');
 for(const d of details){
  if(!exactKeys(d,['id','seq',...FIELDS,'amendmentInfo'])||!inScopeNe(d.id)||!refs.includes(d.id)||
   !Number.isSafeInteger(d.seq)||d.seq<1||
   (d.pi!==undefined&&code(d.pi)!==d.pi)||(d.nature!==undefined&&code(d.nature,ND)!==d.nature)||
   (d.amendment!==undefined&&code(d.amendment)!==d.amendment)||
   ['issueDate','statusDate','updated','included'].some(k=>d[k]!==undefined&&!validDay(d[k]))||
   (d.status!==undefined&&![1,2].includes(d.status))||
   ['totalCents','subitemCents'].some(k=>d[k]!==undefined&&(!Number.isSafeInteger(d[k])||d[k]<0)))
   throw Error('Metadados de empenho PNCP invalidos');
  const info=d.amendmentInfo;
  if(info!==undefined&&(!d.amendment||!exactKeys(info,['year','type','author'])||
    !Object.keys(info).length||(info.year!==undefined&&
    (!Number.isSafeInteger(info.year)||info.year<2000||info.year>2099))||
    ['type','author'].some(k=>info[k]!==undefined&&
    (publicNarrativeText(info[k],120)!==info[k]||/[\r\n]/.test(info[k])))))
   throw Error('Metadados de emenda PNCP invalidos');
 }
 return true;
}

/** Indicio, nunca identidade SIAFI: NE curta + CNPJ PJ + processo + data + valor.
 * O CNPJ da linha, do instrumento e da NE local devem coincidir. Nao publicar
 * CPF, nome do credor, nem candidatos quando houver ambiguidade local.
 * Nao alimenta commitmentRefs nem altera a atribuicao oficial. */
export function extractContextualCommitments(rows,contract,documents){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS||!Array.isArray(documents))
  throw Error('Contexto PNCP invalido');
 const supplier=contract?.supplierCnpj,process=contract?.process;
 if(!/^\d{14}$/.test(supplier||'')||!/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/.test(process||''))return [];
 const byShort=new Map();
 for(const d of documents){
  if(d?.phase!==1||!inScopeNe(d.id))continue;
  const short=d.id.slice(-12);
  if(!byShort.has(short))byShort.set(short,[]);
  byShort.get(short).push(d);
 }
 const candidates=new Map();
 for(const row of rows){
  assertInstrument(row,contract);
  const raw=typeof row.numeroEmpenho==='string'?row.numeroEmpenho.toUpperCase().replace(/\s/g,''):'';
  const type=format(raw);
  if(!['shortOnly','campusShort'].includes(type))continue;
  const short=raw.slice(-12);
  if(Number(short.slice(0,4))<2024)continue;
  const matches=byShort.get(short)||[];
  if(matches.length!==1||row.tipoPessoa!=='PJ'||row.niCredorFornecedor!==supplier)continue;
  const d=matches[0], m=metadata(row);
  if(!m.pi||!m.issueDate||m.totalCents===undefined||m.totalCents<=0||
    d.partyRef!==supplier||d.process!==process||d.date!==m.issueDate||d.cents!==m.totalCents||
    !Number.isSafeInteger(row.sequencialEmpenho)||row.sequencialEmpenho<1)continue;
  const result={id:d.id,seq:row.sequencialEmpenho,pi:m.pi,issueDate:m.issueDate,totalCents:m.totalCents,
    ...(m.nature?{nature:m.nature}:{}),...(m.amendment?{amendment:m.amendment}:{})};
  if(candidates.has(result.seq)&&JSON.stringify(candidates.get(result.seq))!==JSON.stringify(result))
   throw Error('Indicio PNCP conflitante');
  candidates.set(result.seq,result);
 }
 return [...candidates.values()].sort((a,b)=>a.seq-b.seq);
}
export function validateContextualCommitments(rows,contract){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS||new Set(rows.map(x=>x?.seq)).size!==rows.length||
  (rows.length&&(!/^\d{14}$/.test(contract?.supplierCnpj||'')||
   !/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/.test(contract?.process||''))))
  throw Error('Indicios PNCP invalidos');
 for(const r of rows){
  if(!exactKeys(r,['id','seq','pi','issueDate','totalCents','nature','amendment'])||
   !inScopeNe(r.id)||!Number.isSafeInteger(r.seq)||r.seq<1||
   typeof r.pi!=='string'||code(r.pi)!==r.pi||
   !validDay(r.issueDate)||r.issueDate.slice(0,4)!==r.id.slice(11,15)||
   !Number.isSafeInteger(r.totalCents)||r.totalCents<=0||
   (r.nature!==undefined&&code(r.nature,ND)!==r.nature)||
   (r.amendment!==undefined&&code(r.amendment)!==r.amendment))
   throw Error('Indicio PNCP invalido');
 }
 return true;
}
