import {planCatalogMonth,brazilMonth,inScopeMonth,closedCatalogCoverage} from './collection-scope.mjs';
import {readCguContractEvidence} from './cgu-contract-evidence.mjs';
/** Coleta independente de PNCP e Compras.gov, sem chave ou documentos brutos. */
import {fileURLToPath} from 'node:url';
import {appendFile} from 'node:fs/promises';
import {CAMPUS_UG,monthBounds,scanPncp,scanCompras,HttpFailure} from './procurement.mjs';
import {writeProcurement,readProcurement} from './procurement-store.mjs';

function selectedMonth(){
  const now=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'
  }).format(new Date());
  return process.env.PROC_MONTH||now;
}
async function reportSourceStatus(scans){
  const status=scans.every(scan=>scan.status==='complete')?'complete':'partial';
  const summary={status,sources:scans.map(({source,month,status,httpStatus})=>({source,month,status,...(httpStatus!==undefined?{httpStatus}:{})}))};
  console.log('Estado efetivo das fontes contratuais: '+JSON.stringify(summary));
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'status='+status+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,JSON.stringify(summary)+'\n');
}
/** Uma rodada a cada quatro privilegia meses de assinatura CGU e seguintes ainda
 * sem cobertura PNCP. Assinatura nao e publicacao: trata-se de busca
 * exploratoria, nao de equivalencia ou cobertura de um contrato. */
export function planContractRecovery(coverage,cguContracts,{now=new Date(),slot=Math.floor(now.getTime()/28800000)}={}){
 const regular=planCatalogMonth(coverage,{keys:['pncp','compras'],kind:'source',now,slot});
 if(!regular||slot%4!==0)return regular;
 const current=brazilMonth(now),counts=new Map();
 for(const c of cguContracts||[]){
  const first=(c.signed||c.reference||'').slice(0,7);
  if(!inScopeMonth(first))continue;
  // Publicacao pode suceder assinatura: consultar tambem os dois meses seguintes,
  // priorizando primeiro a assinatura e preservando as rodadas gerais.
  for(let offset=0;offset<=2;offset++){
   const date=new Date(first+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);
   const month=date.toISOString().slice(0,7);
   if(month<current&&!closedCatalogCoverage((coverage||[]).find(x=>x.source==='pncp'&&x.month===month)))
    counts.set(month,(counts.get(month)||0)+3-offset);
  }
 }
 const months=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||a.localeCompare(b));
 if(!months.length)return regular;
 const month=months[Math.floor(slot/4)%Math.min(months.length,3)];
 return {month,missing:(coverage||[]).some(x=>x.source==='pncp'&&x.month===month)?[]:['pncp'],pending:['pncp'],reason:'cgu_signature_window'};
}
async function main(){
  const previous=await readProcurement(process.cwd());
  const historical=!process.env.PROC_MONTH&&process.env.PROC_HISTORICAL==='true';
  const plan=historical?planContractRecovery(previous?.coverage,(await readCguContractEvidence(process.cwd())).contracts):null;
  if(historical&&!plan){console.log('Cobertura historica contratual completa no recorte.');if(!process.argv.includes('--dry-run'))await reportSourceStatus([]);return}
  const month=plan?.month||selectedMonth();
  monthBounds(month);
  if(plan?.reason)console.log('Recuperacao historica dirigida por janela administrativa CGU: '+month+'; publicacao PNCP pode ocorrer em outra competencia.');
  if(process.argv.includes('--dry-run')){
    console.log('Plano de consulta pública: PNCP (CNPJ campus e Reitoria) + Compras.gov (UG '+
      CAMPUS_UG+'); competência '+month+'; '+(previous?.contracts?.length??0)+
      ' contrato(s) no acervo. Nenhuma API consultada ou arquivo modificado.');
    return;
  }
  const closedMonth=month<brazilMonth();
  const scans=[];
  for(const [source,action] of [['pncp',scanPncp],['compras',scanCompras]]){
    if(plan&&!plan.pending.includes(source))continue;
    try{
      const result=await action(month,{maxPages:15});
      const status=result.skipped?'partial':'complete';
      scans.push({source,month,status,records:result.records,skipped:result.skipped,...(status==='complete'&&closedMonth?{closedMonth:true}:{})});
      console.log('Fonte '+source+': '+result.records.length+' contrato(s) normalizados; '+
        result.skipped+' registro(s) fora do esquema; estado '+status+'.');
    }catch(error){
      // Falha externa não apaga um mês anteriormente coletado e validado.
      scans.push({source,month,status:'unavailable',records:[],
        httpStatus:error instanceof HttpFailure?error.status:0});
      console.warn('Fonte '+source+': indisponível ou resposta não conciliável; acervo preservado.');
    }
  }
  const outcome=await writeProcurement(process.cwd(),scans);
  await reportSourceStatus(scans);
  console.log('Catálogo contratual: '+outcome.data.contracts.length+
    ' registro(s) acumulado(s); arquivo '+(outcome.changed?'alterado':'inalterado')+
    '. Nenhum CPF integral ou resposta bruta publicado.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{console.error('Coleta contratual interrompida. Dados antigos preservados.');
    process.exitCode=1});
}
