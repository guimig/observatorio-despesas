import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { collectWindow } from './cgu.mjs';
import { persistWindow, validatePublishedData, mergeMonth, indexCommitmentOwners } from './store.mjs';
import { safeFailureCategory } from './historical-collector.mjs';

// Only known local validation failures are isolated. Unexpected code or I/O
// errors still abort the workflow, before any commit can be published.
const ISOLATABLE=new Set([
  'document_duplicate_other_date','document_duplicate_other_phase',
  'duplicate_document_conflict','document_identity','invalid_document',
  'coverage_inconsistent','coverage_validation','coverage_duplicate',
  'coverage_flag_conflict','document_coverage_missing','relation_validation',
  'relation_duplicate','beneficiary_validation','beneficiary_reference',
  'cpf_mask_validation','money_validation','privacy_validation',
  'targeted_original_missing','referenced_origin_missing','appearance_validation',
  'appearance_coverage_missing','item_validation','classification_validation',
  'narrative_validation','monetary_provenance','month_schema_validation','ne_listing_changed'
]);
const safePhaseFailure=value=>typeof value==='string'&&
  /^(http_[45][0-9]{2}|CGU_TIMEOUT|CGU_TRANSPORT|CGU_INVALID_JSON|CGU_INVALID_SHAPE|invalid_response)$/.test(value)
  ?value:'invalid_response';

export function planIncrementalPatches(months,patches,now=new Date()){
  const working=new Map(months.map(month=>[month.month,month]));
  const accepted=[],rejected=[];
  for(const patch of patches){
    const month=patch.coverage.date.slice(0,7);
    try{
      const next=mergeMonth(working.get(month)||null,month,[patch],now,{commitmentOwners:indexCommitmentOwners([...working.values()])});
      working.set(month,next.data);
      accepted.push(patch);
    }catch(error){
      const category=safeFailureCategory(error);
      if(!ISOLATABLE.has(category))throw error;
      rejected.push({date:patch.coverage.date,phase:patch.coverage.phase,category});
    }
  }
  return {accepted,rejected};
}

export async function runIncremental({root=process.cwd(),now=new Date(),token,
  lookback=7,maxPages=30,maxImpactPages=8,includeToday=false,dryRun=false,
  collect=collectWindow,logger=console}={}){
  if(!token)throw Error('CGU_API_KEY ausente');
  // Validate the canonical baseline before classifying an incoming conflict.
  const {months}=await validatePublishedData(root);
  const sourceFailures=[];
  const patches=await collect({token,now,lookback,maxPages,maxImpactPages,includeToday,
    onPhaseFailure({date,phase,failure}){
      const category=safePhaseFailure(failure);
      sourceFailures.push({date,phase,category});
      logger.warn('CGU: '+date+' fase '+phase+' falha na fonte ('+category+').');
    }});
  const {accepted,rejected}=planIncrementalPatches(months,patches,now);
  for(const {date,phase,category} of rejected)
    logger.warn('CGU: '+date+' fase '+phase+' conflito de incorporacao ('+category+'); acervo preservado.');
  if(!accepted.length)throw Object.assign(Error('Nenhuma fase CGU incorporavel'),{code:'CGU_NO_VALID_PHASE'});
  const updatedMonths=new Set();
  if(!dryRun){
    // Replay exactly the validated phase sequence. Never suppress disk or
    // post-write validation errors, which must block commit and publication.
    for(const patch of accepted){
      const result=await persistWindow(root,[patch],now);
      for(const month of result.updatedMonths)updatedMonths.add(month);
    }
    await validatePublishedData(root);
  }
  const partial=accepted.filter(p=>!p.coverage.complete||p.coverage.invalid>0).length;
  const invalid=accepted.reduce((n,p)=>n+p.coverage.invalid,0);
  const summary={status:sourceFailures.length||rejected.length||partial?'partial':'complete',
    sourceFailures:sourceFailures.length,mergeConflicts:rejected.length,
    accepted:accepted.length,partial,invalid,
    documents:accepted.reduce((n,p)=>n+p.coverage.count,0),
    updatedMonths:[...updatedMonths].sort()};
  logger.log('CGU incremental (somente contagens): '+JSON.stringify(summary));
  return summary;
}

async function main(){
  const dryRun=process.argv.includes('--dry-run');
  const summary=await runIncremental({token:process.env.CGU_API_KEY,
    lookback:process.env.CGU_LOOKBACK_DAYS||7,
    maxPages:process.env.CGU_MAX_PAGES||30,maxImpactPages:process.env.CGU_MAX_IMPACT_PAGES||8,
    includeToday:process.env.CGU_INCLUDE_TODAY==='true',dryRun});
  if(process.env.GITHUB_OUTPUT&&!dryRun)
    await appendFile(process.env.GITHUB_OUTPUT,'status='+summary.status+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY,'CGU incremental: '+JSON.stringify(summary)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(error=>{
    const category=error?.code==='CGU_NO_VALID_PHASE'?'no_valid_phase':
      error?.message==='CGU_API_KEY ausente'?'credential_missing':safeFailureCategory(error);
    console.error('CGU incremental interrompido ('+category+'); nenhuma publicacao potencialmente invalida.');
    process.exitCode=1;
  });
}
