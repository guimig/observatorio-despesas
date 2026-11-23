import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
 liquidationUrl,paymentUrl,itemsUrl,publicItemDescription,normalizeItem,
 resolveLiquidationLinks,resolvePaymentLinks,resolveItems,classifyCguFailure
} from '../src/enrich-cgu.mjs';
import { planEnrichment, summarizeFailures, rotatePending, orderMonths, scheduledMonthSlot } from '../src/enrich-month.mjs';
import { emptyMonth, mergeMonth, applyDocumentEnrichment, validateMonth } from '../src/store.mjs';

const ne='158459000012026NE000001', ne2='158459000012026NE000002';
const ob='158459000012026OB000001', ob2='158459000012026OB000002';
const ns='158459000012026NS000001', ne3='158459000012026NE000003';
const result=(id,phase,cents=1000)=>({
 documents:[{id,date:'2026-11-18',phase,cents}],
 links:[],coverage:{date:'2026-11-18',phase,count:1,invalid:0,complete:true}
});
const wrap=(patches)=>mergeMonth(emptyMonth('2026-11'),'2026-11',patches).data;

test('URLs validadas, sem chave ou CPF, para pagamentos fase 3 e itens',()=>{
 const a=new URL(paymentUrl(ob,2));
 assert.equal(a.searchParams.get('fase'),'3');
 assert.equal(a.searchParams.get('pagina'),'2');
 assert.equal(a.searchParams.get('codigoDocumento'),ob);
 assert.equal(new URL(itemsUrl(ne)).pathname,'/api-de-dados/despesas/itens-de-empenho');
 assert.throws(()=>paymentUrl('00012345678'));
 assert.throws(()=>itemsUrl(ob));
});
test('URL de liquidação usa fase 2 e valida documento e página',()=>{
 const url=new URL(liquidationUrl(ns,3));
 assert.equal(url.searchParams.get('fase'),'2');
 assert.equal(url.searchParams.get('pagina'),'3');
 assert.equal(url.searchParams.get('codigoDocumento'),ns);
 assert.throws(()=>liquidationUrl('2026NS123'));
 assert.throws(()=>liquidationUrl(ns,0));
});
test('NS com três NEs, subitens e anulação preserva vínculos N:M',async()=>{
 const request=async(_,page)=>page===1?[
  {empenho:ne,subitem:'01',valorLiquidado:'100,00'},
  {empenho:ne,subitem:'02',valorLiquidado:'-10,00'},
  {empenho:ne2,subitem:'01',valorLiquidado:'30,00'},
  {empenho:ne3,subitem:'01',valorLiquidado:'20,00'}
 ]:[];
 const outcome=await resolveLiquidationLinks(ns,{token:'fake',request});
 assert.deepEqual(outcome,{ok:true,impacts:4,links:[
  {from:ns,to:ne,cents:9000},{from:ns,to:ne2,cents:3000},
  {from:ns,to:ne3,cents:2000}
 ]});
});
test('NS com consulta vazia não inventa saldo nem relação',async()=>{
 assert.deepEqual(await resolveLiquidationLinks(ns,{
  token:'fake',request:async()=>[]
 }),{ok:true,links:[],impacts:0});
});
test('NS com impacto ilegível, resposta repetida ou truncada não é concluída',async()=>{
 const row={empenho:ne,subitem:'01',valorLiquidado:'10,00'};
 assert.equal((await resolveLiquidationLinks(ns,{token:'fake',
  request:async()=>[row]})).reason,'pagina_repetida');
 assert.equal((await resolveLiquidationLinks(ns,{token:'fake',limit:1,
  request:async()=>[row]})).reason,'limite_paginacao');
 assert.equal((await resolveLiquidationLinks(ns,{token:'fake',
  request:async(_,page)=>page===1?[{...row,empenho:'2026NE000001'}]:[]
 })).reason,'impacto_nao_identificado');
 assert.equal((await resolveLiquidationLinks(ns,{token:'fake',
  request:async(_,page)=>page===1?[{...row,valorLiquidado:'invalid'}]:[]
 })).ok,false);
});
test('vínculos de pagamento somam normal + restos a pagar, subitens e sinais',async()=>{
 const request=async(_,page)=>page===1?[
  {empenho:ne,subitem:'01',valorPago:'100,00',valorRestoPago:'0,00'},
  {empenho:ne,subitem:'02',valorPago:'-10,00',valorRestoPago:'5,00'},
  {empenho:ne2,subitem:'01',valorPago:'0,00',valorRestoPago:'20,00'}
 ]:[];
 const res=await resolvePaymentLinks(ob,{token:'fake',request});
 assert.equal(res.ok,true);
 assert.equal(res.links.length,2);
 assert.deepEqual(res.links,[{from:ob,to:ne,cents:9500},{from:ob,to:ne2,cents:2000}]);
 assert.equal(res.impacts,3);
});
test('sem impacto é consulta concluída, sem presumir pagamento de valor zero',async()=>{
 const res=await resolvePaymentLinks(ob,{token:'fake',request:async()=>[]});
 assert.deepEqual(res,{ok:true,links:[],impacts:0});
});
test('resposta inválida, páginas repetidas, teto e identificação incorreta não são publicadas',async()=>{
 const row={empenho:ne,valorPago:'10,00',valorRestoPago:'0,00'};
 const repeated=await resolvePaymentLinks(ob,{token:'fake',request:async()=>[row]});
 assert.deepEqual(repeated,{ok:false,reason:'pagina_repetida'});
 const limited=await resolvePaymentLinks(ob,{token:'fake',limit:1,request:async()=>[row]});
 assert.equal(limited.ok,false);
 const unknown=await resolvePaymentLinks(ob,{token:'fake',request:async(_,page)=>
  page===1?[{...row,empenho:'OTHER-NE'}]:[]});
 assert.equal(unknown.reason,'impacto_nao_identificado');
 const invalid=await resolvePaymentLinks(ob,{token:'fake',request:async(_,page)=>
  page===1?[{...row,valorPago:'não numérico',valorRestoPago:null}]:[]});
 assert.equal(invalid.ok,false);
 const unavailable=await resolvePaymentLinks(ob,{token:'fake',request:async()=>{throw Error('erro remoto');}});
 assert.equal(unavailable.ok,false);
});
test('itens validam valor em centavos, sequência, descrição e subelemento',async()=>{
 const request=async(_,page)=>page===1?[
  {sequencial:1,codigoItemEmpenho:'001',codigoSubelemento:'33',
   descricaoSubelemento:'Material de consumo',descricao:'Tubos de ensaio 50 ml',
   valorAtual:'R$ 2.345,60'},
  {sequencial:2,codigoItemEmpenho:'002',codigoSubelemento:'33',
   descricaoSubelemento:'Material de consumo',descricao:'Produto sem preço',
   valorAtual:''}
 ]:[];
 const res=await resolveItems(ne,{token:'fake',request});
 assert.equal(res.ok,true);
 assert.equal(res.items.length,2);
 assert.deepEqual(res.items[0],{
  seq:1,code:'001',sub:'33',subdesc:'Material de consumo',
  description:'Tubos de ensaio 50 ml',cents:234560
 });
 assert.equal(Object.hasOwn(res.items[1],'cents'),false);
});
test('CPF, e-mail, telefone e dados bancários nunca passam em descrições livres',()=>{
 assert.equal(publicItemDescription('CPF 000.123.456-78'),null);
 assert.equal(publicItemDescription('Banco - conta corrente 1234'),null);
 assert.equal(publicItemDescription('email: servidor@example.com'),null);
 assert.equal(publicItemDescription('Contato (47) 99999-9999'),null);
 assert.equal(normalizeItem({sequencial:1,valorAtual:'4,50',descricao:'CPF 00012345678'}).description,undefined);
});
test('itens divergentes e paginação truncada mantêm estado de pendência',async()=>{
 const duplicate=await resolveItems(ne,{token:'fake',request:async(_,page)=>
  page===1?[{sequencial:1,valorAtual:'10,00'},{sequencial:1,valorAtual:'11,00'}]:[]});
 assert.equal(duplicate.ok,false);
 const limited=await resolveItems(ne,{token:'fake',limit:1,request:async()=>[{sequencial:1,valorAtual:'10,00'}]});
 assert.equal(limited.reason,'limite_paginacao');
});
test('aplicação incremental armazena vínculos e itens sem repetir entidades',()=>{
 const month=wrap([result(ne,1),result(ob,3)]);
 const a=applyDocumentEnrichment(month,ob,{kind:'payment',links:[{from:ob,to:ne,cents:900}]});
 assert.equal(a.changed,true);
 assert.equal(a.data.documents.find(d=>d.id===ob).paymentLinksChecked,true);
 assert.equal(a.data.relations.length,1);
 const b=applyDocumentEnrichment(a.data,ne,{kind:'items',items:[
  {seq:1,description:'Papel A4',cents:700}]});
 assert.equal(b.data.itemsByDocument[ne][0].description,'Papel A4');
 assert.equal(applyDocumentEnrichment(b.data,ne,{kind:'items',items:[
  {seq:1,description:'Papel A4',cents:700}]}).changed,false);
 assert.doesNotThrow(()=>validateMonth(b.data));
});
test('coleta diária idempotente preserva enriquecimentos de documentos inalterados',()=>{
 const base=wrap([result(ne,1),result(ob,3)]);
 let d=applyDocumentEnrichment(base,ob,{kind:'payment',links:[{from:ob,to:ne,cents:123}]}).data;
 d=applyDocumentEnrichment(d,ne,{kind:'items',items:[{seq:1,description:'Caderno'}]}).data;
 const fresh=mergeMonth(d,'2026-11',[result(ne,1),result(ob,3)]);
 assert.equal(fresh.changed,false);
 assert.equal(fresh.data.documents.find(item=>item.id===ob).paymentLinksChecked,true);
 assert.equal(fresh.data.relations[0].cents,123);
 assert.equal(fresh.data.itemsByDocument[ne].length,1);
});
test('retificação de valor invalida detalhes para reconsulta, sem conservar vínculo obsoleto',()=>{
 let data=wrap([result(ne,1),result(ob,3)]);
 data=applyDocumentEnrichment(data,ob,{kind:'payment',links:[{from:ob,to:ne,cents:123}]}).data;
 data=applyDocumentEnrichment(data,ne,{kind:'items',items:[{seq:1,description:'Caderno'}]}).data;
 const fresh=mergeMonth(data,'2026-11',[result(ne,1,2000),result(ob,3,2000)]);
 assert.equal(fresh.data.documents.find(item=>item.id===ob).paymentLinksChecked,undefined);
 assert.equal(fresh.data.relations.length,0);
 assert.equal(fresh.data.itemsByDocument,undefined);
});
test('enriquecimento NS não altera valor documental nem pagamento e é idempotente',()=>{
 let month=wrap([result(ne,1),result(ns,2,30000),result(ob,3)]);
 month=applyDocumentEnrichment(month,ob,{kind:'payment',
  links:[{from:ob,to:ne,cents:1000}]}).data;
 const links=[{from:ns,to:ne,cents:10000},{from:ns,to:ne2,cents:2000}];
 const enriched=applyDocumentEnrichment(month,ns,{kind:'liquidation',links});
 assert.equal(enriched.data.documents.find(d=>d.id===ns).cents,30000);
 assert.equal(enriched.data.documents.find(d=>d.id===ns).liquidationLinksChecked,true);
 assert.equal(enriched.data.relations.length,3);
 assert.equal(applyDocumentEnrichment(enriched.data,ns,{kind:'liquidation',links}).changed,false);
 assert.throws(()=>applyDocumentEnrichment(enriched.data,ns,{kind:'liquidation',links:[]}));
 assert.throws(()=>applyDocumentEnrichment(enriched.data,ob,{kind:'liquidation',links:[]}));
 const invalid=structuredClone(enriched.data);
 invalid.documents.find(d=>d.id===ns).liquidationLinksChecked=false;
 assert.throws(()=>validateMonth(invalid));
});
test('recoleta preserva NS e invalida seus vínculos na retificação',()=>{
 let month=wrap([result(ne,1),result(ns,2)]);
 month=applyDocumentEnrichment(month,ns,{kind:'liquidation',
  links:[{from:ns,to:ne,cents:1000}]}).data;
 const same=mergeMonth(month,'2026-11',[result(ns,2)]);
 assert.equal(same.changed,false);
 assert.equal(same.data.relations.length,1);
 const changed=mergeMonth(month,'2026-11',[result(ns,2,9999)]);
 assert.equal(changed.data.documents.find(d=>d.id===ns).liquidationLinksChecked,undefined);
 assert.equal(changed.data.relations.length,0);
});
test('planejamento só seleciona documentos pendentes, respeita limites',()=>{
 let d=wrap([result(ne,1),result(ob,3)]);
 assert.deepEqual(planEnrichment(d),{liquidations:[],payments:[ob],items:[ne],itemHistories:[]});
 d=applyDocumentEnrichment(d,ob,{kind:'payment',links:[]}).data;
 d=applyDocumentEnrichment(d,ne,{kind:'items',items:[]}).data;
 assert.deepEqual(planEnrichment(d),{liquidations:[],payments:[],items:[],itemHistories:[]});
 assert.throws(()=>planEnrichment(d,{maxPayments:1000}));
});

