/** Semantica e procedencia de quantidades de registro de precos. */
export const ARP_QUANTITY_TYPES=Object.freeze({
 tendered:'Quantidade licitada — IFC',
 registered:'Quantidade registrada — IFC',
 adhesion_balance:'Saldo para adesoes — IFC',
 available:'Saldo contratavel — IFC',
 campus_reserved:'Quantidade reservada — Araquari'
});
export function normalizeArpQuantity({type,value,source,observedAt}={}){
 if(!Object.hasOwn(ARP_QUANTITY_TYPES,type))throw Error('Tipo de quantitativo desconhecido');
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Quantidade invalida');
 if(!source||typeof source!=='string'||!/^https:\/\//.test(source))
  throw Error('Fonte verificavel obrigatoria');
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(observedAt||''))throw Error('Data de observacao obrigatoria');
 // Saldo para adesoes nao representa saldo contratavel da gerenciadora.
 return Object.freeze({type,value,source,observedAt,scope:
  type==='campus_reserved'?'campus':'institutional'});
}
export function summarizeArpQuantity(records){
 const result={};
 for(const row of records){
  const normalized=normalizeArpQuantity(row);
  if(result[normalized.type])throw Error('Duplicidade de tipo; exigir item e fonte unicos');
  result[normalized.type]=normalized;
 }
 return result;
}
