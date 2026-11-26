/** Catalogo pequeno, canonico e publico: somente codigos/rotulos da UO 26422.
 * Nenhuma linha financeira, payload SPARQL bruto ou atribuicao a documento. */
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIRST_YEAR,brazilMonth} from './collection-scope.mjs';
import {cacheDictionary,validateDictionary} from './siop-dictionary.mjs';
import {assertPublicSafe} from './privacy.mjs';
export const SIOP_PUBLIC_PATH='data/siop/dictionaries.json';
const empty=()=>({schema_version:1,source:'SIOP',uo:'26422',dictionaries:[]});
export function validatePublicDictionaries(value,now=new Date()){
 assertPublicSafe(value);
 if(!value||value.schema_version!==1||value.source!=='SIOP'||value.uo!=='26422'||
  Object.keys(value).some(k=>!['schema_version','source','uo','dictionaries','updated_at'].includes(k))||
  !Array.isArray(value.dictionaries)||value.dictionaries.length>100||
  (value.updated_at!==undefined&&(typeof value.updated_at!=='string'||!Number.isFinite(Date.parse(value.updated_at)))))
  throw Error('Catalogo publico SIOP invalido');
 let prior=FIRST_YEAR-1;
 for(const dictionary of value.dictionaries){
  if(!Number.isInteger(dictionary?.year)||dictionary.year<=prior)throw Error('Exercicio SIOP repetido ou fora de ordem');
  validateDictionary(dictionary,dictionary.year,now);prior=dictionary.year;
 }
 return value;
}
export async function readPublicDictionaries(root=process.cwd(),now=new Date()){
 try{return validatePublicDictionaries(JSON.parse(await readFile(join(root,SIOP_PUBLIC_PATH),'utf8')),now);}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function refreshPublicDictionaries({root=process.cwd(),now=new Date(),read=cacheDictionary}={}){
 const previous=await readPublicDictionaries(root,now)||empty();
 const byYear=new Map(previous.dictionaries.map(d=>[d.year,d]));
 const statuses=[];
 const current=Number(brazilMonth(now).slice(0,4));
 for(let year=FIRST_YEAR;year<=current;year++){
  try{
   const result=await read(year,{now});
   const dictionary=validateDictionary(result.dictionary,year,now);
   byYear.set(year,dictionary);
   statuses.push({year,status:result.status==='cache_hit'?'cache_hit':'fetched',rows:dictionary.rows.length});
  }catch{statuses.push({year,status:byYear.has(year)?'previous_preserved':'unavailable'});}
 }
 const next={...empty(),dictionaries:[...byYear.values()].sort((a,b)=>a.year-b.year)};
 validatePublicDictionaries(next,now);
 if(JSON.stringify(next.dictionaries)===JSON.stringify(previous.dictionaries)||!next.dictionaries.length)
  return {changed:false,statuses};
 next.updated_at=now.toISOString();
 const path=join(root,SIOP_PUBLIC_PATH),tmp=path+'.tmp';
 await mkdir(join(root,'data','siop'),{recursive:true});
 try{await writeFile(tmp,JSON.stringify(next)+'\n');await rename(tmp,path);}
 catch(error){await unlink(tmp).catch(()=>{});throw error;}
 return {changed:true,statuses};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{const r=await refreshPublicDictionaries();console.log('Catalogo SIOP: '+JSON.stringify(r));
  if(r.statuses.every(s=>['previous_preserved','unavailable'].includes(s.status)))process.exitCode=1;
 }catch{console.error('Catalogo SIOP nao atualizado; nenhum payload ou dado pessoal registrado.');process.exitCode=1;}
}
