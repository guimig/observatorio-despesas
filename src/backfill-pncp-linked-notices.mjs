/** Backfill seletivo da contratação já referenciada em contrato PNCP do IFC. */
import {fileURLToPath} from 'node:url';
import {readProcurement} from './procurement-store.mjs';
import {HttpFailure} from './procurement.mjs';
import {readNotices,writeDirectNotice} from './pncp-notices-store.mjs';
import {planMissingNotices,fetchNoticeDetailWithRetry} from './pncp-notices-detail.mjs';
import {recoverLinkedInstruments} from './recover-pncp-linked-instruments.mjs';

async function main(){
  const total=Number(process.env.PNCP_NOTICES_DETAIL_BATCH||30),dryRun=process.argv.includes('--dry-run');
  if(!Number.isSafeInteger(total)||total<1||total>35)throw Error('Lote PNCP inválido');
  const reverse=await recoverLinkedInstruments({limit:Math.floor(total/4),dryRun});
  console.log('Instrumentos IFC referenciados por atas (somente contagens): '+JSON.stringify(reverse));
  const remaining=Math.max(1,total-(dryRun?reverse.planned:reverse.attempted));
  const [contracts,notices]=await Promise.all([
    readProcurement(process.cwd()),readNotices(process.cwd())
  ]);
  if(!contracts?.contracts.length){
    console.log('Nenhum contrato disponível para buscar contratação originária.');
    return;
  }
  const selected=planMissingNotices(contracts,notices,{
    count:remaining,slot:Math.floor(Date.now()/86400000)
  });
  console.log('Recuperação histórica por ID PNCP: '+selected.length+
    ' contratação(ões) ausentes do catálogo de editais.');
  if(dryRun){
    console.log('Simulação sem acesso externo ou gravação.');
    return;
  }
  if(Object.keys(reverse.failures||{}).some(k=>['http_401','http_403','http_429'].includes(k))){console.log('Consultas restantes adiadas por bloqueio da fonte.');return;}
  let recovered=0,unavailable=0;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const failures={};
  const byYear={};
  for(let i=0;i<selected.length;i++){
    const id=selected[i];
    // Limite conservador de ~10 chamadas/minuto; a própria API também aplica
    // backoff e, em 429 persistente, a consulta não é considerada ausente.
    if(i>0)await pause(5500);
    try{
      const result=await fetchNoticeDetailWithRetry(id);
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
