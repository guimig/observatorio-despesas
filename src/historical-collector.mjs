/** Recuperacao historica CGU: isolamento de falhas por dia e fase, sem snapshots. */
import {isoDate} from './cgu.mjs';

const PHASES=[1,2,3];

/** Conta colisões sem divulgar ID SIAFI e sem arbitrar qual data/fase prevalece. */
export function documentCollisionSummary(existing,patch){
  const previous=new Map((existing?.documents||[]).map(d=>[d.id,d]));
  const summary={otherDate:0,otherPhase:0};
  for(const doc of patch?.documents||[]){
    const old=previous.get(doc.id);
    if(!old)continue;
    if(old.date!==doc.date)summary.otherDate++;
    else if(old.phase!==doc.phase)summary.otherPhase++;
  }
  return summary;
}
export function collisionCode(summary){
  // Mesma data em outro filtro nao duplica o documento: registra-se
  // uma observacao de fase, sem afirmar que ocorreu uma segunda despesa.
  if(summary.otherDate)return 'CGU_DOC_COLLISION_DATE';
  return null;
}
export function safeFailureCategory(error){
  const status=Number(error?.status ?? error?.statusCode);
  if(Number.isInteger(status)&&status>=400&&status<=599)return 'http_'+status;
  const code=String(error?.code||'').toUpperCase();
  if(code==='CGU_BUDGET_STOP')return 'budget_deferred';
  if(code==='CGU_DOC_COLLISION_DATE')return 'document_duplicate_other_date';
  if(code==='CGU_DOC_COLLISION_PHASE')return 'document_duplicate_other_phase';
  if(code==='CGU_DOC_COLLISION_BOTH')return 'document_duplicate_date_and_phase';
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
    ['Esquema mensal inválido','month_schema_validation'],
    ['Documento sem cobertura declarada','document_coverage_missing'],
    ['Cobertura documental inválida','coverage_validation'],
    ['Cobertura documental duplicada','coverage_duplicate'],
    ['Consulta completa com motivo parcial','coverage_flag_conflict'],
    ['Cadastro público de pessoa jurídica inválido','beneficiary_validation'],
    ['CNPJ não encontrado no catálogo mensal','beneficiary_reference'],
    ['CPF em formato diferente do mascaramento obrigatório','cpf_mask_validation'],
    ['Valor monetário inválido','money_validation'],
    ['Vínculo documental duplicado','relation_duplicate'],
    ['Documento em datas diferentes exige revisao','document_duplicate_other_date'],
    ['Documento duplicado no mesmo filtro','duplicate_document_conflict'],
    ['Dia completo nao contem NE recuperada individualmente','targeted_original_missing'],
    ['Documento de origem referenciado por outra fase: revisar retificacao','referenced_origin_missing'],
    ['Aparicao documental em fase invalida','appearance_validation'],
    ['Aparicao sem cobertura declarada','appearance_coverage_missing'],
    ['Aparicoes em fases invalidas','appearance_validation'],
    ['Itens sem empenho de origem válido','item_validation'],
    ['Versao de itens sem catalogo','item_validation'],
    ['Classificação de despesa inválida','classification_validation'],
    ['Descrição de documento não sanitizada','narrative_validation'],
    ['Proveniencia monetaria invalida','monetary_provenance'],
    ['CGU indisponível em toda a janela consultada','source_unavailable'],
    ['CGU indisponível','network']
  ]);
  return known.get(error?.message)||'validation_or_other';
}

export function phasesMissingOnDate(existing,date,{recheck=false,listingOnly=false}={}){
  const iso=isoDate(date);
  if(recheck)return [...PHASES];
  return PHASES.filter(phase=>!existing?.coverage?.some(c=>c.date===iso&&
    c.phase===phase&&c.complete===true&&(c.invalid===0||listingOnly&&phase===2&&
      c.invalid===(existing.documents||[]).filter(d=>d.date===iso&&d.phase===2&&d.cents===null).length)));
}

/** Checkpoints sao gravados individualmente; somente fases sem cobertura completa sao chamadas.
 * Persistencia falha e aborta a execucao: nunca mascarar erro de disco/esquema como API.
 * O chamador recebe apenas contagens e categorias, sem identificadores de documentos.
 */
export async function collectHistoricalDate({
  date,existing=null,recheck=false,listingOnly=false,shouldStop=()=>false,collect,persist,logger=()=>{}
}={}){
  if(typeof collect!=='function'||typeof persist!=='function')throw Error('Operadores historicos invalidos');
  const pending=phasesMissingOnDate(existing,date,{recheck,listingOnly});
  const missing=phasesMissingOnDate(existing,date,{recheck});
  const completed=new Set([1,2,3].filter(phase=>!missing.includes(phase)));
  const failures={},attempted=[];
  let documents=0,consulted=0,deferred=0;
  for(const phase of pending){
    if(shouldStop()){deferred+=pending.length-attempted.length;break;}
    attempted.push(phase);
    let patch;
    try{
      patch=await collect(date,phase);
    }catch(error){
      const category=safeFailureCategory(error);
      if(category==='budget_deferred'){
        deferred+=1+pending.length-attempted.length;
        logger({date,phase,status:'deferred',category});break;
      }
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
      const category=safeFailureCategory(error);
      if(String(error?.code||'').startsWith('CGU_DOC_COLLISION_')){
        failures[category]=(failures[category]||0)+1;
        logger({date,phase,status:'failed',category,count:Number(error?.conflictCount)||0});
        continue; // Nao incorporar fase de contagem inconciliavel; outras datas continuam.
      }
      logger({date,phase,status:'checkpoint_failed',category});
      throw error; // Erro de disco/esquema nao relacionado continua fatal.
    }
    consulted++;
    documents+=patch.documents.length;
    if(patch.coverage.complete===true&&patch.coverage.invalid===0)completed.add(phase);
    logger({date,phase,status:patch.coverage.complete&&patch.coverage.invalid===0?
      'complete':'partial',count:patch.documents.length});
  }
  return {date,attempted,consulted,documents,deferred,fullyComplete:completed.size===3,
    failed:Object.values(failures).reduce((n,v)=>n+v,0),failures};
}
