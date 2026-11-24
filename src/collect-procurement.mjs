import {planCatalogMonth} from './collection-scope.mjs';
/** Coleta independente de PNCP e Compras.gov, sem chave ou documentos brutos. */
import {fileURLToPath} from 'node:url';
import {CAMPUS_UG,monthBounds,scanPncp,scanCompras,HttpFailure} from './procurement.mjs';
import {writeProcurement,readProcurement} from './procurement-store.mjs';

function selectedMonth(){
  const now=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'
  }).format(new Date());
  return process.env.PROC_MONTH||now;
}
async function main(){
  const previous=await readProcurement(process.cwd());
  const historical=!process.env.PROC_MONTH&&process.env.PROC_HISTORICAL==='true';
  const plan=historical?planCatalogMonth(previous?.coverage,{keys:['pncp','compras'],kind:'source'}):null;
  if(historical&&!plan){console.log('Cobertura historica contratual completa no recorte.');return}
  const month=plan?.month||selectedMonth();
  monthBounds(month);
  if(process.argv.includes('--dry-run')){
    console.log('Plano de consulta pública: PNCP (CNPJ campus e Reitoria) + Compras.gov (UG '+
      CAMPUS_UG+'); competência '+month+'; '+(previous?.contracts?.length??0)+
      ' contrato(s) no acervo. Nenhuma API consultada ou arquivo modificado.');
    return;
  }
  const scans=[];
  for(const [source,action] of [['pncp',scanPncp],['compras',scanCompras]]){
    if(plan&&!plan.pending.includes(source))continue;
    try{
      const result=await action(month,{maxPages:15});
      const status=result.skipped?'partial':'complete';
      scans.push({source,month,status,records:result.records,skipped:result.skipped});
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
  console.log('Catálogo contratual: '+outcome.data.contracts.length+
    ' registro(s) acumulado(s); arquivo '+(outcome.changed?'alterado':'inalterado')+
    '. Nenhum CPF integral ou resposta bruta publicado.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{console.error('Coleta contratual interrompida. Dados antigos preservados.');
    process.exitCode=1});
}
