import {test} from 'node:test';
import assert from 'node:assert/strict';
import {treeSizes,mergedCandidates,deletionArgs,severity,LIMITS} from '../src/retention-maintenance.mjs';
const repo='guimig/observatorio-despesas',sha='a'.repeat(40),merge='b'.repeat(40);
const branch=(name,tip=sha,protectedRef=false)=>({name,commit:{sha:tip},protected:protectedRef});
const pr=(name,extra={})=>({number:1,merged_at:'2026-11-22T00:00:00Z',merge_commit_sha:merge,head:{ref:name,sha,repo:{full_name:repo}},base:{ref:'main',repo:{full_name:repo}},...extra});
test('limpeza somente de head exato de PR integrado a main; protege novas alteracoes e PR aberto',()=>{
 const branches=[branch('main'),branch('merged'),branch('changed','c'.repeat(40)),branch('protected',sha,true),branch('open'),branch('base-open'),branch('not-merged'),branch('other-base'),branch('fork'),branch('unreachable'),branch('unrelated')];
 const closed=[pr('main'),pr('merged'),pr('changed'),pr('protected'),pr('open'),pr('base-open'),pr('not-merged',{merged_at:null}),pr('other-base',{base:{ref:'dev',repo:{full_name:repo}}}),pr('fork',{head:{ref:'fork',sha,repo:{full_name:'another/repo'}}}),pr('unreachable',{merge_commit_sha:'d'.repeat(40)})];
 const open=[pr('open',{merged_at:null}),{head:{ref:'other',repo:{full_name:'another/repo'}},base:{ref:'base-open',repo:{full_name:repo}}}];
 assert.deepEqual(mergedCandidates(branches,closed,open,{isAncestor:s=>s===merge}).map(b=>b.name),['merged']);
 assert.deepEqual(deletionArgs({name:'merged',sha}),['push','--force-with-lease=refs/heads/merged:'+sha,'origin',':refs/heads/merged']);
 assert.throws(()=>deletionArgs({name:'main',sha}));
});
test('tamanho real da arvore e limites sem promover arquivo a exclusao',()=>{
 const raw='100644 blob '+sha+' 750000\tdata/months/2026-01.json\0'+'100644 blob '+sha+' 1234\tassets/app.js\0';
 const s=treeSizes(raw);assert.equal(s.bytes,751234);assert.equal(s.dataBytes,750000);assert.equal(s.files,2);
 assert.equal(severity(s.largestJson,LIMITS.json),'alerta');
 assert.equal(severity(1000000,LIMITS.json),'revisar');
 assert.equal(severity(null,LIMITS.git),'indisponível');
});
