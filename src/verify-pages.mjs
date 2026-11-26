/** Verifica se o CDN do Pages serve os arquivos gerados, sem consultar APIs CGU. */
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';

const wait=ms=>new Promise(done=>setTimeout(done,ms));
export async function comparePublication(site,expected,{fetcher=fetch}={}){
  if(typeof site!=='string'||!site.startsWith('https://'))
    throw Error('URL HTTPS do GitHub Pages inválida');
  const base=new URL(site.endsWith('/')?site:site+'/');
  for(const [relative,contents] of Object.entries(expected)){
    if(!/^(index\.html|assets\/[A-Za-z0-9.-]+|data\/(?:manifest|coverage-index)\.json|data\/procurement\/(?:contracts|notices|atas|ata-participants|tender-items)\.json|data\/siop\/dictionaries\.json|data\/months\/20\d{2}-(0[1-9]|1[0-2])\.json)$/.test(relative))
      throw Error('Caminho de publicação não permitido');
    const target=new URL(relative,base);
    target.searchParams.set('v',String(Date.now()));
    try{
      const response=await fetcher(target,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
      if(!response.ok||await response.text()!==contents)
        return {ok:false,path:relative};
    }catch{
      return {ok:false,path:relative};
    }
  }
  return {ok:true,files:Object.keys(expected).length};
}

export async function verifyPublication({
  root=process.cwd(),site=process.env.SITE_BASE,fetcher=fetch,
  attempts=12,delayMs=8000,sleep=wait
}={}){
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>15)
    throw Error('Tentativas de verificação inválidas');
  const dist=resolve(root,'dist');
  const manifest=JSON.parse(await readFile(join(dist,'data','manifest.json'),'utf8'));
  if(!Array.isArray(manifest.months)||manifest.unit!=='158459')
    throw Error('Manifesto de publicação inválido');
  // Conferir primeiro os meses modificados mais recentemente; assim uma
  // recoleta histórica também é verificada, sem centenas de requisições.
  const monthFiles=await Promise.all(manifest.months.map(async month=>{
    const path='data/months/'+month+'.json';
    const contents=await readFile(join(dist,path),'utf8');
    const meta=JSON.parse(contents);
    return {path,contents,updated_at:meta.updated_at||''};
  }));
  monthFiles.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  const paths=['data/coverage-index.json','data/manifest.json','index.html','assets/app.js','assets/budget-classification.js','assets/integrated-trajectory.js','assets/style.css','assets/quality.js','assets/coverage-panel.js'];
  const expected={};
  for(const path of paths)expected[path]=await readFile(join(dist,path),'utf8');
  for(const path of ['contracts','notices','atas','ata-participants','tender-items'].map(s=>'data/procurement/'+s+'.json')){
    try{expected[path]=await readFile(join(dist,path),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  }
  try{expected['data/siop/dictionaries.json']=await readFile(join(dist,'data/siop/dictionaries.json'),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  for(const month of monthFiles.slice(0,8))expected[month.path]=month.contents;
  let last=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    last=await comparePublication(site,expected,{fetcher});
    if(last.ok)return {...last,attempt};
    if(attempt<attempts)await sleep(delayMs);
  }
  throw Error('GitHub Pages não corresponde ao build publicado: '+(last?.path||'sem resultado'));
}

if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  verifyPublication().then(result=>console.log('Publicação confirmada no Pages: '+
    result.files+' arquivo(s) conferido(s) em '+result.attempt+' tentativa(s).'))
    .catch(error=>{console.error(/^GitHub Pages não corresponde ao build publicado: /.test(error?.message||'')?error.message:'A versão publicada no Pages não pôde ser confirmada.');process.exitCode=1;});
}
