import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fetchTenderItems} from './pncp-tender-items.mjs';
import {inScopePurchaseId} from './collection-scope.mjs';
import {validateResults,fetchItemResults,applyItemResults,planItemResults,resultKey} from './pncp-item-results.mjs';
import {readOperationalState,saveOperationalState} from './operational-state.mjs';
import {assertPublicSafe} from './privacy.mjs';
const path='data/procurement/tender-items.json';
const ID=/^(10635424000186|10635424000348)-1-\d{6}\/20\d{2}$/;
export function validateTenderCatalog(data,notices){
 assertPublicSafe(data);
 if(data?.schema_version!==1||!Array.isArray(data.procedures)||
  Object.keys(data).some(k=>!['schema_version','procedures'].includes(k)))throw Error('Catalogo de itens invalido');
 const allowed=new Set(notices.map(n=>n.pncpId)),seen=new Set();
 for(const p of data.procedures){
  if(!ID.test(p.pncpId)||!allowed.has(p.pncpId)||seen.has(p.pncpId)||
    !/^20\d{2}-\d{2}-\d{2}$/.test(p.checkedAt)||!Array.isArray(p.items)||
    Object.keys(p).some(k=>!['pncpId','checkedAt','items'].includes(k)))throw Error('Procedimento de itens invalido');
  seen.add(p.pncpId);const nums=new Set();
  for(const item of p.items){
   if(item.pncpId!==p.pncpId||item.scope!=='ifc_tendered'||
    !Number.isSafeInteger(item.number)||item.number<1||nums.has(item.number)||
    !Number.isFinite(item.quantity)||item.quantity<0||item.quantity>1e12||
    typeof item.description!=='string'||!item.description||item.description.length>240||
    Object.keys(item).some(k=>!['pncpId','number','description','quantity','scope','results'].includes(k)))
    throw Error('Item de licitacao invalido');
   if(Object.hasOwn(item,'results'))validateResults(item.results);
   nums.add(item.number);
  }
 }
 return data;
}
export function planTenderItems(notices,procedures,limit=5,slot=0){
 if(!Number.isSafeInteger(limit)||limit<1||limit>10||!Number.isSafeInteger(slot)||slot<0)throw Error('Limite ou rodada invalida');
 const known=new Set(procedures.map(p=>p.pncpId));
 const pending=notices.filter(n=>inScopePurchaseId(n.pncpId)&&!known.has(n.pncpId))
  .sort((a,b)=>a.pncpId.localeCompare(b.pncpId));
 if(!pending.length)return [];
 // Alternar o ponto inicial a cada dia impede que uma falha persistente bloqueie o acervo.
 const start=slot%pending.length;
 return pending.slice(start).concat(pending.slice(0,start)).slice(0,limit);
}
async function main(){
 const notices=JSON.parse(await readFile('data/procurement/notices.json','utf8')).notices;
 let data;try{data=JSON.parse(await readFile(path,'utf8'))}
 catch(e){if(e.code==='ENOENT')data={schema_version:1,procedures:[]};else throw e}
 validateTenderCatalog(data,notices);
 const slot=Math.floor(Date.now()/43200000);
 const plan=planTenderItems(notices,data.procedures,Number(process.env.PNCP_TENDER_ITEMS_LIMIT||5),slot);
 console.log('Itens licitados: '+JSON.stringify({totalNotices:notices.length,srpNotices:notices.filter(n=>n.srp===true).length,already:data.procedures.length,selected:plan.length,remaining:notices.filter(n=>inScopePurchaseId(n.pncpId)&&!data.procedures.some(p=>p.pncpId===n.pncpId)).length}));
 if(process.argv.includes('--dry-run'))return;
 let success=0,failed=0;
 for(const notice of plan){
  try{
   const items=await fetchTenderItems(notice.pncpId);
   data.procedures.push({pncpId:notice.pncpId,checkedAt:new Date().toISOString().slice(0,10),items});
   success++;
  }catch(e){failed++;console.warn('Falha na consulta de itens: '+notice.pncpId+'; dados parciais descartados');if([401,403,429].includes(e.status))break;}
 }
 const statePath=process.env.PNCP_RESULT_STATE_PATH;
 const state=await readOperationalState(statePath);
 const resultPlan=planItemResults(data.procedures,{state,limit:Number(process.env.PNCP_RESULT_LIMIT||15),slot});
 const deadline=Date.now()+6*60*1000;
 let resultSuccess=0,resultFailed=0,resultChanged=0,resultRows=0;
 for(const item of resultPlan){
  if(Date.now()>=deadline)break;
  try{
   const results=await fetchItemResults(item);
   const next=applyItemResults(item,results);
   const procedure=data.procedures.find(p=>p.pncpId===item.pncpId);
   const idx=procedure.items.findIndex(i=>i.number===item.number);
   if(next!==item){procedure.items[idx]=next;resultChanged++}
   delete state[resultKey(item)];state[resultKey(next)]=new Date().toISOString().slice(0,10);
   resultSuccess++;resultRows+=results.length;
  }catch(e){resultFailed++;console.warn('Consulta de resultados PNCP nao concluida: '+(e.status?'HTTP '+e.status:'formato ou divergencia'));if([401,403,429].includes(e.status))break;}
 }
 if(success||resultChanged){
  data.procedures.sort((a,b)=>a.pncpId.localeCompare(b.pncpId));
  validateTenderCatalog(data,notices);
  try{await writeFile(path+'.tmp',JSON.stringify(data)+'\n');await rename(path+'.tmp',path)}
  catch(e){await unlink(path+'.tmp').catch(()=>{});throw e}
 }
 await saveOperationalState(statePath,state);
 console.log('Resultados PNCP (contagens): '+JSON.stringify({planned:resultPlan.length,success:resultSuccess,failed:resultFailed,changed:resultChanged,rows:resultRows,checked:data.procedures.reduce((n,p)=>n+p.items.filter(i=>Object.hasOwn(i,'results')).length,0)}));
 console.log('Itens licitados: '+JSON.stringify({success,failed,procedures:data.procedures.length,
  items:data.procedures.reduce((n,p)=>n+p.items.length,0)}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(e.message);process.exitCode=1});