test('diagnóstico de falhas agrega motivos sem publicar documentos ou respostas',()=>{
 assert.deepEqual(summarizeFailures(['consulta_indisponivel','consulta_indisponivel',
 'pagina_repetida','erro remoto com documento sensível']),{
 consulta_indisponivel:2,pagina_repetida:1,outro:1});
});

test('classifica falhas HTTP sem vazar detalhes da resposta',()=>{
 assert.equal(classifyCguFailure(Error('CGU HTTP 429')),'consulta_indisponivel');
 assert.equal(classifyCguFailure(Error('CGU HTTP 503')),'consulta_indisponivel');
 assert.equal(classifyCguFailure(Error('CGU HTTP 403')),'acesso_negado');
 assert.equal(classifyCguFailure(Error('CGU HTTP 404')),'recurso_nao_encontrado');
 assert.equal(classifyCguFailure(Error('CGU retornou JSON inesperado')),'resposta_invalida');
});

test('rodadas rotativas distribuem tentativas sem excluir pendências',()=>{
 const docs=['a','b','c','d','e'];
 assert.deepEqual(rotatePending(docs,2,0),['a','b']);
 assert.deepEqual(rotatePending(docs,2,1),['c','d']);
 assert.deepEqual(rotatePending(docs,2,2),['e','a']);
 assert.deepEqual(rotatePending([],2,1),[]);
 assert.throws(()=>rotatePending(docs,2,-1));
});

