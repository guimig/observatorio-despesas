/** Enriquecimento incremental PNCP por identificadores oficiais de contratação. */
import {fileURLToPath} from 'node:url';
import {readProcurement,writeContractPurchaseLink} from './procurement-store.mjs';
import {fetchContractPurchaseLink,planContractPurchaseLinks} from './pncp-contract-link.mjs';

async function main() {
  const catalog=await readProcurement(process.cwd());
  if(!catalog?.contracts.length) {
    console.log('Catálogo contratual vazio: nenhuma consulta.');
    return;
  }
  const plan=planContractPurchaseLinks(catalog,{
    count:process.env.PNCP_PURCHASE_BATCH||12,
    recheck:process.env.PNCP_PURCHASE_RECHECK==='true'
  });
  console.log('PNCP vínculos: '+plan.length+' detalhes de contratos elegíveis.');
  if(process.argv.includes('--dry-run')) {
    console.log('Simulação: nenhum acesso à API e nenhum JSON alterado.');
    return;
  }
  let linked=0,unreported=0,failed=0;
  for(const item of plan) {
    const contract=catalog.contracts.find(entry=>entry.id===item.id);
    try {
      const result=await fetchContractPurchaseLink(contract);
      await writeContractPurchaseLink(process.cwd(),item.id,result);
      if(result.status==='linked')linked++;
      else unreported++;
    }catch{
      failed++;
      await writeContractPurchaseLink(process.cwd(),item.id,{
        status:'unavailable'
      });
    }
  }
  console.log('Vínculos oficiais PNCP: '+linked+' contratos relacionados à contratação; '+
    unreported+' detalhe(s) sem referência; '+failed+
    ' consulta(s) indisponível(is). Não houve consulta a dados de pessoas.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  main().catch(()=>{
    console.error('Enriquecimento PNCP interrompido; dados anteriores preservados.');
    process.exitCode=1;
  });
}
