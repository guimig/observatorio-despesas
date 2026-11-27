import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('../scripts/push-validated-data.sh',import.meta.url));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'safe-push-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const bare=join(root,'remote.git'),seed=join(root,'seed'),a=join(root,'a'),b=join(root,'b');
 git(root,'init','--bare','--initial-branch=main',bare);
 git(root,'clone',bare,seed);
 const configure=cwd=>{git(cwd,'config','user.name','Test');git(cwd,'config','user.email','test@example.invalid')};
 configure(seed);
 await mkdir(join(seed,'data','procurement'),{recursive:true});
 await mkdir(join(seed,'data','months'),{recursive:true});
 await writeFile(join(seed,'data/months/2024-01.json'),'initial\n');
 await writeFile(join(seed,'data/procurement/contracts.json'),'initial\n');
 await writeFile(join(seed,'package.json'),JSON.stringify({scripts:{test:'node -e "process.exit(0)"','check:data':'node -e "process.exit(0)"'}}));
 git(seed,'add','.');git(seed,'commit','-m','initial');git(seed,'push','origin','HEAD:main');
 git(root,'clone',bare,a);git(root,'clone',bare,b);configure(a);configure(b);
 return {bare,a,b};
}
async function commit(cwd,file,value){await writeFile(join(cwd,file),value+'\n');git(cwd,'add',file);git(cwd,'commit','-m','data update')}
test('dois coletores com arquivos disjuntos preservam ambos os commits apos rebase',async t=>{
 const {bare,a,b}=await fixture(t),cgu='data/months/2024-01.json',pncp='data/procurement/contracts.json';
 await commit(a,cgu,'cgu');await commit(b,pncp,'pncp');
 git(b,'push','origin','HEAD:main');
 const r=spawnSync('bash',[script],{cwd:a,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(git(bare,'show','main:'+cgu),'cgu');
 assert.equal(git(bare,'show','main:'+pncp),'pncp');
});
test('alteracoes concorrentes no mesmo arquivo nao sobrescrevem o remoto',async t=>{
 const {bare,a,b}=await fixture(t),file='data/months/2024-01.json';
 await commit(a,file,'local');await commit(b,file,'remote');
 git(b,'push','origin','HEAD:main');
 const r=spawnSync('bash',[script],{cwd:a,encoding:'utf8'});
 assert.notEqual(r.status,0);
 assert.equal(git(bare,'show','main:'+file),'remote');
});

test('coleta com outro arquivo de dados nao staged nao publica commit parcial',async t=>{
 const {bare,a}=await fixture(t),file='data/months/2024-01.json';
 await commit(a,file,'local');await writeFile(join(a,'data/procurement/contracts.json'),'pendente\n');
 const r=spawnSync('bash',[script],{cwd:a,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/pendentes de stage/);assert.equal(git(bare,'show','main:'+file),'initial');
});