test('competências são distribuídas por rodada, sem monopolização da mais antiga',()=>{
 const months=['2026-11','2025-12','2026-10'];
 assert.deepEqual(orderMonths(months,{priority:'round_robin',slot:0}),['2025-12','2026-10','2026-11']);
 assert.deepEqual(orderMonths(months,{priority:'round_robin',slot:1}),['2026-10','2026-11','2025-12']);
 assert.deepEqual(orderMonths(months,{priority:'round_robin',slot:2}),['2026-11','2025-12','2026-10']);
 assert.deepEqual(orderMonths(months,{priority:'newest'}),['2026-11','2026-10','2025-12']);
 assert.deepEqual(orderMonths([], {priority:'round_robin',slot:0}),[]);
});

test('rodízio por dia não fica preso no mesmo mês em três agendamentos',()=>{
 const months=['2025-12','2026-10','2026-11'];
 const first=scheduledMonthSlot('2026-11-20T12:17:00Z');
 assert.equal(scheduledMonthSlot('2026-11-20T22:17:00Z'),first);
 assert.equal(scheduledMonthSlot('2026-11-21T12:17:00Z'),first+1);
 assert.notDeepEqual(orderMonths(months,{priority:'round_robin',slot:first}),
   orderMonths(months,{priority:'round_robin',slot:first+1}));
 assert.throws(()=>scheduledMonthSlot('invalid'));
});

