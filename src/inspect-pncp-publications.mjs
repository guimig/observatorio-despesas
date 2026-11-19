/** Diagnóstico estrutural seguro do PNCP: contratações de todas as modalidades. */
import {fileURLToPath} from 'node:url';
import {structuralFields} from './inspect-cgu.mjs';
import {requestPublicJSON,HttpFailure,REITORIA_CNPJ} from './procurement.mjs';

import {MODALITIES} from '../assets/pncp-modalities.js';
export {MODALITIES};
export function publicationUrl(modality,start='20261101',end='20261118',page=1){
  if(!Object.hasOwn(MODALITIES,modality)||
     !/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)||
     !Number.isSafeInteger(page)||page<1)
    throw Error('Filtro PNCP inválido');
  return 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?'+new URLSearchParams({
    dataInicial:start,dataFinal:end,codigoModalidadeContratacao:String(modality),
    cnpj:REITORIA_CNPJ,pagina:String(page),tamanhoPagina:'30'
  });
}
export function summarizeStructure(body){
  const arr=Array.isArray(body?.data)?body.data:Array.isArray(body?.dados)?body.dados:[];
  return {
    count:arr.length,
    totalPages:Number.isSafeInteger(Number(body?.totalPaginas))?Number(body.totalPaginas):null,
    root:Object.keys(body||{}).filter(key=>/^[A-Za-z_]+$/.test(key)).sort(),
    fields:arr.length?structuralFields(arr[0],1).filter(key=>!key.toLowerCase().includes('cpf')):[]
  };
}
async function main(){
  for(const modality of [4,6,8,9]){
    try{
      const result=await requestPublicJSON(publicationUrl(modality));
      const meta=summarizeStructure(result);
      console.log('Modalidade '+modality+' ('+MODALITIES[modality]+'): '+JSON.stringify(meta));
    }catch(error){
      console.log('Modalidade '+modality+': indisponível HTTP '+
        (error instanceof HttpFailure?error.status:'desconhecido'));
    }
  }
  console.log('Inventário concluído sem valores, fornecedores, CPF ou números individuais de processos.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{
    console.error('Inventário de modalidades não concluído (sem valores publicados).');
    process.exitCode=1;
  });
}
