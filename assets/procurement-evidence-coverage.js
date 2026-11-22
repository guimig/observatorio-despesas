import {procurementFinancialEvidence} from './procurement-financial-evidence.js';
/** Cobertura documental, nunca taxa de contratacao efetiva. */
export function summarizeProcurementEvidence(notices=[],contracts=[],documents=[],loadedMonths=0,totalMonths=0){
 const summary={publications:notices.length,withInstruments:0,withVerifiedNe:0,
  withDeclaredNe:0,withIndications:0,withoutEvidence:0,
  loadedMonths,totalMonths,complete:totalMonths>0&&loadedMonths===totalMonths};
 for(const notice of notices){
  const e=procurementFinancialEvidence(notice,contracts,documents);
  if(e.instruments)summary.withInstruments++;
  if(e.verifiedCommitments)summary.withVerifiedNe++;
  else if(e.confirmedInstruments)summary.withDeclaredNe++;
  else if(e.indicatedInstruments)summary.withIndications++;
  else summary.withoutEvidence++;
 }
 return summary;
}
