import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractCommitmentMetadata,validateCommitmentMetadata,extractContextualCommitments,validateContextualCommitments} from '../src/pncp-commitment-fields.mjs';
import {fetchLinkedCommitments} from '../src/pncp-commitments.mjs';
import {mergeProcurement,applyCommitmentResult,validateProcurement} from '../src/procurement-store.mjs';
import {planCommitmentChecks} from '../src/collect-pncp-commitments.mjs';
import {mergePncpRecord} from '../src/pncp-record-revisions.mjs';
const id='158459264222026NE000123',pncpId='10635424000186-2-001685/2026';
const c={id:'pncp:'+pncpId,pncpId,source:'pncp',scope:'ifc',orgCnpj:'10635424000186',
 publishedMonth:'2026-11',unitCode:'158125',process:'23349.004018/2026-92',number:'00123'};
const row={numeroEmpenho:id,sequencialEmpenho:1,numeroPlanoInterno:'IFC-0001',
 codigoNaturezaDespesa:'339030',codigoEmenda:'20260001',dataEmissaoEmpenho:'2026-11-10T10:00:00',
 valorTotal:123.45,valorSubItem:12.34,situacaoEmpenhoId:1,dataAtualizacao:'2026-11-20T10:00:00',
 niCredorFornecedor:'11122233344',nomeCredorFornecedor:'NAO PUBLICAR',
 emendaParlamentar:{codigoEmenda:'20260001',ano:2026,tipoEmenda:'Individual',nomeAutor:'Autor público',valorPago:'99999'}};
test('metadados por registro, sem somar totais e sem publicar identificadores pessoais',()=>{
 const {audit,details}=extractCommitmentMetadata([row,{...row,sequencialEmpenho:2,valorSubItem:45.67,numeroPlanoInterno:'IFC-0002'},
  {...row,numeroEmpenho:'2026NE000124',sequencialEmpenho:3},
  {...row,numeroEmpenho:'158125264222026NE000124',sequencialEmpenho:4},
  {...row,numeroEmpenho:'158459264222023NE000124',sequencialEmpenho:5}],c);
 assert.equal(audit.rows,5);assert.equal(audit.formats.fullCampus,2);
 assert.equal(audit.formats.shortOnly,1);assert.equal(audit.formats.otherUg,1);
 assert.equal(audit.formats.outOfScope,1);assert.equal(audit.fields.pi,5);
 assert.equal(details.length,2);assert.deepEqual(details.map(d=>d.pi),['IFC-0001','IFC-0002']);
 assert.equal(details[0].totalCents,12345);assert.equal(details[1].totalCents,12345);
 assert.equal(details[0].amendmentInfo.author,'Autor público');
 for(const secret of ['11122233344','NAO PUBLICAR','99999','158125264222026NE000124'])
  assert.equal(JSON.stringify({audit,details}).includes(secret),false);
 assert.equal(validateCommitmentMetadata(audit,details,[id]),true);
 assert.throws(()=>validateCommitmentMetadata(audit,details,[]));
 assert.throws(()=>extractCommitmentMetadata([row,{...row,numeroPlanoInterno:'OUTRO'}],c));
 assert.throws(()=>extractCommitmentMetadata([{...row,cnpj:'12345678901234'}],c));
 assert.equal(extractCommitmentMetadata([{...row,numeroPlanoInterno:'11122233344'}],c).details[0].pi,undefined);
});
test('consulta completa traz auditoria; truncada e total contraditorio bloqueiam dados',async()=>{
 const result=await fetchLinkedCommitments(c,{includeDetails:true,fetcher:async()=>({data:[row],totalPaginas:1,totalRegistros:1})});
 assert.equal(result.details[0].id,id);assert.equal(result.audit.fullWithPi,1);
 await assert.rejects(fetchLinkedCommitments(c,{includeDetails:true,maxPages:1,fetcher:async()=>({data:[row],totalPaginas:2})}),/incompleta/);
 await assert.rejects(fetchLinkedCommitments(c,{includeDetails:true,fetcher:async()=>({data:[row],totalPaginas:1,totalRegistros:2})}),/divergente/);
});
test('schema retrocompativel, planejamento reconsulta legado, persistencia e invalidacao',()=>{
 const original=mergeProcurement(null,[{source:'pncp',month:'2026-11',records:[c],status:'complete',skipped:0}]).data;
 const now=new Date('2026-11-26T12:00:00Z');
 const legacy=applyCommitmentResult(original,c.id,{status:'complete',refs:[]},now).data;
 assert.equal(planCommitmentChecks(legacy,{now,refreshDetails:true}).length,1);
 const {audit,details}=extractCommitmentMetadata([row],c);
 const result={status:'complete',refs:[id],audit,details};
 const next=applyCommitmentResult(legacy,c.id,result,now).data;
 validateProcurement(next);assert.equal(next.contracts[0].commitmentDetails[0].pi,'IFC-0001');
 assert.equal(applyCommitmentResult(next,c.id,result,now).changed,false);
 assert.equal(applyCommitmentResult(next,c.id,{status:'unavailable'},now).changed,false);
 assert.equal(planCommitmentChecks(next,{now,refreshDetails:true}).length,0);
 const same=mergeProcurement(next,[{source:'pncp',month:'2026-11',records:[c],status:'complete',skipped:0}]).data;
 assert.equal(same.contracts[0].commitmentDetails[0].pi,'IFC-0001');
 const changed=mergePncpRecord(next.contracts[0],{...c,number:'00999'},{kind:'contract',now}).record;
 assert.equal(changed.commitmentDetails,undefined);assert.equal(changed.commitmentAudit,undefined);
});

