/** Painel carregado sob demanda, apenas um JSON agregado. */
const fmt=n=>new Intl.NumberFormat('pt-BR').format(n);
const dt=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'Não registrado';
const status={complete:'Encerrado conferido',open:'Consulta no mês aberto',unsealed:'Fechamento pendente',partial:'Parcial',unavailable:'Indisponível',missing:'Não consultado'};
const elem=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
function metricGrid(container,items){
 const grid=elem('div','quality-grid');for(const [label,value] of items){const box=elem('div','quality-metric');box.append(elem('strong','',value),elem('span','',label));grid.append(box)}container.append(grid);
}
function table(container,headers,rows){
 const wrap=elem('div','table-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',headers[0]==='Exercício'?'Cobertura por exercício':'Cobertura por competência');
 const t=elem('table'),head=elem('thead'),tr=elem('tr');
 for(const h of headers){const th=elem('th','',h);th.scope='col';tr.append(th)}head.append(tr);t.append(head);
 const body=elem('tbody');
 for(const values of rows){const row=elem('tr');for(const [i,v] of values.entries()){const cell=elem(i===0?'th':'td');if(i===0)cell.scope='row';if(v instanceof Node)cell.append(v);else cell.textContent=v;row.append(cell)}body.append(row)}t.append(body);wrap.append(t);container.append(wrap);
}
function fraction(n,d){return fmt(n)+' / '+fmt(d)}
function bar(n,d){const box=elem('div');const p=elem('progress');p.max=d||1;p.value=n;p.setAttribute('aria-label',fraction(n,d)+' dias completos');box.append(elem('span','',fraction(n,d)),p);return box}
function render(root,x){
 const c=x.cgu,p=x.procurement;
 root.replaceChildren(elem('p','helper','Referência: '+dt(x.asOf)+' · UG 158459 (CGU). PNCP inclui publicações do IFC; não presume execução por Araquari. Dias encerrados no fuso de Brasília.'));
 metricGrid(root,[['Dias completos (três fases)',fraction(c.completeDays,c.days)],['Cobertura diária',c.completePercent===null?'—':fmt(c.completePercent)+'%'],['Dias parcialmente consultados',fmt(c.partialDays)],['Dias sem consulta',fmt(c.missingDays)],['NEs de origem pendentes desde 2024',fmt(c.missingOrigins)],['Documentos recuperados',fmt(c.documents)]]);
 root.append(elem('h3','','Cobertura por exercício'));
 table(root,['Exercício','Dias completos','Empenhos (dias)','Liquidações (dias)','Pagamentos (dias)','Pendências de enriquecimento'],x.years.map(y=>[y.year,bar(y.completeDays,y.days),fraction(y.completePhases[0],y.days),fraction(y.completePhases[1],y.days),fraction(y.completePhases[2],y.days),fmt(y.pending)]));
 root.append(elem('h3','','Pendências de detalhamento CGU'));
 metricGrid(root,[['Vínculos de liquidações',fmt(c.pendingLiquidations)],['Vínculos de pagamentos',fmt(c.pendingPayments)],['Itens de empenho / revisão v2',fmt(c.pendingItems)],['Históricos de itens conhecidos',fmt(c.pendingHistories)],['Documentos sem descrição publicada',fmt(c.missingDescriptions)],['Liquidações para conferência de valor',fmt(c.liquidationReviews)]]);
 root.append(elem('p','helper','Referências a NEs anteriores ao corte: '+fmt(c.originsBeforeCutoff)+'. Não entram na fila de origem. Sobreposições entre fases: '+fmt(c.phaseObservations)+'. Nenhum destes indicadores constitui saldo ou conclusão de irregularidade.'));
 root.append(elem('h3','','Contratações e instrumentos'));
 metricGrid(root,[['Meses encerrados conferidos PNCP',fraction(p.pncpMonths,p.closedMonths)],['Meses encerrados conferidos Compras.gov',fraction(p.comprasMonths,p.closedMonths)],['Modalidades / meses encerrados PNCP',fraction(p.modalitiesComplete,p.modalitiesTotal)],['Contratos e instrumentos com consulta de NE pendente',fmt(p.commitmentLinksPending)],['Instrumentos sem contratação vinculada',fmt(p.purchaseLinksPending)],['Publicações SRP com atas consultadas',fraction(p.srpAtasChecked,p.srp)],['Publicações SRP com itens consultados',fraction(p.srpItemsChecked,p.srp)],['Atas com participação consultada',fraction(p.ataParticipationChecked,p.atas)],['Itens com resultados consultados',fraction(p.itemResultsChecked||0,p.tenderItems||0)],['Resultados PNCP recuperados',fmt(p.itemResults||0)],['Atas com itens Compras.gov identificados',fraction(p.arpItemsMatched||0,p.atas)],['Atas com instrumentos consultados',fraction(p.arpInstrumentChecks||0,p.atas)],['Vínculos ata–instrumento identificados',fmt(p.arpInstrumentLinks||0)],['Instrumentos decorrentes de adesões do IFC',fmt(p.ifcAdhesionInstruments||0)],['Instrumentos PNCP sem informação de adesão',fmt(p.adhesionUnknown||0)],['Itens com registros de unidade identificados',fmt(p.arpUnitItems||0)],['Itens com registro da UASG Araquari',fmt(p.arpCampusUnitItems||0)]]);
 root.append(elem('h3','','Atas de registro de preços · cobertura específica'));
 metricGrid(root,[['Atas catalogadas',fmt(p.atas)],['Itens de atas recuperados',fraction(p.arpItemsMatched||0,p.atas)],['Consultas de instrumentos',fraction(p.arpInstrumentChecks||0,p.atas)],['Listas de arquivos consultadas',fraction(p.arpFilesChecked||0,p.atas)],['Atas com arquivos oficiais',fmt(p.arpFilesAvailable||0)],['Links individuais PNCP',fmt(p.arpFileLinks||0)],['Registros item/fornecedor',fmt(p.arpItemRows||0)],['Atas sem detalhamento de itens',fmt(p.atas-(p.arpItemsMatched||0))]]);
 if(p.arpByYear?.length)table(root,['Exercício da compra','Atas','Participação','Itens','Instrumentos','Arquivos'],p.arpByYear.map(y=>[y.year,fmt(y.atas),fraction(y.participants,y.atas),fraction(y.items,y.atas),fraction(y.instruments,y.atas),fraction(y.files,y.atas)]));
 root.append(elem('p','helper','Última consulta de lista de atas gravada: '+dt(p.lastAtaCheck)+' · participação: '+dt(p.lastParticipationCheck)+'. Consultas completas vazias contam como consultadas, não como arquivos ou instrumentos disponíveis. PDFs permanecem exclusivamente no PNCP.'));
 if(x.integrated){
  const g=x.integrated;
  root.append(elem('h3','','Rastreabilidade integrada · acervo publicado'));
  metricGrid(root,[['NEs com referência integral conferida',fraction(g.confirmedCommitments,g.commitments)],
   ['Consultas CGU de documentos relacionados',fmt(g.relatedDocumentsChecked||0)],
   ['NEs com consulta de relacionados',fmt(g.relatedNeChecked||0)],
   ['Pares declarados pela CGU (relacionados)',fmt(g.cguRelatedPairs||0)],
   ['Vínculos documentais adicionais sem valor por NE',fmt(g.cguRelatedOnlyPairs||0)],
   ['NEs somente com indícios',fmt(g.indicatedCommitments)],['NEs com instrumentos concorrentes (sem alocação)',fmt(g.ambiguousCommitments)],
   ['Liquidações com origem NE confirmada',fmt(g.liquidationsWithConfirmedOrigin)],['Pagamentos com origem NE confirmada',fmt(g.paymentsWithConfirmedOrigin)],
   ['Instrumentos com contratação presente',fmt(g.instrumentsWithLocalPurchase)],
   ['Instrumentos com ata específica presente',fmt(g.instrumentsWithLocalAta)],
   ['Instrumentos com múltiplas atas declaradas',fmt(g.instrumentsWithMultipleAtas)],
   ['Itens NE com referência candidata de catálogo',fmt(g.neItemCandidates||0)],['Itens NE com ata e fornecedor coincidentes',fmt(g.neItemsWithAta||0)],
   ['Registros de item/fornecedor ARP com item licitado localizado',fmt(g.arpItemRowsWithTenderDescription||0)]]);
  root.append(elem('p','helper','Contagens únicas no acervo de '+fmt(g.loadedMonths)+' competências publicadas. Ausência de relação não prova inexistência de execução; não são saldos de contratos ou atas.'));
 }
 root.append(elem('h3','','Atualidade e procedência'));
 const meta=elem('div','coverage-meta');
 for(const line of ['CGU · data documental mais recente com fase completa: '+dt(c.lastCoveredDate),'CGU · última gravação canônica: '+dt(c.lastDataWrite),'PNCP · janela de atualizações globais até '+dt(p.deltaThrough)+'; '+fmt(p.pendingPublications)+' publicações pendentes de recuperação.','PNCP · última revisão individual registrada: contratos '+dt(p.lastContractRevisionRecorded)+'; licitações '+dt(p.lastNoticeRevisionRecorded),'PNCP/Compras · última gravação contratual: '+dt(p.lastContractsWrite)+'; publicações: '+dt(p.lastNoticesWrite)])meta.append(elem('div','',line));
 root.append(meta,elem('p','helper','Datas de gravação não são datas da última consulta bem-sucedida. Consultas sem mudança podem ficar apenas no cache operacional; a atualidade de cada registro ainda não é garantida. Consulte os registros das rotinas para tempos, falhas e reconsultas.'));
 const link=elem('a','inline-link','Acompanhar coletas e falhas no GitHub Actions');link.href='https://github.com/guimig/observatorio-despesas/actions';root.append(link);
 root.append(elem('h3','','Detalhamento por competência'));
 const control=elem('div','coverage-controls'),label=elem('label','field-label','Exercício'),select=elem('select');select.id='coverage-year';label.htmlFor=select.id;
 for(const y of [...x.years].reverse()){const option=elem('option','',y.year);option.value=y.year;select.append(option)}control.append(label,select);root.append(control);
 const target=elem('div');root.append(target);
 const show=()=>{target.replaceChildren();table(target,['Competência','Dias completos','NE / NS / PG (dias)','Dias parciais','Dias ausentes','PNCP contratos','Compras.gov','Modalidades PNCP concluídas'],x.months.filter(m=>m.month.startsWith(select.value)).slice().reverse().map(m=>[m.month,bar(m.completeDays,m.days),m.completePhases.map(fmt).join(' / '),fmt(m.partialDays),fmt(m.missingDays),status[m.pncp]||'Desconhecido',status[m.compras]||'Desconhecido',fmt(m.modalities.complete+m.modalities.open)+' / '+fmt(Object.values(m.modalities).reduce((n,v)=>n+v,0))]))};select.addEventListener('change',show);show();
}
const panel=document.getElementById('historical-coverage'),root=document.getElementById('coverage-content');let loaded=false,loading=false;
async function load(){
 if(loaded||loading||!panel?.open||!root)return;
 loading=true;root.replaceChildren(elem('p','helper','Carregando resumo de cobertura…'));
 try{const response=await fetch('./data/coverage-index.json',{cache:'no-store'});if(!response.ok)throw Error('http');
  const x=await response.json();if(x.schemaVersion!==1||x.unit!=='158459'||x.from!=='2024-01-01'||!Array.isArray(x.months)||!Array.isArray(x.years)||!x.cgu||!x.procurement)throw Error('schema');
  render(root,x);loaded=true;
 }catch{const retry=elem('button','button button-secondary','Tentar novamente');retry.type='button';retry.addEventListener('click',load);root.replaceChildren(elem('p','helper','Resumo de cobertura indisponível. Os dados mensais continuam acessíveis.'),retry)}
 finally{loading=false}
}
panel?.addEventListener('toggle',load);if(panel?.open)load();
