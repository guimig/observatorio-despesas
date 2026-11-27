import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planLinkedInstruments,fetchLinkedInstrument} from '../src/recover-pncp-linked-instruments.mjs';
import {applyDirectInstrument,blankProcurement,validateProcurement} from '../src/procurement-store.mjs';
import {missingReferencedNe} from '../src/recover-cgu-originals.mjs';
const cnpj='10635424000186',id=cnpj+'-2-000123/2026',old=cnpj+'-2-000123/2023',other='12345678000190-2-000123/2026',now=new Date('2026-11-27T18:30:00Z');
const raw={numeroControlePNCP:id,orgaoEntidade:{cnpj},dataPublicacaoPncp:'2026-11-10',numeroContratoEmpenho:'12/2026',tipoContrato:{nome:'Contrato (termo inicial)'}};
test('fila reversa restringe IFC, recorte e deduplica',()=>{
 const details=[{instruments:[{pncpId:id,unitCode:'158459'},{pncpId:id},{pncpId:old},{pncpId:other}]}];
 assert.deepEqual(planLinkedInstruments(blankProcurement(),details),[id]);
 assert.deepEqual(planLinkedInstruments({contracts:[{pncpId:id}]},details),[]);
});
test('recuperação individual exige identidade integral e nunca marca cobertura completa',async()=>{
 const row=await fetchLinkedInstrument(id,{now,fetcher:async()=>raw});
 const base={...blankProcurement(),coverage:[{source:'pncp',month:'2026-11',status:'complete',count:0,skipped:0,closedMonth:true}]};
 const r=applyDirectInstrument(base,row,now);
 assert.equal(r.data.contracts.length,1);
 assert.deepEqual(r.data.coverage,[{source:'pncp',month:'2026-11',status:'partial',count:1,skipped:0}]);
 assert.equal(validateProcurement(r.data),r.data);
 assert.equal(applyDirectInstrument(r.data,row,now).changed,false);
 await assert.rejects(fetchLinkedInstrument(id,{now,fetcher:async()=>({...raw,numeroControlePNCP:other})}));
 await assert.rejects(fetchLinkedInstrument(old,{now,fetcher:async()=>raw}));
});
test('NE declarada no PNCP pode ser buscada, abreviação e pre-2024 não',()=>{
 const ne='158459000012026NE000001',legacy='158459000012023NE000001';
 const c={source:'pncp',commitmentRefs:[ne,legacy,'1584592026NE000002']};
 assert.deepEqual(missingReferencedNe([],{scope:'all',contracts:[c]}),[ne]);
 assert.deepEqual(missingReferencedNe([],{scope:'interannual',contracts:[c]}),[]);
});
