/** Sondagem de correspondencias candidatas, sem persistir nem confirmar PI.
 * Todos os criterios sao comparacoes com o acervo local; nao provam unicidade
 * da NE no IFC ou no SIAFI. Credor pessoa fisica nao e usado.
 */
import {inScopeNe} from './collection-scope.mjs';
import {parseMoneyCents} from './cgu.mjs';
const SHORT=/^20\d{2}NE\d{6}$/;
const CNPJ=/^\d{14}$/;
const PROC=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/;
export function indexLocalCommitments(documents){
 const byShort=new Map();
 for(const d of documents||[]){
  if(d?.phase!==1||!inScopeNe(d.id))continue;
  const key=d.id.slice(-12),list=byShort.get(key)||[];
  if(!list.some(v=>v.id===d.id))list.push(d);
  byShort.set(key,list);
 }
 return byShort;
}
export const emptyShortAudit=()=>({shortRows:0,shortWithPi:0,numberMatch:0,uniqueNumber:0,
 numberAndCreditor:0,numberCreditorDate:0,numberCreditorProcess:0,
 numberCreditorDateProcess:0,allIncludingValue:0,uniqueAllIncludingValue:0});
export function auditShortCommitments(rows,contract,byShort){
 const result=emptyShortAudit();
 if(!(byShort instanceof Map))throw Error('Indice local invalido');
 for(const row of rows){
  const short=typeof row?.numeroEmpenho==='string'?row.numeroEmpenho.trim().toUpperCase():'';
  if(!SHORT.test(short)||Number(short.slice(0,4))<2024)continue;
  result.shortRows++;
  if(typeof row.numeroPlanoInterno==='string'&&row.numeroPlanoInterno.trim())result.shortWithPi++;
  const matches=byShort.get(short)||[];
  if(!matches.length)continue;
  result.numberMatch++;if(matches.length===1)result.uniqueNumber++;
  const cnpj=typeof row.niCredorFornecedor==='string'?row.niCredorFornecedor.replace(/[./-]/g,''):'';
  if(row.tipoPessoa!=='PJ'||!CNPJ.test(cnpj))continue;
  const creditor=matches.filter(d=>d.partyRef===cnpj);
  if(!creditor.length)continue;
  result.numberAndCreditor++;
  const date=typeof row.dataEmissaoEmpenho==='string'?row.dataEmissaoEmpenho.slice(0,10):'';
  const process=typeof contract?.process==='string'&&PROC.test(contract.process)?contract.process:null;
  // Coincidencia de data da listagem apenas; nao comprova emissao.
  const dated=creditor.filter(d=>date&&d.date===date);
  const processed=creditor.filter(d=>process&&d.process===process);
  if(dated.length)result.numberCreditorDate++;
  if(processed.length)result.numberCreditorProcess++;
  const strong=dated.filter(d=>process&&d.process===process);
  if(strong.length)result.numberCreditorDateProcess++;
  const cents=typeof row.valorTotal==='number'?parseMoneyCents(row.valorTotal):null;
  const complete=strong.filter(d=>cents!==null&&d.cents===cents);
  if(complete.length)result.allIncludingValue++;
  if(complete.length===1)result.uniqueAllIncludingValue++;
 }
 return result;
}
export function addShortAudit(total,delta){
 for(const k of Object.keys(total))total[k]+=delta[k]||0;
 return total;
}
