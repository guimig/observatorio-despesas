/** Revalidacao de cobertura CGU existente, independente do backfill de lacunas.
 * A listagem por data/fase preserva a data canonica de emissao; o detalhe de NE
 * pode apresentar outra data e nao e usado para alterar a competencia.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectDayPhase} from './cgu.mjs';
import {currentDateInBrazil} from './backfill.mjs';
import {inScopeDate} from './collection-scope.mjs';
import {stateKey,readOperationalState,saveOperationalState,validDay} from './operational-state.mjs';
import {mergeMonth,persistWindow,validatePublishedData,indexCommitmentOwners} from './store.mjs';
import {safeFailureCategory} from './historical-collector.mjs';
const DAY=86400000;
const dateBefore=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')-days*DAY).toISOString().slice(0,10);
const br=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
export const phaseKey=(date,phase)=>stateKey(['cgu-review',date,phase]);
export function planHistoricalReviews(months,{now=new Date(),state={},limit=4}={}){
 if(!Array.isArray(months)||!Number.isSafeInteger(limit)||limit<1||limit>8)throw Error('Limite de revisao CGU invalido');
 const today=currentDateInBrazil(now),windowStart=dateBefore(today,7),recent=dateBefore(today,30);
 const allDocs=new Map(),impact=new Map();
 for(const m of months)for(const d of m.documents)allDocs.set(d.id,d);
 for(const m of months)for(const link of m.relations){
   const owner=allDocs.get(link.from);
   if(!owner||!inScopeDate(owner.date)||owner.date>=today)continue;
   if(owner.date>(impact.get(link.to)||''))impact.set(link.to,owner.date);
 }
 const candidates=[];
 for(const m of months){
   const groups=new Map();
   for(const d of m.documents){
     const key=d.date+'/'+d.phase;
     if(!groups.has(key))groups.set(key,[]);
     groups.get(key).push(d);
   }
   for(const c of m.coverage){
     if(!c.complete||c.invalid!==0||!inScopeDate(c.date)||c.date>=windowStart)continue;
     const docs=groups.get(c.date+'/'+c.phase)||[];
     const key=phaseKey(c.date,c.phase),last=validDay(state[key])&&state[key]<=today?state[key]:'';
     const lastImpact=c.phase===1?docs.reduce((max,d)=>{const x=impact.get(d.id)||'';return x>max?x:max},''):'';
     const active=lastImpact>=recent;
     const interval=active?7:docs.length?30:90;
     if(last&&last>dateBefore(today,interval)&&!(active&&lastImpact>last))continue;
     candidates.push({month:m.month,date:c.date,phase:c.phase,key,last,active,documents:docs.length,interval});
   }
 }
 const order=(a,b)=>a.last.localeCompare(b.last)||a.date.localeCompare(b.date)||a.phase-b.phase;
 const priority=candidates.filter(x=>x.active).sort(order);
 const other=candidates.filter(x=>!x.active).sort((a,b)=>Number(b.documents>0)-Number(a.documents>0)||order(a,b));
 // Reserva ao menos um lugar para cobertura rotineira mesmo havendo NEs ativas.
 const chosen=priority.slice(0,other.length&&limit>1?limit-1:limit);
 chosen.push(...other.slice(0,limit-chosen.length));
 chosen.push(...priority.slice(chosen.filter(x=>x.active).length,chosen.filter(x=>x.active).length+limit-chosen.length));
 return {eligible:candidates.length,active:priority.length,selected:chosen};
}
/** Resposta parcial ou desaparecimento de documento confirmado nao e retificacao.
 * Conserva campos previamente publicaveis quando a fonte apenas os omite.
 * Nunca muda data/identidade ou interpreta ausencia como anulacao.
 */
