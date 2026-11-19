/** Correlação conservadora, reutilizada pelo coletor e pelo navegador. */
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const PROCESS=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/;
export function matchDocumentContract(document,contract){
  if(!document||!contract)return null;
  const id=String(document.id??'');
  if(document.phase===1 && NE.test(id) && contract.scope==='campus'){
    const number=String(contract.number??'').replace(/\s/g,'').toUpperCase();
    if(number===id||number===id.slice(-12)){
      return {level:'confirmed',reason:'Identificador de NE coincidente em instrumento da unidade'};
    }
  }
  if(typeof document.partyRef==='string'&&document.partyRef.length===14 &&
     document.partyRef===contract.supplierCnpj &&
     typeof document.process==='string'&&PROCESS.test(document.process) &&
     document.process===contract.process){
    return {level:'context',reason:'Mesmo processo administrativo e CNPJ do fornecedor'};
  }
  return null;
}
