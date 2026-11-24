import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 beneficiaryYearUrl,requestBeneficiaryYearPage,checkBeneficiaryYear,
 diagnoseBeneficiaryYear2024
} from '../src/diagnose-cgu-2024-beneficiary-year.mjs';

const ne='158459264222024NE000123';
const ns='158459264222026NS000001';
const cnpj='12345678000195';
const sources=[{documents:[{id:ns,date:'2026-09-15',phase:2}],
 relations:[{from:ns,to:ne,cents:10000}],itemsByDocument:{}}];
const payload={
 documento:ne,codigoUg:'158459',fase:'Empenho',
 data:'2025-02-01',codigoFavorecido:cnpj,
 observacao:'CPF 111.222.333-44',
 valor:'123456,78'
};
const row=(id=ne,extra={})=>({
 documento:id,codigoUg:'158459',fase:'Empenho',
 data:'2025-02-01',nomeFavorecido:'PESSOA JURIDICA PUBLICA',
 ...extra
});
const response=(data,status=200)=>{
 const body=typeof data==='string'?data:JSON.stringify(data);
 return new Response(body,{status,headers:{'content-type':'application/json'}});
};
test('URL usa exclusivamente CNPJ, ano 2024, fase NE e UG 158459',()=>{
 const url=new URL(beneficiaryYearUrl(cnpj,'2024',1));
 assert.equal(url.pathname,'/api-de-dados/despesas/documentos-por-favorecido');
 assert.equal(url.searchParams.get('codigoPessoa'),cnpj);
 assert.equal(url.searchParams.get('ano'),'2024');
 assert.equal(url.searchParams.get('fase'),'1');
 assert.equal(url.searchParams.get('ug'),'158459');
 assert.equal(url.searchParams.get('pagina'),'1');
 assert.throws(()=>beneficiaryYearUrl('12345678901','2024',1));
 assert.throws(()=>beneficiaryYearUrl(cnpj,'2024',5));
 assert.throws(()=>beneficiaryYearUrl(cnpj,'2024NE',1));
});
test('correspondencia por ID completo na consulta ano 2024 nao atribui dia de emissao',async()=>{
 const seen=[];
 const result=await diagnoseBeneficiaryYear2024({
   sources,token:'SECRET_PRIVADO',
   fetchDetail:async id=>{assert.equal(id,ne);return payload;},
   requestPage:async(p,year,page,options)=>{
     seen.push({year,page});
     assert.equal(p,cnpj);
     assert.equal(options.token,'SECRET_PRIVADO');
     return [row()];
   }
 });
 assert.deepEqual(seen,[{year:'2024',page:1}]);
 assert.equal(result.status,'observed');
 assert.equal(result.detailDataClass,'after_ne_year');
 assert.equal(result.byEmissionYear.status,'exact_match_in_year_filter');
 assert.equal(result.byEmissionYear.yearConfirmed,true);
 assert.equal(result.byEmissionYear.returnedDataClass,'after_ne_year');
 assert.equal(result.byEmissionYear.returnedEmissionClass,'not_provided');
 assert.equal(result.originRecorded,false);
 for(const privateValue of [cnpj,ne,'SECRET_PRIVADO','2025-02-01',
   '111.222.333-44','123456,78'])
   assert.equal(JSON.stringify(result).includes(privateValue),false);
});
test('ausencia ou CPF impede consultar por pessoa',async()=>{
 let called=0;
 for(const id of ['123.456.789-01',null]){
   const result=await diagnoseBeneficiaryYear2024({
     sources,token:'SECRET',
     fetchDetail:async()=>({...payload,codigoFavorecido:id}),
     requestPage:async()=>{called++;throw Error('Nao consultar por CPF');}
   });
   assert.equal(result.status,'beneficiary_cnpj_unavailable');
 }
 assert.equal(called,0);
});
test('paginacao completa e truncada nao confundem ausencia e falha',async()=>{
 const notFound=await checkBeneficiaryYear(ne,cnpj,{
   token:'SECRET',requestPage:async(_p,_y,page)=>
     page===1?[row('158459264222024NE000124')]:[]
 });
 assert.equal(notFound.status,'complete_no_match');
 assert.equal(notFound.pagesConsulted,2);
 assert.equal(notFound.yearConfirmed,false);
 const truncated=await checkBeneficiaryYear(ne,cnpj,{token:'SECRET',
   maxPages:2,requestPage:async(_p,_y,page)=>
     [row('158459264222024NE'+String(100+page).padStart(6,'0'))]
 });
 assert.equal(truncated.status,'pagination_incomplete');
 assert.equal(truncated.yearConfirmed,false);
 const repeated=await checkBeneficiaryYear(ne,cnpj,{
   token:'SECRET',requestPage:async()=>[row('158459264222024NE000124')]
 });
 assert.equal(repeated.status,'repeated_page');
 assert.equal(repeated.yearConfirmed,false);
});
test('identidade divergente, formato invalido ou erro HTTP bloqueiam ateste',async()=>{
 for(const other of [{codigoUg:'158125'},{fase:'Pagamento'}]){
   const result=await checkBeneficiaryYear(ne,cnpj,{
     token:'SECRET',requestPage:async()=>[row(ne,other)]
   });
   assert.equal(result.status,'identity_conflict');
   assert.equal(result.yearConfirmed,false);
 }
 const invalid=await checkBeneficiaryYear(ne,cnpj,{
   token:'SECRET',requestPage:async()=>({data:[]})
 });
 assert.equal(invalid.status,'invalid_page');
 const denied=await checkBeneficiaryYear(ne,cnpj,{
   token:'SECRET',requestPage:async()=>{
     const e=Error('CPF 000.111.222-33');e.status=403;throw e;
   }
 });
 assert.equal(denied.status,'unavailable');
 assert.equal(denied.reason,'authentication_required');
 assert.equal(JSON.stringify(denied).includes('CPF'),false);
});
test('endpoint CGU: timeout/redirecionamento, JSON malformado e tamanho máximo',async()=>{
 const valid=await requestBeneficiaryYearPage(cnpj,'2024',1,{
   token:'SECRET',
   fetchFn:async(url,options)=>{
     assert.match(url,/documentos-por-favorecido/);
     assert.equal(options.headers['chave-api-dados'],'SECRET');
     assert.equal(options.redirect,'error');
     return response([row()]);
   }
 });
 assert.equal(valid.length,1);
 assert.equal(valid[0].documento,ne);
 await assert.rejects(requestBeneficiaryYearPage(cnpj,'2024',1,{
   token:'SECRET',fetchFn:async()=>response('Access denied',403)
 }),e=>e.status===403);
 await assert.rejects(requestBeneficiaryYearPage(cnpj,'2024',1,{
   token:'SECRET',fetchFn:async()=>response('not-json')
 }),e=>e.code==='invalid_json');
 await assert.rejects(requestBeneficiaryYearPage(cnpj,'2024',1,{
   token:'SECRET',fetchFn:async()=>response({a:1})
 }),e=>e.code==='invalid_shape');
 await assert.rejects(requestBeneficiaryYearPage(cnpj,'2024',1,{
   token:'SECRET',fetchFn:async()=>response('X'.repeat(400000))
 }),e=>e.code==='too_large');
});
test('sem pendencia de 2024 nao aciona endpoints; fase/UG invalidas não permitem consulta',async()=>{
 const none=await diagnoseBeneficiaryYear2024({sources:[{
   documents:[],relations:[],itemsByDocument:{}
 }]});
 assert.deepEqual(none,{status:'no_pending',pending:0});
 const ambiguous=await diagnoseBeneficiaryYear2024({sources:[{
   documents:[{id:ns,date:'2026-09-15',phase:2}],
   relations:[{from:ns,to:ne},{from:ns,to:'158459264222024NE000124'}]
 }]});
 assert.deepEqual(ambiguous,{status:'ambiguous',pending:2});
 const invalid=await diagnoseBeneficiaryYear2024({
   sources,token:'SECRET',fetchDetail:async()=>({...payload,codigoUg:'158125'}),
   requestPage:async()=>{throw Error('Nao consultar apos UG divergente');}
 });
 assert.equal(invalid.status,'identity_unverified');
 const noToken=await diagnoseBeneficiaryYear2024({sources,token:''});
 assert.equal(noToken.status,'credential_unavailable');
});

