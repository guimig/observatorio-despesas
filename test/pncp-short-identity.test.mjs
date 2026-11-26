import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexLocalCommitments,auditShortCommitments} from '../src/pncp-short-identity.mjs';
import {fetchLinkedCommitments} from '../src/pncp-commitments.mjs';
const id='158459264222026NE000123',process='23349.004018/2026-92';
const c={source:'pncp',pncpId:'10635424000186-2-001685/2026',process};
const d={id,phase:1,partyRef:'12345678000190',date:'2026-11-10',process,cents:12345};
const row={numeroEmpenho:'2026NE000123',sequencialEmpenho:1,numeroPlanoInterno:'PI-1',
 tipoPessoa:'PJ',niCredorFornecedor:'12.345.678/0001-90',
 dataEmissaoEmpenho:'2026-11-10T10:00:00',valorTotal:123.45};
test('NE curta somente candidatos por criterios cumulativos, sem revelar identificadores',()=>{
 const index=indexLocalCommitments([d,{...d,id:'158459264222023NE000123'}]);
 const a=auditShortCommitments([row,{...row,numeroEmpenho:'2026NE999999'},
  {...row,tipoPessoa:'PF',niCredorFornecedor:'11122233344'},
  {...row,valorTotal:20}],c,index);
 assert.equal(a.shortRows,4);assert.equal(a.numberMatch,3);assert.equal(a.numberAndCreditor,2);
 assert.equal(a.numberCreditorDateProcess,2);assert.equal(a.uniqueAllIncludingValue,1);
 for(const value of [id,'PI-1','11122233344','12345678000190',process])
  assert.equal(JSON.stringify(a).includes(value),false);
});
test('PI de NE curta nao vira referencia nem detalhe publicado',async()=>{
 const r=await fetchLinkedCommitments(c,{includeDetails:true,shortIndex:indexLocalCommitments([d]),
 fetcher:async()=>({data:[row],totalPaginas:1,totalRegistros:1})});
 assert.deepEqual(r.refs,[]);assert.deepEqual(r.details,[]);
 assert.equal(r.shortAudit.uniqueAllIncludingValue,1);
});
