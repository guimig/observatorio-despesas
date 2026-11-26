import {readProcurement} from './procurement-store.mjs';
import {validatePublishedData} from './store.mjs';
import {fetchLinkedCommitments} from './pncp-commitments.mjs';
import {indexLocalCommitments,emptyShortAudit,addShortAudit} from './pncp-short-identity.mjs';
import {isAraquariProcess} from '../assets/procurement-links.js';
const {months}=await validatePublishedData(process.cwd());
const catalog=await readProcurement(process.cwd());
const shortIndex=indexLocalCommitments(months.flatMap(m=>m.documents));
const sample=(catalog?.contracts||[]).filter(c=>c.source==='pncp'&&c.commitmentAudit?.formats?.shortOnly>0)
 .sort((a,b)=>Number(isAraquariProcess(b.process))-Number(isAraquariProcess(a.process))||b.publishedMonth.localeCompare(a.publishedMonth)||a.id.localeCompare(b.id)).slice(0,10);
const total=emptyShortAudit();let complete=0,unavailable=0;
for(const c of sample){
 try{const r=await fetchLinkedCommitments(c,{includeDetails:true,shortIndex,maxPages:3});
  addShortAudit(total,r.shortAudit);complete++;}
 catch{unavailable++;}
}
console.log('Sondagem PNCP NE abreviada: '+JSON.stringify({sample:sample.length,complete,unavailable,...total}));
console.log('Somente contagens; sem atribuir PI, sem persistencia, sem prova de identidade SIAFI.');
