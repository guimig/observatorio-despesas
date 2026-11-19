/** Backfill seletivo da contratação já referenciada em contrato PNCP do IFC. */
import {fileURLToPath} from 'node:url';
import {readProcurement} from './procurement-store.mjs';
import {HttpFailure} from './procurement.mjs';
import {readNotices,writeDirectNotice} from './pncp-notices-store.mjs';
import {planMissingNotices,fetchNoticeDetail} from './pncp-notices-detail.mjs';

async function main(){
  const [contracts,notices]=await Promise.all([
    readProcurement(process.cwd()),readNotices(process.cwd())
  ]);
  if(!contracts?.contracts.length){
    console.log('Nenhum contrato disponível para buscar contratação originária.');
    return;
  }
  const selected=planMissingNotices(contracts,notices,{
    count:process.env.PNCP_NOTICES_DETAIL_BATCH||18
  });
  console.log('Recuperação histórica por ID PNCP: '+selected.length+
    ' contratação(ões) ausentes do catálogo de editais.');
  if(process.argv.includes('--dry-run')){
    console.log('Simulação sem acesso externo ou gravação.');
    return;
  }
  let recovered=0,unavailable=0;
  const failures={};
  const byYear={};
  for(const id of selected){
    try{
      const result=await fetchNoticeDetail(id);
      await writeDirectNotice(process.cwd(),result);
      recovered++;
      byYear[result.published.slice(0,4)]=(byYear[result.published.slice(0,4)]||0)+1;
    }catch(error){
      unavailable++;
      const kind=error instanceof HttpFailure ?
        'HTTP '+error.status : 'formato/validação';
      failures[kind]=(failures[kind]||0)+1;
      // Não há garantia de que contratação não exista em outro sistema/escopo.
    }
  }
  console.log('PNCP recuperação direta: '+recovered+' publicação(ões) validada(s); '+
    unavailable+' consulta(s) indisponível(is); por exercício de publicação '+
    JSON.stringify(byYear)+'; falhas por tipo '+JSON.stringify(failures)+
    '. Nenhum CPF, fornecedor ou resposta bruta armazenado.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(()=>{console.error('Recuperação PNCP interrompida; catálogos anteriores preservados.');
   process.exitCode=1});
}