test('NE curta com cinco concordancias gera somente indicio contextual, nunca ref oficial',async()=>{
 const supplier='12345678000190',instrument={...c,supplierCnpj:supplier};
 const doc={id,phase:1,date:'2026-11-10',cents:12345,partyRef:supplier,process:c.process};
 const short={...row,numeroEmpenho:'2026NE000123',tipoPessoa:'PJ',niCredorFornecedor:supplier};
 const result=await fetchLinkedCommitments(instrument,{includeDetails:true,documents:[doc],fetcher:async()=>({data:[short],totalPaginas:1})});
 assert.deepEqual(result.refs,[]);assert.deepEqual(result.details,[]);
 assert.equal(result.context.length,1);assert.equal(result.context[0].pi,'IFC-0001');
 assert.equal(validateContextualCommitments(result.context,instrument),true);
 for(const bad of [{...doc,cents:1},{...doc,partyRef:'99999999000100'},{...doc,process:'23349.000000/2026-00'}])
  assert.deepEqual(extractContextualCommitments([short],instrument,[bad]),[]);
 assert.equal(extractContextualCommitments([short],instrument,[{...doc,date:'2026-11-09'}]).length,1);
 assert.equal(extractContextualCommitments([{...short,numeroPlanoInterno:null}],instrument,[doc])[0].pi,undefined);
 assert.deepEqual(extractContextualCommitments([short],instrument,[doc,{...doc,id:'158459999992026NE000123'}]),[]);
 assert.deepEqual(extractContextualCommitments([{...short,tipoPessoa:'PF'}],instrument,[doc]),[]);
 const original=mergeProcurement(null,[{source:'pncp',month:'2026-11',records:[instrument],status:'complete',skipped:0}]).data;
 const next=applyCommitmentResult(original,c.id,{status:'complete',refs:result.refs,audit:result.audit,details:result.details,context:result.context}).data;
 assert.equal(next.contracts[0].commitmentContext[0].id,id);
 assert.deepEqual(next.contracts[0].commitmentRefs,[]);
 assert.equal(applyCommitmentResult(next,c.id,{status:'unavailable'}).changed,false);
 assert.equal(mergePncpRecord(next.contracts[0],{...instrument,process:'23349.000000/2026-00'},{kind:'contract'}).record.commitmentContext,undefined);
});
