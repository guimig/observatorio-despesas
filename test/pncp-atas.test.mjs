import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ataUrl,normalizeAta,scanAtas} from '../src/pncp-atas.mjs';
import {mergeAtas,emptyAtas,validateAtas} from '../src/pncp-atas-store.mjs';
import {planAtas,summarizeAtaCollection} from '../src/collect-pncp-atas.mjs';
const id='10635424000186-1-000001/2026';
const notice={pncpId:id,srp:true,published:'2026-11-10'};
test('ata vinculada ao ID oficial da compra, sem NE inferida',async()=>{
 assert.match(ataUrl(id),/\/compras\/2026\/1\/atas$/);
 const row={sequencialAta:3,numeroAtaRegistroPreco:'270/2026',
  dataVigenciaInicio:'2026-11-01',dataVigenciaFim:'2027-10-31',cancelado:false};
 const atas=await scanAtas(notice,{fetcher:async()=>[row]});
 assert.equal(atas[0].id,id+':ata:3');
 assert.equal(atas[0].ends,'2027-10-31');
 assert.equal('commitmentRefs' in atas[0],false);
 const merged=mergeAtas(emptyAtas(),[{procurementId:id,atas}],new Date('2026-11-20'));
 assert.equal(merged.checks[0].status,'complete');
 assert.equal(validateAtas(merged).atas.length,1);
});
test('SRP sem ata retornada e consulta valida, nao irregularidade',async()=>{
 const atas=await scanAtas(notice,{fetcher:async()=>[]});
 const merged=mergeAtas(emptyAtas(),[{procurementId:id,atas}],new Date('2026-11-20'));
 assert.equal(merged.atas.length,0);
 assert.equal(merged.checks.length,1);
});
test('resposta inesperada nao e interpretada como ausencia de ata',async()=>{
 await assert.rejects(scanAtas(notice,{fetcher:async()=>({data:[{sequencialAta:1}],totalPaginas:2,totalRegistros:2})}));
 assert.equal(normalizeAta({sequencialAta:0},id),null);
});
test('planejamento incremental prioriza compras nunca consultadas',()=>{
 const other={pncpId:'10635424000186-1-000002/2026',srp:true,published:'2026-11-09'};
 const checks=[{procurementId:id,status:'complete',checkedAt:'2026-10-01'}];
 assert.deepEqual(planAtas([notice,other],checks,new Date('2026-11-20'),1).map(n=>n.pncpId),[other.pncpId]);
 assert.equal(planAtas([notice],checks,new Date('2026-10-10')).length,0);
});

test('diagnostico separa SRP sem consulta de consultas vazias',()=>{
 const summary=summarizeAtaCollection({notices:[notice,{pncpId:'10635424000186-1-000002/2026',srp:true}],
  checks:[{procurementId:id,checkedAt:'2026-11-20',status:'complete'}],atas:[]},new Date('2026-11-21'));
 assert.deepEqual({srp:summary.srp,checked:summary.checked,unqueried:summary.unqueried,
  checkedWithoutAtas:summary.checkedWithoutAtas,atas:summary.atas},
  {srp:2,checked:1,unqueried:1,checkedWithoutAtas:1,atas:0});
});

test('aceita envelope PNCP completo, mas nao aceita resposta truncada',async()=>{
 const row={sequencialAta:7,numeroAtaRegistroPreco:'7/2026'};
 const atas=await scanAtas(notice,{fetcher:async()=>({data:[row],totalPaginas:1,totalRegistros:1})});
 assert.equal(atas[0].sequence,7);
 await assert.rejects(scanAtas(notice,{fetcher:async()=>({data:[],totalPaginas:1,totalRegistros:1})}));
});

test('envelope PNCP vazio com zero paginas e zero registros e resposta completa',async()=>{
 const result=await scanAtas(notice,{fetcher:async()=>({data:[],totalPaginas:0,totalRegistros:0})});
 assert.deepEqual(result,[]);
 await assert.rejects(scanAtas(notice,{fetcher:async()=>({data:[],totalPaginas:2,totalRegistros:0})}));
});
test('rotacao permite visitar SRPs posteriores mesmo com falhas persistentes',()=>{
 const notices=Array.from({length:5},(_,i)=>({pncpId:'10635424000186-1-'+String(i+1).padStart(6,'0')+'/2026',srp:true}));
 const first=planAtas(notices,[],new Date('2026-11-21'),2,0);
 const next=planAtas(notices,[],new Date('2026-11-21'),2,2);
 assert.equal(first.length,2);
 assert.equal(next.length,2);
 assert.equal(new Set([...first,...next].map(n=>n.pncpId)).size,4);
 assert.throws(()=>planAtas(notices,[],new Date(),2,-1));
});
