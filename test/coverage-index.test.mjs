import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoverageIndex} from '../src/coverage-index.mjs';
import {mergeMonth,emptyMonth} from '../src/store.mjs';
const now=new Date('2024-02-03T12:00:00Z');
test('indice inclui meses sem arquivo e separa fases, referencias anteriores e lacunas',()=>{
 const date='2024-01-01',doc={id:'158459264222024NS000001',date,phase:2,cents:100};
 const m=mergeMonth(emptyMonth('2024-01'),'2024-01',[{documents:[doc],links:[{from:doc.id,to:'158459264222023NE000001',cents:50},{from:doc.id,to:'158459264222024NE000002',cents:50}],coverage:{date,phase:2,complete:true,count:1,invalid:0}}],now).data;
 const index=buildCoverageIndex({months:[m],now,procurement:{coverage:[{month:'2024-01',source:'pncp',status:'complete'}]}});
 assert.equal(index.months.length,2);assert.equal(index.cgu.days,33);assert.equal(index.cgu.completeDays,0);
 assert.equal(index.cgu.partialDays,1);assert.equal(index.cgu.missingDays,32);assert.deepEqual(index.cgu.completePhases,[0,1,0]);
 assert.equal(index.cgu.missingOrigins,1);assert.equal(index.cgu.originsBeforeCutoff,1);assert.equal(index.cgu.pendingLiquidations,1);
 assert.equal(index.months[0].pncp,'unsealed');assert.equal(index.procurement.pncpMonths,0);
 assert.equal(index.months[1].compras,'missing');
 assert.ok(!JSON.stringify(index).includes(doc.id));
});
test('cobertura encerrada exige prova de fechamento e não inclui mes aberto no denominador PNCP',()=>{
 const index=buildCoverageIndex({months:[],now,procurement:{coverage:[{month:'2024-01',source:'pncp',status:'complete',closedMonth:true},{month:'2024-02',source:'pncp',status:'complete'}]}});
 assert.equal(index.procurement.closedMonths,1);assert.equal(index.procurement.pncpMonths,1);
 assert.equal(index.months[1].pncp,'open');assert.equal(index.cgu.missingDays,33);
});

test('cobertura de ARP separa consultas vazias, itens e links sem criar base duplicada',()=>{
 const p='10635424000186-1-000001/2024',a={id:p+':ata:1',procurementId:p,sequence:1},b={...a,id:p+':ata:2',sequence:2};
 const index=buildCoverageIndex({months:[],now,atas:{atas:[a,b],checks:[]},participants:{checks:[],details:[{ataId:a.id,files:[]},{ataId:b.id,files:[{seq:1}]}]}});
 assert.equal(index.procurement.arpFilesChecked,2);assert.equal(index.procurement.arpFilesAvailable,1);
 assert.equal(index.procurement.arpFileLinks,1);assert.equal(index.procurement.arpByYear[0].files,2);
 assert.equal(index.procurement.arpItemsMatched,0);
});
