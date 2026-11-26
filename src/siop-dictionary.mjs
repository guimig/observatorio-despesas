/** Dicionario de classificacoes SIOP, UO 26422, por exercicio.
 * Fonte contextual: jamais atribui fonte, PTRES, PI, UGR ou saldo a NE.
 * Resultado canonico pequeno, fora da arvore publicada; nao persiste payload bruto. */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIRST_YEAR,brazilMonth} from './collection-scope.mjs';
import {containsRawCpf} from './privacy.mjs';

export const SIOP_URL='https://www1.siop.planejamento.gov.br/sparql/';
const UO='26422', LIMIT=2500, MAX_BYTES=2*1024*1024;
const GENERIC=Object.freeze({
 sphere:'temEsfera',function:'temFuncao',subfunction:'temSubfuncao',
 program:'temPrograma',action:'temAcao',fundingSource:'temFonteRecursos',
 economicCategory:'temCategoriaEconomica',group:'temGND',
 applicationMode:'temModalidadeAplicacao',element:'temElementoDespesa',
 useIdentifier:'temIdentificadorUso',primaryResult:'temResultadoPrimario'
});
const CONTEXTUAL=Object.freeze({budgetPlan:'temPlanoOrcamentario',locator:'temSubtitulo'});
const code=/^[A-Z0-9]{1,15}$/;
const actionCode=/^[A-Z0-9]{4}$/;
function assertYear(year,now=new Date()){
 if(!Number.isInteger(year)||year<FIRST_YEAR||year>Number(brazilMonth(now).slice(0,4)))
  throw Error('Exercicio SIOP fora do recorte');
}
export function dictionaryQuery(year,now=new Date()){
 assertYear(year,now);
 // Consulta tabular conforme o exemplo oficial SIOP, sem VALUES, BIND ou predicado variavel.
 const dimensions=Object.entries({...GENERIC,...CONTEXTUAL});
 return [
 'PREFIX loa: <http://vocab.e.gov.br/2013/09/loa#>',
 'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
 'SELECT DISTINCT '+dimensions.map(([kind])=>'?'+kind+'Code ?'+kind+'Label').join(' ')+' WHERE {',
 ' GRAPH <http://orcamento.dados.gov.br/'+year+'/> {',
 '  ?i a loa:ItemDespesa ; loa:temUnidadeOrcamentaria ?uo . ?uo loa:codigo "'+UO+'" .',
 ...dimensions.flatMap(([kind,predicate])=>[
   '  ?i loa:'+predicate+' ?'+kind+'Node .',
   '  ?'+kind+'Node loa:codigo ?'+kind+'Code .',
   '  OPTIONAL { ?'+kind+'Node rdfs:label ?'+kind+'Label . }'
 ]),
 ' }',
 '} LIMIT '+(LIMIT+1)
 ].join('\n');
}
function safeLabel(value){
 return typeof value==='string'&&value.length>0&&value.length<=400&&
  !/[\u0000-\u001f\u007f]/.test(value)&&!containsRawCpf(value);
}
function validRow(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||
  Object.keys(row).some(k=>!['kind','code','label','action'].includes(k)))return false;
 if(!code.test(row.code||'')||!safeLabel(row.label))return false;
 if(Object.hasOwn(CONTEXTUAL,row.kind))return actionCode.test(row.action||'');
 return Object.hasOwn(GENERIC,row.kind)&&row.action===undefined;
}
function rowKey(row){return JSON.stringify([row.kind,row.action||'',row.code]);}
export function normalizeDictionary(payload,year,now=new Date()){
 assertYear(year,now);
 let bindings=payload?.results?.bindings;
 if(!Array.isArray(bindings)||!bindings.length||bindings.length>LIMIT)
  throw Error('Dicionario SIOP vazio, invalido ou truncado');
 // A consulta tabular devolve combinacoes de classificacao. Extrair somente
 // pares codigo/rotulo distintos, PO/localizador por acao, sem guardar linhas.
 if(bindings[0]?.kind===undefined){
  const unique=new Map();
  for(const b of bindings){
   for(const kind of Object.keys({...GENERIC,...CONTEXTUAL})){
    const c=b?.[kind+'Code']?.value,label=b?.[kind+'Label']?.value;
    if(c===undefined||label===undefined)continue; // rotulo nao fornecido: nao inventar
    const action=Object.hasOwn(CONTEXTUAL,kind)?b?.actionCode?.value:'';
    const item={kind:{value:kind},code:{value:c},label:{value:label},action:{value:action}};
    unique.set(JSON.stringify([kind,c,label,action]),item);
    if(unique.size>LIMIT)throw Error('Dicionario SIOP vazio, invalido ou truncado');
   }
  }
  bindings=[...unique.values()];
 }
 const rows=new Map(),conflicts=new Set();
 for(const b of bindings){
  const kind=b?.kind?.value, c=b?.code?.value, label=b?.label?.value, action=b?.action?.value;
  const row={kind,code:c,label,...(Object.hasOwn(CONTEXTUAL,kind)?{action}:{})};
  if(!validRow(row))throw Error('Classificacao SIOP invalida');
  const key=rowKey(row);
  if(rows.has(key)&&rows.get(key).label!==label)conflicts.add(key);
  rows.set(key,row);
 }
 // Nao escolher descricao arbitraria quando o mesmo codigo contextual diverge.
 for(const key of conflicts)rows.delete(key);
 if(!rows.size)throw Error('Dicionario SIOP sem classificacoes inequivocas');
 return {source:'SIOP',uo:UO,year,rows:[...rows.values()].sort((a,b)=>rowKey(a).localeCompare(rowKey(b))),conflicts:conflicts.size};
}
export function validateDictionary(data,year,now=new Date()){
 assertYear(year,now);
 if(!data||data.source!=='SIOP'||data.uo!==UO||data.year!==year||
  Object.keys(data).some(k=>!['source','uo','year','rows','conflicts'].includes(k))||
  !Array.isArray(data.rows)||!data.rows.length||data.rows.length>LIMIT||
  !Number.isSafeInteger(data.conflicts)||data.conflicts<0||data.conflicts>LIMIT||
  data.rows.some(r=>!validRow(r))||new Set(data.rows.map(rowKey)).size!==data.rows.length)
  throw Error('Cache SIOP invalido');
 return data;
}
export async function fetchDictionary(year,{fetchFn=fetch,now=new Date()}={}){
 const query=dictionaryQuery(year,now);
 const response=await fetchFn(SIOP_URL,{method:'POST',
  body:new URLSearchParams({query}),
  headers:{Accept:'application/sparql-results+json','Content-Type':'application/x-www-form-urlencoded'},
  redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('SIOP HTTP '+response.status);
 if(response.url&&new URL(response.url).hostname!==new URL(SIOP_URL).hostname)
  throw Error('SIOP redirected outside host');
 const reader=response.body?.getReader();
 if(!reader)throw Error('SIOP sem corpo');
 const chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error('SIOP resposta excede limite');}
   chunks.push(value);}
 }finally{reader.releaseLock();}
 return normalizeDictionary(JSON.parse(Buffer.concat(chunks).toString('utf8')),year,now);
}
export async function cacheDictionary(year,{root='.cache/siop-dictionary',now=new Date(),fetchFn=fetch}={}){
 assertYear(year,now);
 const file=join(root,year+'.json');
 const ttl=(year===Number(brazilMonth(now).slice(0,4))?7:30)*86400000;
 try{
  const cached=JSON.parse(await readFile(file,'utf8'));
  const checked=Date.parse(cached.checkedAt);
  const data=validateDictionary(cached.dictionary,year,now);
  if(Number.isFinite(checked)&&checked<=now.getTime()&&now.getTime()-checked<ttl)
   return {status:'cache_hit',dictionary:data};
 }catch{}
 const dictionary=await fetchDictionary(year,{now,fetchFn});
 await mkdir(root,{recursive:true});
 await writeFile(file+'.tmp',JSON.stringify({checkedAt:now.toISOString(),dictionary})+'\n');
 await rename(file+'.tmp',file);
 return {status:'fetched',dictionary};
}
async function main(){
 const now=new Date(),current=Number(brazilMonth(now).slice(0,4));
 const years=process.argv[2]?[Number(process.argv[2])]:
  Array.from({length:current-FIRST_YEAR+1},(_,i)=>FIRST_YEAR+i);
 let failures=0;
 for(const year of years){
  try{
   const {status,dictionary}=await cacheDictionary(year,{now});
   const fields={};
   for(const r of dictionary.rows)fields[r.kind]=(fields[r.kind]||0)+1;
   console.log('SIOP '+JSON.stringify({year,status,rows:dictionary.rows.length,conflicts:dictionary.conflicts,fields}));
  }catch(error){failures++;
   const msg=String(error?.message||'');
   const status=/^SIOP HTTP \d{3}$/.test(msg)?msg:
    msg==='SIOP redirected outside host'?'redirected_outside_host':
    msg==='Dicionario SIOP vazio, invalido ou truncado'?'empty_invalid_or_truncated':
    msg==='Classificacao SIOP invalida'?'invalid_classification':
    msg==='SIOP resposta excede limite'?'oversized_body':
    error instanceof SyntaxError?'invalid_json':'network_or_unavailable';
   console.log('SIOP '+JSON.stringify({year,status}));}
 }
 if(failures)process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 await main();
