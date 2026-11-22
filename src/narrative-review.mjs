/** Planejamento e atualizacao incremental de campos narrativos ja publicados. */
import {publicNarrativeText} from './public-narrative.mjs';
import {validateNotices} from './pncp-notices-store.mjs';
import {validateProcurement} from './procurement-store.mjs';

const DAYS=86400000;
export function reviewDue(value,now=new Date(),interval=30){
  if(!value)return true;
  const stamp=new Date(value+'T00:00:00Z').getTime();
  return !Number.isFinite(stamp)||now.getTime()-stamp>=interval*DAYS;
}
export function planNarrativeReviews(catalog,{kind,now=new Date(),batch=5}={}){
  if(!['notice','contract'].includes(kind)||
     !Number.isSafeInteger(batch)||batch<1||batch>20)throw Error('Plano narrativo invalido');
  const records=kind==='notice'?catalog?.notices:catalog?.contracts;
  if(!Array.isArray(records))throw Error('Catalogo narrativo indisponivel');
  return records.filter(record=>!record.object&&
    (kind==='notice'||record.source==='pncp')&&
    reviewDue(record.objectCheckedAt,now)).sort((a,b)=>
      Number(Boolean(b.process?.startsWith('23349.')))-
      Number(Boolean(a.process?.startsWith('23349.')))||
      String(b.month||b.publishedMonth).localeCompare(String(a.month||a.publishedMonth))||
      a.id.localeCompare(b.id)).slice(0,batch).map(item=>({id:item.id,pncpId:item.pncpId}));
}

export function applyNarrativeReview(catalog,id,raw,{kind,now=new Date()}={}){
  if(!['notice','contract'].includes(kind)||!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw Error('Revisao narrativa invalida');
  const validate=kind==='notice'?validateNotices:validateProcurement;
  const original=validate(structuredClone(catalog));
  const next=structuredClone(original);
  const records=kind==='notice'?next.notices:next.contracts;
  const target=records.find(item=>item.id===id&&(kind==='notice'||item.source==='pncp'));
  if(!target)throw Error('Registro oficial nao localizado');
  const text=publicNarrativeText(raw);
  if(text)target.object=text;
  target.objectCheckedAt=now.toISOString().slice(0,10);
  validate(next);
  const previous=JSON.stringify(original);
  if(JSON.stringify({...next,updated_at:undefined})===
    JSON.stringify({...original,updated_at:undefined}))return {changed:false,data:original};
  next.updated_at=now.toISOString();
  return {changed:JSON.stringify(next)!==previous,data:next};
}

/** Datas com NE presente e ainda sem descrição publicável, sem armazenar fila extra. */
export function planCommitmentNarratives(months,{now=new Date(),batch=2}={}){
  if(!Array.isArray(months)||!Number.isSafeInteger(batch)||batch<1||batch>7)
    throw Error('Plano de descrições CGU inválido');
  const days=new Set();
  for(const month of months){
    for(const doc of month.documents||[]){
      if(doc.phase===1&&!doc.description&&reviewDue(doc.descriptionCheckedAt,now))
        days.add(doc.date);
    }
  }
  return [...days].sort().reverse().slice(0,batch);
}
