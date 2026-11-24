import {planCatalogMonth} from './collection-scope.mjs';
/** Backfill mensal de todas modalidades do PNCP publicadas pela Reitoria. */
import {fileURLToPath} from 'node:url';
import {monthBounds,HttpFailure} from './procurement.mjs';
import {MODALITIES} from '../assets/pncp-modalities.js';
import {scanNotices} from './pncp-notices.mjs';
import {writeNotices,readNotices} from './pncp-notices-store.mjs';

function month(){
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit'}).format(new Date());
  return process.env.PNCP_NOTICE_MONTH||local;
}
async function main(){
  const previous=await readNotices(process.cwd());
  const historical=!process.env.PNCP_NOTICE_MONTH&&process.env.PNCP_NOTICE_HISTORICAL==='true';
  const plan=historical?planCatalogMonth(previous?.coverage,{keys:Object.keys(MODALITIES).map(Number),kind:'modality'}):null;
  if(historical&&!plan){console.log('Cobertura historica de contratacoes completa no recorte.');return}
  const selected=plan?.month||month();
  monthBounds(selected);
  if(process.argv.includes('--dry-run')){
    console.log('Planejamento PNCP '+selected+': '+Object.keys(MODALITIES).length+
      ' modalidades; '+(previous?.notices.length||0)+
      ' contratações já normalizadas, nenhum acesso externo ou gravação.');
    return;
  }
  const scans=[];let failed=0,total=0;
  for(const raw of Object.keys(MODALITIES)){
    const modality=Number(raw);
    if(plan&&!plan.pending.includes(modality))continue;
    try{
      const result=await scanNotices(selected,modality,{maxPages:20});
      const status=result.skipped?'partial':'complete';
      scans.push({month:selected,modality,status,
        records:result.records,skipped:result.skipped});
      total+=result.records.length;
      console.log('Modalidade '+modality+': '+result.records.length+
        ' publicação(ões) válida(s); '+result.skipped+
        ' rejeitada(s); '+status);
    }catch(error){
      failed++;
      scans.push({month:selected,modality,status:'unavailable',
        httpStatus:error instanceof HttpFailure?error.status:0});
      console.warn('Modalidade '+modality+
        ': não foi possível concluir; resultados anteriores serão preservados.');
    }
  }
  const outcome=await writeNotices(process.cwd(),scans);
  console.log('PNCP contratações por modalidade: '+total+
    ' registros obtidos, '+failed+' consulta(s) indisponível(is), '+
    outcome.data.notices.length+' registros no catálogo histórico; '+
    (outcome.changed?'JSON alterado':'JSON inalterado')+
    '. Nenhum dado pessoal bruto armazenado.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{console.error('Coleta PNCP de contratações interrompida; dados preservados.');
    process.exitCode=1});
}