export function prepareHistoricalReview(month,task,patch,owners=new Map(),{allowCommitmentDateObservations=false}={}){
 const c=patch?.coverage;
 if(!c||c.date!==task.date||c.phase!==task.phase||c.complete!==true||c.invalid!==0||
    !Array.isArray(patch.documents)||!Array.isArray(patch.links)||c.count!==patch.documents.length)
   return {ok:false,reason:'incomplete'};
 const old=month.documents.filter(d=>d.date===task.date&&d.phase===task.phase);
 const known=new Map(old.map(d=>[d.id,d]));
 const expected=[...old.map(d=>d.id),...(month.phaseObservations||[]).filter(d=>d.date===task.date&&d.phase===task.phase).map(d=>d.id),...(task.phase===1?(month.commitmentObservations||[]).filter(o=>o.date===task.date).map(o=>o.id):[])];
 const incoming=new Set(patch.documents.map(d=>d.id));
 if(expected.some(id=>!incoming.has(id)))return {ok:false,reason:'missing_confirmed_document'};
 if(incoming.size!==patch.documents.length)return {ok:false,reason:'duplicate_document'};
 const next=structuredClone(patch);
 for(const d of next.documents){
   if(d.date!==task.date||d.phase!==task.phase||d.cents===null||
      (owners.has(d.id)&&owners.get(d.id)!==d.date&&!(allowCommitmentDateObservations&&d.phase===1&&/^158459\d{5}20\d{2}NE\d{6}$/.test(d.id))))return {ok:false,reason:'identity_or_date_conflict'};
   const prior=known.get(d.id);
   if(!prior)continue;
   if(prior.process&&!d.process)d.process=prior.process;
   if(prior.nature)d.nature={...prior.nature,...d.nature};
   if(!d.beneficiary&&prior.partyRef)d.beneficiary={type:'pj',id:prior.partyRef,name:month.beneficiaries?.[prior.partyRef]||''};
   if(!d.beneficiary&&prior.cpfMasked)d.beneficiary={type:'pf',id:prior.cpfMasked};
 }
 return {ok:true,patch:next};
}
export async function reviewHistoricalCgu({root=process.cwd(),token,now=new Date(),limit=4,statePath,collect=collectDayPhase,dryRun=false}={}){
 const {months}=await validatePublishedData(root);
 const state=await readOperationalState(statePath,{now});
 const plan=planHistoricalReviews(months,{now,state,limit});
 const summary={eligible:plan.eligible,active:plan.active,planned:plan.selected.length,completed:0,changedPhases:0,failures:{}};
 if(dryRun||!plan.selected.length)return summary;
 if(!token)throw Error('CGU_API_KEY ausente');
 const byMonth=new Map(months.map(m=>[m.month,m])),owners=new Map();
 for(const m of months)for(const d of m.documents)owners.set(d.id,d.date);
 const today=currentDateInBrazil(now);
 const fail=reason=>{summary.failures[reason]=(summary.failures[reason]||0)+1};
 for(const task of plan.selected){
   let raw;
   try{raw=await collect(br(task.date),task.phase,{token,maxPages:30,maxImpactPages:8})}
   catch(e){fail(safeFailureCategory(e));continue}
   const month=byMonth.get(task.month);
   const result=prepareHistoricalReview(month,task,raw,owners,{allowCommitmentDateObservations:true});
   if(!result.ok){fail(result.reason);continue}
   let outcome;
   try{outcome=mergeMonth(month,task.month,[result.patch],now,{commitmentOwners:indexCommitmentOwners([...byMonth.values()])})}
   catch{fail('canonical_validation');continue}
   // Nao marcar sucesso antes de persistir a revisao validada.
   if(outcome.changed){
     await persistWindow(root,[result.patch],now);
     byMonth.set(task.month,outcome.data);
     for(const d of outcome.data.documents)owners.set(d.id,d.date);
     summary.changedPhases++;
   }
   state[task.key]=today;
   summary.completed++;
 }
 await validatePublishedData(root);
 await saveOperationalState(statePath,state,{now});
 return summary;
}
async function main(){
 const summary=await reviewHistoricalCgu({token:process.env.CGU_API_KEY,
  limit:Number(process.env.CGU_REVIEW_LIMIT||4),statePath:process.env.CGU_REVIEW_STATE_PATH,
  dryRun:process.argv.includes('--dry-run')});
 console.log('Revisao historica CGU (somente contagens): '+JSON.stringify(summary));
 if(summary.planned&&!summary.completed&&!process.argv.includes('--dry-run'))process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Revisao CGU interrompida; acervo validado preservado.');process.exitCode=1});
