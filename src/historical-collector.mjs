/** Recuperacao historica CGU: isolamento de falhas por dia e fase, sem snapshots. */
import {isoDate} from './cgu.mjs';

const PHASES=[1,2,3];
export function safeFailureCategory(error){
  const status=Number(error?.status ?? error?.statusCode);
  if(Number.isInteger(status)&&status>=400&&status<=599)return 'http_'+status;
  const code=String(error?.code||'').toUpperCase();
  if(['CGU_TIMEOUT','ETIMEDOUT','ESOCKETTIMEDOUT','ABORT_ERR'].includes(code) || error?.name==='AbortError')return 'timeout';
  if(['CGU_TRANSPORT','ECONNRESET','ENOTFOUND','EAI_AGAIN','ECONNREFUSED'].includes(code))return 'network';
  if(code==='CGU_INVALID_JSON'||error?.name==='SyntaxError')return 'invalid_json';
  if(code==='CGU_INVALID_SHAPE')return 'invalid_schema';
  // Permitir apenas correspondencias literais com mensagens locais conhecidas.
  const known=new Map([
    ['Documento não corresponde à UG 158459','document_identity'],
    ['Documento CGU inválido','invalid_document'],
    ['Documento CGU duplicado divergente','duplicate_document_conflict'],
    ['Campo não autorizado no JSON público','privacy_validation'],
    ['Documento público inválido ou duplicado','invalid_document'],
    ['Contagem documental divergente','coverage_inconsistent'],
    ['Vínculo documental inválido','relation_validation'],
    ['CGU indisponível','network']
  ]);
  return known.get(error?.message)||'validation_or_other';
}

export function phasesMissingOnDate(existing,date,{recheck=false}={}){
  const iso=isoDate(date);
  if(recheck)return [...PHASES];
  return PHASES.filter(phase=>!existing?.coverage?.some(c=>c.date===iso&&
    c.phase===phase&&c.complete===true&&c.invalid===0));
}

/** Checkpoints sao gravados individualmente; somente fases sem cobertura completa sao chamadas.
 * Persistencia falha e aborta a execucao: nunca mascarar erro de disco/esquema como API.
 * O chamador recebe apenas contagens e categorias, sem identificadores de documentos.
 */
export async function collectHistoricalDate({
  date,existing=null,recheck=false,collect,persist,logger=()=>{}
}={}){
  if(typeof collect!=='function'||typeof persist!=='function')throw Error('Operadores historicos invalidos');
  const pending=phasesMissingOnDate(existing,date,{recheck});
  const completed=new Set([1,2,3].filter(phase=>!pending.includes(phase)));
  const failures={},attempted=[];
  let documents=0,consulted=0;
  for(const phase of pending){
    attempted.push(phase);
    let patch;
    try{
      patch=await collect(date,phase);
    }catch(error){
      const category=safeFailureCategory(error);
      failures[category]=(failures[category]||0)+1;
      logger({date,phase,status:'failed',category});
      continue;
    }
    if(!patch?.coverage||patch.coverage.phase!==phase||
       patch.coverage.date!==isoDate(date)||!Array.isArray(patch.documents)||
       !Array.isArray(patch.links))throw Error('Lote CGU sem estrutura valida');
    // Erro de persistencia e fatal: nunca mascarar falha de esquema/disco como API.
    try{
      await persist(patch);
    }catch(error){
      logger({date,phase,status:'checkpoint_failed',category:safeFailureCategory(error)});
      throw error;
    }
    consulted++;
    documents+=patch.documents.length;
    if(patch.coverage.complete===true&&patch.coverage.invalid===0)completed.add(phase);
    logger({date,phase,status:patch.coverage.complete&&patch.coverage.invalid===0?
      'complete':'partial',count:patch.documents.length});
  }
  return {date,attempted,consulted,documents,fullyComplete:completed.size===3,
    failed:Object.values(failures).reduce((n,v)=>n+v,0),failures};
}