test('prioriza ultimo item de NE parcialmente concluida sem bloquear outros empenhos',()=>{
 const existing=wrap([result(ne,1),result(ne2,1)]);
 let data=applyDocumentEnrichment(existing,ne,{kind:'items',items:[
  {seq:1,cents:100},{seq:2,cents:200},{seq:3,cents:300},{seq:4,cents:400}
 ]}).data;
 data=applyDocumentEnrichment(data,ne2,{kind:'items',items:[
  {seq:1,cents:100},{seq:2,cents:200},{seq:3,cents:300}
 ]}).data;
 for(const seq of [1,2,3]){
  data=applyDocumentEnrichment(data,ne,{kind:'itemHistory',seq,
   movements:[{date:'2026-11-18',operation:'INCLUSAO',type:'original',
     quantity:'1.00',unitPrice:'1.00',cents:100}]}).data;
 }
 const plan=planEnrichment(data,{maxItems:1,maxItemHistories:3,slot:400});
 assert.deepEqual(plan.itemHistories[0],{id:ne,seq:4});
 assert.equal(plan.itemHistories.length,3);
 assert.equal(plan.itemHistories.filter(x=>x.id===ne2).length,2);
 assert.deepEqual(planEnrichment(data,{maxItems:1,maxItemHistories:1,slot:0})
   .itemHistories,[{id:ne,seq:4}]);
});

test('nenhuma nota parcialmente concluida deixa todos os slots em rodizio',()=>{
 let data=wrap([result(ne,1)]);
 data=applyDocumentEnrichment(data,ne,{kind:'items',items:[
  {seq:1,cents:100},{seq:2,cents:200},{seq:3,cents:300}
 ]}).data;
 const first=planEnrichment(data,{maxItemHistories:2,slot:0}).itemHistories;
 const second=planEnrichment(data,{maxItemHistories:2,slot:1}).itemHistories;
 assert.deepEqual(first,[{id:ne,seq:1},{id:ne,seq:2}]);
 assert.deepEqual(second,[{id:ne,seq:3},{id:ne,seq:1}]);
});