test('ano posterior observado e consultado sozinho; match nao confirma emissao',async()=>{
 const seen=[];
 const result=await diagnoseBeneficiaryYear2024({
   sources,token:'SECRET_PRIVADO',detailYearOnly:true,
   fetchDetail:async()=>payload,
   requestPage:async(p,year,page,options)=>{
     seen.push({year,page});
     assert.equal(p,cnpj);
     assert.equal(options.token,'SECRET_PRIVADO');
     return [row()];
   }
 });
 assert.deepEqual(seen,[{year:'2025',page:1}]);
 assert.equal(result.status,'observed');
 assert.equal(result.byEmissionYear,undefined);
 assert.equal(result.byDetailYear.status,'exact_match_in_detail_year_filter');
 assert.equal(result.byDetailYear.yearConfirmed,false);
 assert.equal(result.byDetailYear.returnedDataClass,'after_ne_year');
 assert.equal(result.byDetailYear.returnedDataMatchesFilter,true);
 assert.equal(result.originRecorded,false);
 for(const secret of [cnpj,ne,'SECRET_PRIVADO','2025-02-01','111.222.333-44'])
   assert.equal(JSON.stringify(result).includes(secret),false);
});
test('indice posterior vazio, falha ou limite preservam a pendencia',async()=>{
 for(const [requestPage,status] of [
   [async()=>[],'complete_no_match'],
   [async()=>{const e=Error('SEGREDO');e.status=429;throw e;},'unavailable'],
   [async(_p,_y,page)=>[row('158459264222025NE'+String(page).padStart(6,'0'))],
     'pagination_incomplete']
 ]){
   const result=await diagnoseBeneficiaryYear2024({
     sources,token:'SECRET',detailYearOnly:true,
     fetchDetail:async()=>payload,requestPage
   });
   assert.equal(result.byDetailYear.status,status);
   assert.equal(result.byDetailYear.yearConfirmed,false);
   assert.equal(result.originRecorded,false);
   assert.equal(JSON.stringify(result).includes('SEGREDO'),false);
 }
});
test('comparacao posterior bloqueia data nao posterior, invalida, futura e CPF',async()=>{
 let called=0;
 for(const data of ['2024-12-01','2025-02-30','2099-01-01',null]){
   const result=await diagnoseBeneficiaryYear2024({
     sources,token:'SECRET',detailYearOnly:true,
     fetchDetail:async()=>({...payload,data}),
     requestPage:async()=>{called++;return [];}
   });
   assert.equal(result.status,'detail_year_not_later');
   assert.equal(result.originRecorded,false);
 }
 const result=await diagnoseBeneficiaryYear2024({
   sources,token:'SECRET',detailYearOnly:true,
   fetchDetail:async()=>({...payload,codigoFavorecido:'12345678901'}),
   requestPage:async()=>{called++;return [];}
 });
 assert.equal(result.status,'beneficiary_cnpj_unavailable');
 assert.equal(called,0);
});
test('match posterior com campo data divergente nao confirma o filtro semantico',async()=>{
 const result=await checkBeneficiaryYear(ne,cnpj,{
   token:'SECRET',queryYear:'2025',
   requestPage:async()=>[row(ne,{data:'2024-12-01',dataEmissao:'2024-12-01'})]
 });
 assert.equal(result.status,'exact_match_in_detail_year_filter');
 assert.equal(result.yearConfirmed,false);
 assert.equal(result.returnedDataMatchesFilter,false);
 assert.equal(result.returnedEmissionClass,'same_ne_year');
 await assert.rejects(checkBeneficiaryYear(ne,cnpj,{
   queryYear:'2023',requestPage:async()=>{throw Error('Nao consultar');}
 }));
});
