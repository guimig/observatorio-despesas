import {qualifiedRapInscription} from '../assets/rap-trajectory.js';
/**
 * Auditoria apenas documental de rotulos de inscricao em historicos de itens.
 * Sem semantica contabil, saldos, dados pessoais ou texto livre na saida.
 */
const LABELS=Object.freeze(['exact','qualified','other_with_hint','not_inscription','missing']);
const YEARS=Object.freeze(['before','same','following','later','invalid']);
const SIGNS=Object.freeze(['positive','zero','negative','unavailable']);

function canonical(value){
 if(typeof value!=='string')return null;
 const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .toLowerCase().replace(/\s+/g,' ').trim();
 return normalized||null;
}

/** Rotulos exatos e duas formas explicitamente delimitadas, nao taxonomia SIAFI. */
export function inscriptionLabelEvidence(operation){
 const name=canonical(operation);
 if(name===null)return 'missing';
 if(name==='inscricao')return 'exact';
 if(qualifiedRapInscription(name))
   return 'qualified';
 if(/\binscri(cao|cao\b)/.test(name))return 'other_with_hint';
 return 'not_inscription';
}
function dateEvidence(date,commitmentYear){
 if(!Number.isInteger(commitmentYear)||commitmentYear<2000||commitmentYear>2099)
   throw Error('Exercicio SIAFI invalido');
 if(typeof date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(date))
   return 'invalid';
 const parsed=new Date(date+'T00:00:00Z');
 if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date)
   return 'invalid';
 const year=Number(date.slice(0,4));
 return year<commitmentYear?'before':year===commitmentYear?'same':
   year===commitmentYear+1?'following':'later';
}
function signEvidence(cents){
 if(!Number.isSafeInteger(cents))return 'unavailable';
 return cents===0?'zero':cents<0?'negative':'positive';
}
export function reviewInscriptionTextEvent(event,commitmentYear){
 if(!event||typeof event!=='object'||Array.isArray(event))
   throw Error('Historico documental invalido');
 return {
   label:inscriptionLabelEvidence(event.operation),
   year:dateEvidence(event.date,commitmentYear),
   amountSign:signEvidence(event.cents)
 };
}
const categories=keys=>Object.fromEntries(keys.map(k=>[k,0]));
export function emptyInscriptionEvidence(){
 return {candidateMovements:0,labels:categories(LABELS),
   years:categories(YEARS),amountSigns:categories(SIGNS)};
}
/** Acumula apenas enums validados; nunca aceita propriedade dinamica arbitraria. */
export function addInscriptionEvidence(result,review){
 if(!result||!review||
   !LABELS.includes(review.label)||!YEARS.includes(review.year)||
   !SIGNS.includes(review.amountSign)||
   !Number.isSafeInteger(result.candidateMovements))
   throw Error('Categoria de inscricao invalida');
 result.candidateMovements++;
 result.labels[review.label]++;
 result.years[review.year]++;
 result.amountSigns[review.amountSign]++;
 return result;
}
export function mergeInscriptionEvidence(into,from){
 if(!into||!from||!Number.isSafeInteger(from.candidateMovements))
   throw Error('Agregado de inscricao invalido');
 into.candidateMovements+=from.candidateMovements;
 for(const [name,keys] of [['labels',LABELS],['years',YEARS],['amountSigns',SIGNS]]){
   for(const key of keys){
     if(!Number.isSafeInteger(from[name]?.[key])||from[name][key]<0)
       throw Error('Contagem de inscricao invalida');
     into[name][key]+=from[name][key];
   }
 }
 return into;
}
