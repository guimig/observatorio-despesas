/** Recuperação incremental das NEs oficiais vinculadas a contratos PNCP. */
import {fileURLToPath} from 'node:url';
import {readProcurement,writeCommitmentResult} from './procurement-store.mjs';
import {fetchLinkedCommitments} from './pncp-commitments.mjs';
import {assessContractAttribution} from '../assets/procurement-links.js';

function integer(value,fallback,max){
  const n=Number(value??fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Lote de NE inválido');
  return n;
}
export function planCommitmentChecks(catalog,{
  count=8,now=new Date(),recheck=false
}={}){
  const limit=integer(count,8,25);
  const due=(contract)=>{
    if(recheck)return true;
    if(!contract.commitmentStatus)return true;
    // Resultados positivos tambem precisam de revisao periodica.
    if(!contract.commitmentAt)return true;
    const time=new Date(contract.commitmentAt+'T00:00:00Z').valueOf();
    const interval=contract.commitmentStatus==='complete'?30:7;
    return Number.isFinite(time) && now.getTime()-time>=interval*86400000;
  };
  const eligible=(catalog?.contracts||[])
    .filter(c=>c.source==='pncp'&&due(c))
    .sort((a,b)=>{
      const score=c=>{
        const level=assessContractAttribution(c).level;
        return level==='ne_indication'?0:level==='process_indication'?1:
          level==='context'?2:3;
      };
      // Consultas ainda não realizadas precedem revalidações de vazios.
      const retryRank=c=>c.commitmentStatus==='complete'?2:
        c.commitmentStatus==='unavailable'?1:0;
      return score(a)-score(b)||retryRank(a)-retryRank(b)||
        b.publishedMonth.localeCompare(a.publishedMonth)||
        a.id.localeCompare(b.id);
    })
    ;
  const pending=eligible.filter(c=>c.commitmentStatus!=='complete');
  const review=eligible.filter(c=>c.commitmentStatus==='complete');
  const slot=Math.floor(now.getTime()/86400000);
  const rotate=list=>list.length?list.slice(slot%list.length).concat(list.slice(0,slot%list.length)):[];
  const quota=review.length&&limit>1?Math.max(1,Math.floor(limit/3)):0;
  const selected=pending.slice(0,limit-quota);
  selected.push(...rotate(review).slice(0,limit-selected.length));
  selected.push(...pending.slice(selected.filter(c=>c.commitmentStatus!=='complete').length,selected.filter(c=>c.commitmentStatus!=='complete').length+limit-selected.length));
  return selected.map(c=>({id:c.id,pncpId:c.pncpId}));
}
async function main(){
  const catalog=await readProcurement(process.cwd());
  if(!catalog?.contracts?.length){
    console.log('Sem contratos PNCP a enriquecer');
    return;
  }
  const batch=planCommitmentChecks(catalog,{
    count:process.env.PNCP_COMMITMENT_BATCH||8,
    recheck:process.env.PNCP_COMMITMENT_RECHECK==='true'
  });
  console.log('Plano de recuperação: '+batch.length+' contrato(s) PNCP elegíveis.');
  if(process.argv.includes('--dry-run'))return;
  let completed=0,unavailable=0,matched=0;
  for(const entry of batch){
    const record=catalog.contracts.find(c=>c.id===entry.id);
    try{
      const result=await fetchLinkedCommitments(record);
      await writeCommitmentResult(process.cwd(),entry.id,{
        status:'complete',refs:result.refs
      });
      completed++;
      matched+=result.refs.length;
    }catch{
      unavailable++;
      // Resposta inacessível não é equivalente à ausência de empenhos.
      await writeCommitmentResult(process.cwd(),entry.id,{status:'unavailable'});
    }
  }
  console.log('PNCP empenhos: '+completed+' instrumento(s) consultado(s) integralmente, '+
    unavailable+' indisponível(is), '+matched+' referência(s) explícitas à UG 158459. '+
    'Nenhum número de NE de outra unidade ou CPF foi registrado.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{
    console.error('Enriquecimento PNCP não concluído; dados anteriores preservados.');
    process.exitCode=1;
  });
}
