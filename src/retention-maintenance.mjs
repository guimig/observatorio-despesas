/** Read-only storage monitoring and guarded deletion of merged branch references. */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const REPO='guimig/observatorio-despesas';
const MB=1000000;
export const LIMITS=Object.freeze({json:[750000,1000000],data:[25*MB,50*MB],git:[50*MB,100*MB],cache:[100*MB,250*MB],branches:[20,50],pages:[5*MB,10*MB]});
export function severity(value,limits){
 return !Number.isFinite(value)?'indisponível':value>=limits[1]?'revisar':value>=limits[0]?'alerta':'normal';
}
export function treeSizes(raw){
 const files=raw.split('\0').filter(Boolean).map(line=>{
  const m=/^\d+ blob [a-f0-9]+\s+(\d+)\t([\s\S]+)$/.exec(line);
  return m?{bytes:Number(m[1]),path:m[2]}:null;
 }).filter(Boolean);
 const data=files.filter(f=>f.path.startsWith('data/'));
 const json=data.filter(f=>f.path.endsWith('.json')).sort((a,b)=>b.bytes-a.bytes);
 return {files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),dataBytes:data.reduce((n,f)=>n+f.bytes,0),
  largestJson:json[0]?.bytes||0,largest:json.slice(0,10)};
}
export function mergedCandidates(branches,closed,open,{repo=REPO,defaultBranch='main',isAncestor=()=>false}={}){
 const blocked=new Set(open.flatMap(p=>[
  p.head?.repo?.full_name===repo?p.head.ref:null,p.base?.repo?.full_name===repo?p.base.ref:null
 ]).filter(Boolean));
 const merged=new Map();
 for(const p of closed){
  if(!p.merged_at||!p.merge_commit_sha||p.head?.repo?.full_name!==repo||p.base?.repo?.full_name!==repo||p.base.ref!==defaultBranch)continue;
  if(!merged.has(p.head.ref))merged.set(p.head.ref,[]);
  merged.get(p.head.ref).push(p);
 }
 return branches.filter(b=>b.name!==defaultBranch&&!b.protected&&!blocked.has(b.name)&&/^[a-f0-9]{40}$/.test(b.commit?.sha||''))
  .flatMap(b=>{
   const pr=(merged.get(b.name)||[]).find(p=>p.head.sha===b.commit.sha&&/^[a-f0-9]{40}$/.test(p.merge_commit_sha)&&isAncestor(p.merge_commit_sha));
   return pr?[{name:b.name,sha:b.commit.sha,pr:pr.number,mergedAt:pr.merged_at}]:[];
  }).sort((a,b)=>a.mergedAt.localeCompare(b.mergedAt)||a.name.localeCompare(b.name));
}
export function deletionArgs(candidate){
 const ref='refs/heads/'+candidate.name;
 if(candidate.name==='main'||!candidate.name||!(/^[a-f0-9]{40}$/.test(candidate.sha)))throw Error('Invalid candidate');
 return ['push','--force-with-lease='+ref+':'+candidate.sha,'origin',':'+ref];
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
function ancestor(sha){try{git('merge-base','--is-ancestor',sha,'HEAD');return true}catch{return false}}
function api(token){
 const base='https://api.github.com/repos/'+REPO;
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function get(path){
  const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error('API '+response.status);
  return {body:await response.json(),more:/rel="next"/.test(response.headers.get('link')||'')};
 }
 async function list(path,key){
  const out=[];
  for(let page=1;page<=30;page++){
   const {body,more}=await get(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page);
   const rows=key?body[key]:body;
   if(!Array.isArray(rows))throw Error('Incomplete API list');
   out.push(...rows);if(!more)return out;
  }
  throw Error('API pagination limit; refusing partial result');
 }
 return {get,list};
}
async function branchInventory(client){
 const [branches,closed,open]=await Promise.all([client.list('/branches'),client.list('/pulls?state=closed'),client.list('/pulls?state=open')]);
 return {branches,open,candidates:mergedCandidates(branches,closed,open,{isAncestor:ancestor})};
}
const fmt=n=>Number.isFinite(n)?(n/MB).toFixed(2)+' MB':'indisponível';
function metric(label,n,limits,bytes=true){
 return '| '+label+' | '+(bytes?fmt(n):Number.isFinite(n)?String(n):'indisponível')+' | '+severity(n,limits)+' |';
}
export async function monitor(client,{now=new Date()}={}){
 const sizes=treeSizes(git('ls-tree','-rlz','HEAD'));
 const output=['## Retenção e armazenamento','', 'Medição sem alteração de dados ou commits.','',
  '| Indicador | Medição | Situação |','|---|---:|---|',
  metric('Maior JSON',sizes.largestJson,LIMITS.json),metric('Base canônica',sizes.dataBytes,LIMITS.data)];
 let repoBytes=null,cacheBytes=null,branchCount=null,eligible=null,pagesBytes=null,artifactBytes=null,runCount=null;
 try{const {body}=await client.get('');if(Number.isFinite(body.size))repoBytes=body.size*1024}catch{}
 try{const {body}=await client.get('/actions/cache/usage');cacheBytes=body.active_caches_size_in_bytes??null}catch{}
 try{const info=await branchInventory(client);branchCount=info.branches.length;eligible=info.candidates.length}catch{}
 try{
  const artifacts=await client.list('/actions/artifacts','artifacts');
  const active=artifacts.filter(a=>!a.expired&&Date.parse(a.expires_at)>now.getTime());
  artifactBytes=active.reduce((n,a)=>n+(Number(a.size_in_bytes)||0),0);
  const latest=active.filter(a=>/^pages-/.test(a.name)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  if(latest)pagesBytes=latest.size_in_bytes;
 }catch{}
 try{const {body}=await client.get('/actions/runs?per_page=1');runCount=body.total_count??null}catch{}
 output.push(metric('Tamanho informado pelo GitHub',repoBytes,LIMITS.git),metric('Cache físico ativo',cacheBytes,LIMITS.cache),
  metric('Branches integradas elegíveis',eligible,LIMITS.branches,false),metric('Último artefato Pages ativo',pagesBytes,LIMITS.pages));
 const week=git('log','--since='+new Date(now.getTime()-7*86400000).toISOString(),'--format=%s','HEAD').trim().split('\n').filter(Boolean);
 const packs=git('count-objects','-v').split('\n');
 const kib=key=>Number(packs.find(l=>l.startsWith(key+': '))?.split(': ')[1]||0);
 output.push('','- Árvore atual: '+fmt(sizes.bytes)+'; '+sizes.files+' arquivos.',
  '- Git local (objetos soltos e packs do checkout completo): '+fmt((kib('size')+kib('size-pack'))*1024)+'. Não equivale ao uso físico remoto.',
  '- Commits em 7 dias: '+week.length+'; atualizações data: '+week.filter(x=>x.startsWith('data:')).length+'.',
  '- Branches totais: '+(branchCount??'indisponível')+'; execuções Actions: '+(runCount??'indisponível')+'.',
  '- Artefatos ativos (compactados): '+fmt(artifactBytes)+'.',
  '- Retenção de logs/artefatos do repositório informada ao runner: '+(process.env.GITHUB_RETENTION_DAYS||'indisponível')+' dias; proposta: 30.',
  '', '### Maiores JSONs','', '| Arquivo | Tamanho |','|---|---:|',
  ...sizes.largest.map(f=>'| '+f.path.replace(/[^A-Za-z0-9._/-]/g,'?')+' | '+fmt(f.bytes)+' |'),
  '', 'Limites são preventivos. Nenhum dado financeiro é excluído quando ultrapassados.');
 if(Number(process.env.GITHUB_RETENTION_DAYS)>30)output.push('::warning::Ajustar retenção nativa de logs para 30 dias nas configurações do repositório.');
 return output.join('\n');
}
export async function cleanup(client,{apply=false,limit=50,only=null}={}){
 const {branches,candidates}=await branchInventory(client);
 const selected=candidates.filter(b=>!only||b.name===only).slice(0,limit);
 const report={mode:apply?'apply':'dry-run',branches:branches.length,eligible:candidates.length,selected:selected.length,deleted:[],skipped:[],failed:[]};
 if(!apply){report.preview=selected;return report}
 for(const b of selected){
  try{
   // Refresh open PRs to avoid deleting a branch reused in another PR after inventory.
   const open=await client.list('/pulls?state=open');
   if(open.some(p=>p.head?.repo?.full_name===REPO&&p.head.ref===b.name||p.base?.repo?.full_name===REPO&&p.base.ref===b.name)){
    report.skipped.push({name:b.name,reason:'open_pr'});continue;
   }
   git('check-ref-format','refs/heads/'+b.name);
   // Atomic expected-tip lease: any new push to the branch prevents deletion.
   git(...deletionArgs(b));report.deleted.push(b);
  }catch{report.failed.push({name:b.name,sha:b.sha,reason:'lease_protection_or_api'});}
 }
 return report;
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!==REPO||!process.env.GH_TOKEN)throw Error('Unauthorized repository or token');
 const client=api(process.env.GH_TOKEN);
 if(process.argv.includes('--cleanup')){
  const report=await cleanup(client,{apply:process.env.RETENTION_APPLY==='true',only:process.env.RETENTION_BRANCH||null});
  console.log('## Limpeza de branches integradas\n\n```json\n'+JSON.stringify(report,null,2)+'\n```');
  if(report.failed.length)process.exitCode=1;
 }else console.log(await monitor(client));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Manutenção não concluída; sem divulgação de credenciais.');process.exitCode=1;});
