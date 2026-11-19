/** Inspeção restrita dos formatos reais: apenas nomes de campos e contagens, nunca valores. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCguArray } from './cgu.mjs';
import { structuralFields } from './inspect-cgu.mjs';

const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/despesas';
const DOC=/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
export function paymentImpactUrl(id,page=1){
  if(!DOC.test(id)||!Number.isSafeInteger(page)||page<1) throw Error('Identificador inválido');
  return BASE+'/empenhos-impactados?'+new URLSearchParams({
    codigoDocumento:id, fase:'3', pagina:String(page)
  });
}
export function itemsUrl(id,page=1){
  if(!/^158459\d{5}20\d{2}NE\d{6}$/.test(id)||!Number.isSafeInteger(page)||page<1)
    throw Error('Empenho inválido');
  return BASE+'/itens-de-empenho?'+new URLSearchParams({codigoDocumento:id,pagina:String(page)});
}
export function structuralSummary(records){
  if(!Array.isArray(records)) throw Error('Formato não é lista');
  const fields=records.length ? structuralFields(records[0],0).join(', ') : 'nenhum';
  const keys=['valorPago','valorRestoPago','valorLiquidado','valorAtual','empenho','descricao','sequencial'];
  const present=Object.fromEntries(keys.map(key=>[
    key, {present: records.filter(row=>row?.[key]!==undefined).length,
      filled: records.filter(row=>row?.[key]!==null&&row?.[key]!==undefined&&row?.[key]!=='').length}
  ]));
  return {records:records.length,fields,present};
}
async function main(){
  const token=process.env.CGU_API_KEY;
  if(!token)throw Error('Chave não disponível');
  const file=resolve('data/months/2026-11.json');
  const month=JSON.parse(await readFile(file,'utf8'));
  const payments=month.documents.filter(d=>d.phase===3).slice(0,3);
  const empenho=month.documents.find(d=>d.phase===1);
  if(!payments.length||!empenho)throw Error('Sem amostras documentais');
  for(let i=0;i<payments.length;i++){
    try{
      const items=await getCguArray(paymentImpactUrl(payments[i].id),{token});
      console.log('Pagamento amostra '+(i+1)+': '+JSON.stringify(structuralSummary(items)));
    }catch(error){
      console.log('Pagamento amostra '+(i+1)+': '+(String(error?.message).startsWith('CGU HTTP ')?error.message:'consulta indisponível'));
    }
  }
  try{
    const items=await getCguArray(itemsUrl(empenho.id),{token});
    console.log('Itens empenho amostra: '+JSON.stringify(structuralSummary(items)));
  }catch(error){
    console.log('Itens empenho amostra: '+(String(error?.message).startsWith('CGU HTTP ')?error.message:'consulta indisponível'));
  }
  console.log('Sondagem concluída: nenhuma resposta bruta, CPF, fornecedor, identificador documental ou descrição publicada.');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(()=>{console.error('Sondagem encerrada sem publicar dados.');process.exitCode=1;});
}
