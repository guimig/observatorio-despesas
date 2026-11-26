/** Recuperação incremental das NEs oficiais vinculadas a contratos PNCP. */
import {stateKey,effectiveDay,readOperationalState,saveOperationalState} from './operational-state.mjs';
import {fileURLToPath} from 'node:url';
import {validatePublishedData} from './store.mjs';
import {readProcurement,writeCommitmentResult} from './procurement-store.mjs';
import {fetchLinkedCommitments} from './pncp-commitments.mjs';
import {assessContractAttribution} from '../assets/procurement-links.js';

function integer(value,fallback,max){
  const n=Number(value??fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Lote de NE inválido');
  return n;
}
export function planCommitmentChecks(catalog,{
  count=8,now=new Date(),recheck=false,state={},refreshDetails=false,refreshContext=false
}={}){
  const limit=integer(count,8,25);
  const due=(contract)=>{
    if(recheck)return true;
    if(!contract.commitmentStatus)return true;
    if(refreshDetails&&contract.commitmentStatus==='complete'&&!contract.commitmentAudit){
      const retry=state[stateKey(contract)];
      return !retry||now.getTime()-Date.parse(retry+'T00:00:00Z')>=7*86400000;
    }
    if(refreshContext&&contract.commitmentStatus==='complete'&&contract.commitmentContext===undefined){
      const retry=state[stateKey(contract)];
      return !retry||now.getTime()-Date.parse(retry+'T00:00:00Z')>=7*86400000;
    }
    // Resultados positivos tambem precisam de revisao periodica.
    const last=effectiveDay(contract.commitmentAt,state[stateKey(contract)],now);
    if(!last)return true;
    const time=new Date(last+'T00:00:00Z').valueOf();
    const interval=contract.commitmentStatus==='complete'&&!(refreshContext&&contract.commitmentAudit?.formats?.shortOnly>0&&!contract.commitmentContext?.length)?30:7;
    return !Number.isFinite(time) || now.getTime()-time>=interval*86400000;
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
      const retryRank=c=>refreshDetails&&!c.commitmentAudit&&c.commitmentStatus==='complete'?0:
        c.commitmentStatus==='complete'?2:
        c.commitmentStatus==='unavailable'?1:0;
      return score(a)-score(b)||retryRank(a)-retryRank(b)||
        b.publishedMonth.localeCompare(a.publishedMonth)||
        a.id.localeCompare(b.id);
    })
    ;
  const isPending=c=>c.commitmentStatus!=='complete'||(refreshDetails&&!c.commitmentAudit)||(refreshContext&&c.commitmentContext===undefined);
  const pending=eligible.filter(isPending);
  const review=eligible.filter(c=>!isPending(c));
  const slot=Math.floor(now.getTime()/86400000);
  const rotate=list=>list.length?list.slice(slot%list.length).concat(list.slice(0,slot%list.length)):[];
  const quota=review.length&&limit>1?Math.max(1,Math.floor(limit/3)):0;
  const selected=pending.slice(0,limit-quota);
  selected.push(...rotate(review).slice(0,limit-selected.length));
  selected.push(...pending.slice(selected.filter(isPending).length,selected.filter(isPending).length+limit-selected.length));
  return selected.map(c=>({id:c.id,pncpId:c.pncpId}));
}
async function main(){
  const catalog=await readProcurement(process.cwd());
  if(!catalog?.contracts?.length){
    console.log('Sem contratos PNCP a enriquecer');
    return;
  }
  const statePath=process.env.PNCP_NE_STATE_PATH;
  const state=await readOperationalState(statePath);
  const batch=planCommitmentChecks(catalog,{
    state,refreshDetails:true,refreshContext:true,
    count:process.env.PNCP_COMMITMENT_BATCH||8,
    recheck:process.env.PNCP_COMMITMENT_RECHECK==='true'
  });
  console.log('Plano de recuperação: '+batch.length+' contrato(s) PNCP elegíveis.');
  if(process.argv.includes('--dry-run'))return;
  const {months}=await validatePublishedData(process.cwd());
  const documents=months.flatMap(m=>m.documents);
  let completed=0,unavailable=0,matched=0,rows=0,full=0,short=0,pi=0,fullPi=0,context=0;
  for(const entry of batch){
    const record=catalog.contracts.find(c=>c.id===entry.id);
    try{
      const result=await fetchLinkedCommitments(record,{includeDetails:true,documents});
      const outcome=await writeCommitmentResult(process.cwd(),entry.id,{
        status:'complete',refs:result.refs,audit:result.audit,details:result.details,context:result.context
      });
      const current=outcome.data.contracts.find(c=>c.id===entry.id);
      delete state[stateKey(record)];
      state[stateKey(current)]=new Date().toISOString().slice(0,10);
      completed++;
      matched+=result.refs.length;
      rows+=result.audit.rows;full+=result.audit.formats.fullCampus;
      short+=result.audit.formats.shortOnly+result.audit.formats.campusShort;
      pi+=result.audit.fields.pi;fullPi+=result.audit.fullWithPi;context+=result.context.length;
    }catch{
      unavailable++;
      // Resposta inacessível não é equivalente à ausência de empenhos.
      await writeCommitmentResult(process.cwd(),entry.id,{status:'unavailable'});
      if(record.commitmentStatus==='complete'&&(!record.commitmentAudit||record.commitmentContext===undefined))
        state[stateKey(record)]=new Date().toISOString().slice(0,10);
    }
  }
  await saveOperationalState(statePath,state);
  console.log('Auditoria PNCP de empenhos: '+JSON.stringify({completed,unavailable,rows,full,short,pi,fullPi,context}));
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
