/** ARP: chaves oficiais PNCP, dados Compras.gov e instrumentos associados.
 * Fontes: PNCP 2.6 §§6.6,12.12; Compras.gov 2.0 §§11.1–11.4.
 * Nunca igualar homologacao, registro, saldo de item e execucao SIAFI.
 */
import {requestPublicJSON,CAMPUS_CNPJ,REITORIA_CNPJ} from './procurement.mjs';
import {ataUrl} from './pncp-atas.mjs';
import {inScopePurchaseId,inScopeDate} from './collection-scope.mjs';
import {validDay,stateKey} from './operational-state.mjs';
import {assertPublicSafe,maskCpf} from './privacy.mjs';
const BASE='https://dadosabertos.compras.gov.br/modulo-arp/';
const PURCHASE=/^10635424000186-1-\d{6}\/20\d{2}$/;
const CONTROL=/^(\d{14})-2-\d{6}\/(20\d{2})$/;
const pos=n=>Number.isSafeInteger(n)&&n>0;
const day=v=>typeof v==='string'&&validDay(v.slice(0,10))?v.slice(0,10):null;
const text=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const decimal=v=>{
 if(typeof v!=='number'&&typeof v!=='string')return null;
 const s=String(v);
 if(!/^\d{1,13}(?:\.\d{1,8})?$/.test(s)||!Number.isFinite(Number(s)))return null;
 return s.includes('.')?s.replace(/0+$/,'').replace(/\.$/,''):s;
};
export function officialAtaId(ata){
 if(!PURCHASE.test(ata?.procurementId)||!inScopePurchaseId(ata.procurementId)||!pos(ata.sequence)||
   ata.sequence>999999||ata.id!==ata.procurementId+':ata:'+ata.sequence)throw Error('Ata fora do recorte ou identidade invalida');
 return ata.procurementId+'-'+String(ata.sequence).padStart(6,'0');
}
const query=(path,params)=>BASE+path+'?'+new URLSearchParams(params);
export function comprasAtaUrls(ata,notice){
 const id=officialAtaId(ata);
 if(notice?.pncpId!==ata.procurementId||!['158125','158459'].includes(notice.unitCode)||
   !inScopeDate(ata.starts)||!validDay(ata.starts)||!/^\d{1,8}$/.test(text(notice.number)))
   throw Error('Faltam parametros oficiais para pesquisa da ata');
 const filters={codigoUnidadeGerenciadora:notice.unitCode,dataVigenciaInicialMin:ata.starts,
  dataVigenciaInicialMax:ata.starts,tamanhoPagina:'100'};
 return {id,manager:notice.unitCode,header:page=>query('1_consultarARP',{...filters,pagina:String(page)}),
  items:page=>query('2_consultarARPItem',{...filters,numeroCompra:text(notice.number),pagina:String(page)})};
}
/** Completeness: reject missing totals, changed pagination and partial pages. */
export async function allPages(url,{fetcher=requestPublicJSON,maxPages=8}={}){
 if(!pos(maxPages)||maxPages>20)throw Error('Limite invalido');
 const out=[];let total=null,pages=null;
 for(let page=1;page<=maxPages;page++){
  const b=await fetcher(url(page));
  const rows=b?.resultado??b?.data??b?.dados;
  const n=b?.totalRegistros, p=b?.totalPaginas;
  // requestPublicJSON maps HTTP 204 to this exact empty envelope.
  if(page===1&&Array.isArray(rows)&&!rows.length&&p===0&&n===undefined&&Array.isArray(b?.dados)&&Object.keys(b).every(k=>['dados','totalPaginas'].includes(k)))return [];
  // Explicitly empty result may use page zero or one; never accept nonempty data with zero totals.
  if(page===1&&Array.isArray(rows)&&!rows.length&&n===0&&[0,1].includes(p)&&
   (b.numeroPagina===undefined||[0,1].includes(Number(b.numeroPagina)))&&
   (b.paginasRestantes===undefined||Number(b.paginasRestantes)===0)&&b.empty!==false)return [];
  if(!Array.isArray(rows)||!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(p)||p<0||
   (total!==null&&n!==total)||(pages!==null&&p!==pages)||
   (b.numeroPagina!==undefined&&Number(b.numeroPagina)!==page)||
   (b.paginasRestantes!==undefined&&Number(b.paginasRestantes)!==Math.max(0,p-page)))
   throw Error('Paginacao divergente ou sem totais');
  total=n;pages=p;
   if(p<page||!rows.length)throw Error('Pagina vazia ou excedente');
  out.push(...rows);
  if(out.length>n)throw Error('Contagem excedente');
  if(page===p){if(out.length!==n)throw Error('Lista incompleta');return out}
 }
 throw Error('Limite de paginas; nenhum resultado parcial aceito');
}
function match(row,ata,manager){
 return row?.numeroControlePncpAta===officialAtaId(ata)&&row.numeroControlePncpCompra===ata.procurementId&&
  text(row.codigoUnidadeGerenciadora)===manager&&day(row.dataVigenciaInicial)===ata.starts;
}
function vendor(row){
 const v=text(row.niFornecedor);
 if(/^\d{14}$/.test(v))return {supplierCnpj:v};
 if(/^\d{11}$/.test(v)||/^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(v))return {supplierCpfMasked:maskCpf(v)};
 return {};
}
const itemKey=i=>[i.number,i.supplierCnpj||i.supplierCpfMasked||''].join('/');
export function normalizeArpItem(row){
 const item={number:Number(row.numeroItem),...vendor(row)};
 if(!pos(item.number)||(!item.supplierCnpj&&!item.supplierCpfMasked))throw Error('Item sem identidade de fornecedor');
 for(const [src,dst] of [['quantidadeHomologadaItem','homologatedItem'],['quantidadeHomologadaVencedor','homologatedSupplier'],
  ['quantidadeEmpenhada','committedQuantity'],['valorUnitario','unitPrice'],['valorTotal','totalPrice']]){
  const value=decimal(row[src]);if(value!==null)item[dst]=value;
 }
 if(typeof row.itemExcluido==='boolean')item.excluded=row.itemExcluido;
 if(Object.keys(item).length<=2)throw Error('Item sem dados materiais');
 return assertPublicSafe(item);
}
export async function scanComprasArp(ata,notice,{fetcher=requestPublicJSON,maxPages=8}={}){
 const urls=comprasAtaUrls(ata,notice);
 const headers=await allPages(urls.header,{fetcher,maxPages});
 const matches=headers.filter(r=>match(r,ata,urls.manager));
 if(matches.length!==1)return {ok:false,reason:matches.length?'ambiguous_header':'unmatched_header',rows:headers.length};
 const header=matches[0],number=text(header.numeroAtaRegistroPreco);
 if(!/^\d{1,10}(?:\/20\d{2})?$/.test(number))return {ok:false,reason:'unsupported_ata_number'};
 const raw=await allPages(urls.items,{fetcher,maxPages});
 const matching=raw.filter(r=>match(r,ata,urls.manager)&&text(r.numeroAtaRegistroPreco)===number);
 if(!matching.length)return {ok:false,reason:'unmatched_items',rows:raw.length};
 const items=matching.map(normalizeArpItem).sort((a,b)=>a.number-b.number||itemKey(a).localeCompare(itemKey(b)));
 if(new Set(items.map(itemKey)).size!==items.length)throw Error('Itens duplicados ou fornecedores indistinguiveis');
 const count=Number(header.quantidadeItens);
 if(!Number.isSafeInteger(count)||count<1||new Set(items.map(x=>x.number)).size!==count)
  return {ok:false,reason:'item_count_conflict',rows:matching.length};
 return {ok:true,data:{control:urls.id,number,manager:urls.manager,items},rows:matching.length};
}
/** Sondagem conservadora: os endpoints de saldo/unidade nao devolvem o controle PNCP.
 * Exigir numero de ata com exercicio. Nao persistir respostas nem afirmar saldo por nome.
 */
export async function inspectArpBalances(ata,compras,{fetcher=requestPublicJSON}={}){
 if(compras.control!==officialAtaId(ata)||!/^\d{1,10}\/20\d{2}$/.test(compras.number)||
   Number(compras.number.slice(-4))<2024||!['158125','158459'].includes(compras.manager))
  return {eligible:false,reason:'unqualified_ata_number'};
 const params={numeroAta:compras.number,unidadeGerenciadora:compras.manager,pagina:'1',tamanhoPagina:'100'};
 const inspect=async url=>{
  const body=await fetcher(url);
  const rows=body?.resultado??body?.data??body?.dados;
  if(!Array.isArray(rows))throw Error('Resposta nao reconhecida');
  return {rows:rows.length,pages:body.totalPaginas??null,fields:Object.keys(Object.fromEntries(rows.flatMap(r=>Object.keys(r||{}).filter(k=>/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(k)).map(k=>[k,true])))).sort(),
   exactCampus:rows.filter(r=>text(r.codigoUnidade)==='158459').length,
   exactReitoria:rows.filter(r=>text(r.codigoUnidade)==='158125').length};
 };
 const result={eligible:true};
 for(const [key,url] of [['units',query('3_consultarUnidadesItem',{...params,numeroItem:String(compras.items[0].number)})],
  ['balances',query('4_consultarEmpenhosSaldoItem',params)]]){
  try{result[key]=await inspect(url)}catch(e){result[key]={error:e.status?'http_'+e.status:'format'}}
 }
 return result;
}
/** Somente registros de unidades administrativas identificadas no cadastro Compras.gov.
 * quantidadeRegistrada pertence ao registro retornado, nao comprova reserva interna.
 * unidade no endpoint de saldo e unidade de medida; nunca interpretar como UASG.
 */
export function unitProbeUrl(ata,compras,number){
 if(compras.control!==officialAtaId(ata)||!/^\d{1,10}\/20\d{2}$/.test(compras.number)||
  Number(compras.number.slice(-4))<2024||!['158125','158459'].includes(compras.manager)||
  !pos(number)||!compras.items.some(i=>i.number===number))throw Error('Identidade de item de ata nao comprovada');
 return page=>query('3_consultarUnidadesItem',{numeroAta:compras.number,unidadeGerenciadora:compras.manager,
  numeroItem:String(number),pagina:String(page),tamanhoPagina:'100'});
}
export async function scanArpUnit(ata,compras,number,{fetcher=requestPublicJSON,maxPages=4}={}){
 const rows=await allPages(unitProbeUrl(ata,compras,number),{fetcher,maxPages});
 if(!rows.length)return {ok:false,reason:'empty'};
 const out=[],seen=new Set();
 for(const row of rows){
  if(text(row.numeroAta)!==compras.number||text(row.unidadeGerenciadora)!==compras.manager||
    Number(row.numeroItem)!==number)return {ok:false,reason:'identity_mismatch'};
  const code=text(row.codigoUnidade);
  if(!['158125','158459'].includes(code))continue;
  const registered=decimal(row.quantidadeRegistrada);
  if(registered===null||seen.has(code))return {ok:false,reason:'ambiguous_quantity'};
  seen.add(code);
  const item={unitCode:code,registered};
  const updated=day(row.dataHoraAtualizacao);
  if(updated&&inScopeDate(updated))item.sourceUpdatedAt=updated;
  out.push(item);
 }
 if(!out.length)return {ok:false,reason:'no_verified_ifc_unit'};
 return {ok:true,data:{number,units:out.sort((a,b)=>a.unitCode.localeCompare(b.unitCode))}};
}
export const unitProbeKey=(ata,compras,number)=>stateKey(['arp-unit-v2',ata.id,compras.control,compras.number,compras.manager,number]);
export function planArpUnitProbes(atas,details,{state={},now=new Date(),limit=6}={}){
 const byId=new Map(atas.map(a=>[a.id,a])),today=now.toISOString().slice(0,10),tasks=[];
 for(const d of details){
  const ata=byId.get(d.ataId),c=d.compras;
  if(!ata||!c||!/^\d{1,10}\/20\d{2}$/.test(c.number)||Number(c.number.slice(-4))<2024)continue;
  for(const number of [...new Set(c.items.map(i=>i.number))]){
   const key=unitProbeKey(ata,c,number),last=state[key];
   const known=d.unitItems?.some(x=>x.number===number);
   if(validDay(last)&&last<=today&&now.getTime()-Date.parse(last+'T00:00:00Z')<(known?30:7)*86400000)continue;
   tasks.push({ata,compras:c,number,key,last:last||'',known:Boolean(known)});
  }
 }
 // Uma ata por volta; priorizar itens nunca sondados.
 tasks.sort((a,b)=>Number(a.known)-Number(b.known)||a.last.localeCompare(b.last)||a.ata.id.localeCompare(b.ata.id)||a.number-b.number);
 const out=[],used=new Set();
 for(const t of tasks){if(out.length>=limit)break;if(used.has(t.ata.id))continue;out.push(t);used.add(t.ata.id)}
 for(const t of tasks){if(out.length>=limit)break;if(!out.includes(t))out.push(t)}
 return out;
}
export function applyArpUnit(detail,ata,entry){
 const old=detail.unitItems||[],previous=old.find(x=>x.number===entry.number);
 if(previous?.units.some(u=>!entry.units.some(v=>v.unitCode===u.unitCode)))throw Error('Unidade confirmada ausente');
 const next={...detail,unitItems:old.filter(x=>x.number!==entry.number).concat(entry).sort((a,b)=>a.number-b.number)};
 validateArpDetails([next],[ata]);
 return JSON.stringify(next)===JSON.stringify(detail)?detail:next;
}
export async function scanAtaInstruments(ata,{fetcher=requestPublicJSON,maxPages=8}={}){
 officialAtaId(ata);
 const rows=await allPages(page=>ataUrl(ata.procurementId)+'/'+ata.sequence+'/contratos?pagina='+page+'&tamanhoPagina=100',{fetcher,maxPages});
 const ids=new Set(),out=[];
 for(const row of rows){
  const id=text(row.numeroControle),m=CONTROL.exec(id);
  if(!m||Number(row.sequencialContrato)!==Number(id.slice(17,23))||text(row.orgaoEntidade?.cnpj)!==m[1])
   throw Error('Instrumento sem identidade oficial');
  if(ids.has(id))throw Error('Instrumento duplicado');ids.add(id);
  if(Number(m[2])<2024||![CAMPUS_CNPJ,REITORIA_CNPJ].includes(m[1]))continue;
  const r={pncpId:id};
  const unit=text(row.unidadeExecutora?.codigo);
  if(/^\d{6}$/.test(unit))r.unitCode=unit;
  if(typeof row.frutoAdesao==='boolean')r.adhesion=row.frutoAdesao;
  out.push(r);
 }
 return assertPublicSafe(out.sort((a,b)=>a.pncpId.localeCompare(b.pncpId)));
}
/** PNCP manual 2.6 §§12.9–12.10: list metadata only. Never request the binary endpoint. */
export async function scanAtaFiles(ata,{fetcher=requestPublicJSON}={}){
 officialAtaId(ata);
 const body=await fetcher(ataUrl(ata.procurementId)+'/'+ata.sequence+'/arquivos');
 const rows=Array.isArray(body)?body:body?.data??body?.dados;
 if(!Array.isArray(rows)||rows.length>1000)throw Error('Lista de arquivos ARP invalida');
 if(!Array.isArray(body)){
  const n=body.totalRegistros,p=body.totalPaginas;
  const synthetic=rows.length===0&&p===0&&n===undefined&&Array.isArray(body.dados)&&Object.keys(body).every(k=>['dados','totalPaginas'].includes(k));
  if(!synthetic&&!(Number.isSafeInteger(n)&&n===rows.length&&((p===0&&n===0)||p===1)))throw Error('Lista de arquivos ARP incompleta');
 }
 const seen=new Set(),files=[];
 for(const row of rows){
  const seq=Number(row?.sequencialDocumento);
  if(!pos(seq)||seq>999999||seen.has(seq))throw Error('Sequencial de arquivo ARP invalido ou duplicado');
  seen.add(seq);const f={seq};
  const type=Number(row.tipoDocumentoId);if(pos(type)&&type<=9999)f.type=type;
  const published=day(row.dataPublicacaoPncp);if(published&&inScopeDate(published))f.published=published;
  files.push(f);
 }
 return files.sort((a,b)=>a.seq-b.seq);
}
/** Per-run memoization only. Failed requests are not retained. Bounded by URL count. */
export function memoizedArpFetcher(fetcher=requestPublicJSON,limit=40){
 const cache=new Map();
 return async url=>{
  if(cache.has(url))return cache.get(url);
  const response=await fetcher(url);
  if(cache.size>=limit)cache.delete(cache.keys().next().value);
  cache.set(url,response);return response;
 };
}
export function arpFailureCategory(e){
 if(e?.status)return 'http_'+e.status;
 const msg=e?.message||'';
 const checks=[
  [/Paginacao divergente/,'pagination_conflict'],[/Pagina vazia|Contagem excedente|Lista incompleta|incompleta/,'incomplete_response'],
  [/Limite de paginas/,'page_limit'],[/identidade oficial/,'instrument_identity_conflict'],
  [/Instrumento duplicado/,'duplicate_instrument'],[/Item sem identidade/,'item_supplier_missing'],
  [/Item sem dados/,'item_data_missing'],[/Itens duplicados/,'duplicate_item'],
  [/Faltam parametros/,'missing_query_parameters'],[/ausente/,'previous_evidence_conflict'],
  [/arquivo ARP|arquivos ARP/,'file_metadata_conflict'],[/timeout|aborted/i,'timeout']
 ];
 return checks.find(([p])=>p.test(msg))?.[1]||'validation_or_conflict';
}
export function validateArpDetails(details,atas){
 if(!Array.isArray(details))throw Error('Detalhes ARP invalidos');
 const byId=new Map(atas.map(a=>[a.id,a])),seen=new Set();
 for(const d of details){
  const ata=byId.get(d.ataId);
  if(!ata||seen.has(d.ataId)||Object.keys(d).some(k=>!['ataId','compras','instruments','unitItems','files'].includes(k))||
    (!d.compras&&!Object.hasOwn(d,'instruments')&&!Object.hasOwn(d,'files')))throw Error('Evidencia de ata invalida');
  seen.add(d.ataId);officialAtaId(ata);
  if(d.compras){
   const c=d.compras;
   if(Object.keys(c).some(k=>!['control','number','manager','items'].includes(k))||c.control!==officialAtaId(ata)||
    !/^\d{1,10}(?:\/20\d{2})?$/.test(c.number)||!['158125','158459'].includes(c.manager)||!Array.isArray(c.items)||!c.items.length)
    throw Error('Vinculo Compras invalido');
   const keys=new Set();
   for(const i of c.items){
    if(!pos(i.number)||keys.has(itemKey(i))||(!i.supplierCnpj&&!i.supplierCpfMasked)||
     (i.supplierCnpj!==undefined&&!/^\d{14}$/.test(i.supplierCnpj))||
     (i.supplierCpfMasked!==undefined&&!/^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(i.supplierCpfMasked))||
     (i.supplierCnpj&&i.supplierCpfMasked)||Object.keys(i).some(k=>!['number','supplierCnpj','supplierCpfMasked','homologatedItem','homologatedSupplier','committedQuantity','unitPrice','totalPrice','excluded'].includes(k))||
     (i.excluded!==undefined&&typeof i.excluded!=='boolean')||
     ['homologatedItem','homologatedSupplier','committedQuantity','unitPrice','totalPrice'].some(k=>i[k]!==undefined&&(typeof i[k]!=='string'||decimal(i[k])!==i[k])))
      throw Error('Item ARP invalido');
    keys.add(itemKey(i));
   }
  }
  if(Object.hasOwn(d,'unitItems')){
   if(!d.compras||!Array.isArray(d.unitItems)||!d.unitItems.length)throw Error('Registro de unidade sem ata');
   const items=new Set();
   for(const entry of d.unitItems){
    if(!pos(entry.number)||items.has(entry.number)||!d.compras.items.some(i=>i.number===entry.number)||
     Object.keys(entry).some(k=>!['number','units'].includes(k))||!Array.isArray(entry.units)||!entry.units.length)
      throw Error('Unidade sem item identificado');
    items.add(entry.number);const codes=new Set();
    for(const u of entry.units){
     if(!['158125','158459'].includes(u.unitCode)||codes.has(u.unitCode)||typeof u.registered!=='string'||decimal(u.registered)!==u.registered||
      Object.keys(u).some(k=>!['unitCode','registered','sourceUpdatedAt'].includes(k))||
      (u.sourceUpdatedAt!==undefined&&(!validDay(u.sourceUpdatedAt)||!inScopeDate(u.sourceUpdatedAt))))throw Error('Quantidade de unidade invalida');
     codes.add(u.unitCode);
    }
   }
  }
  if(Object.hasOwn(d,'files')){
   if(!Array.isArray(d.files)||d.files.length>1000)throw Error('Arquivos ARP invalidos');
   const seqs=new Set();
   for(const f of d.files){
    if(!pos(f.seq)||f.seq>999999||seqs.has(f.seq)||Object.keys(f).some(k=>!['seq','type','published'].includes(k))||
     (f.type!==undefined&&(!pos(f.type)||f.type>9999))||
     (f.published!==undefined&&(!validDay(f.published)||!inScopeDate(f.published))))throw Error('Metadado de arquivo ARP invalido');
    seqs.add(f.seq);
   }
  }
  if(Object.hasOwn(d,'instruments')){
   if(!Array.isArray(d.instruments))throw Error('Instrumentos ARP invalidos');
   const keys=new Set();
   for(const i of d.instruments){
    const m=CONTROL.exec(i.pncpId);
    if(!m||Number(m[2])<2024||![CAMPUS_CNPJ,REITORIA_CNPJ].includes(m[1])||keys.has(i.pncpId)||
     Object.keys(i).some(k=>!['pncpId','unitCode','adhesion'].includes(k))||
     (i.unitCode!==undefined&&!/^\d{6}$/.test(i.unitCode))||(i.adhesion!==undefined&&typeof i.adhesion!=='boolean'))
      throw Error('Instrumento vinculado invalido');
    keys.add(i.pncpId);
   }
  }
 }
 return assertPublicSafe(details);
}
export function applyArpDetail(previous,ata,kind,value){
 const old=previous||{ataId:ata.id};
 if(!['compras','instruments','files'].includes(kind))throw Error('Tipo de evidencia invalido');
 // An incomplete or transiently empty list must not erase previously observed file links.
 if(kind==='files'&&old.files?.some(f=>!value.some(v=>v.seq===f.seq)))throw Error('Arquivo confirmado ausente; revalidar na fonte');
 if(kind==='instruments'&&old.instruments?.some(i=>!value.some(v=>v.pncpId===i.pncpId)))
  throw Error('Instrumento confirmado ausente; nao presumir cancelamento');
 if(kind==='compras'&&old.compras?.items.some(i=>!value.items.some(v=>itemKey(v)===itemKey(i))))
  throw Error('Item confirmado ausente; nao presumir exclusao');
 const next={...old,[kind]:value};
 // Se a identidade do numero da ata mudou, nao manter dados de unidade antigos.
 if(kind==='compras'&&old.compras&&(old.compras.number!==value.number||old.compras.manager!==value.manager))delete next.unitItems;
 validateArpDetails([next],[ata]);
 return JSON.stringify(next)===JSON.stringify(old)?old:next;
}
export const arpKey=(ata,kind)=>stateKey(['arp-details',kind,ata]);
export const arpFailureKey=(ata,kind)=>stateKey(['arp-failure',kind,ata.id]);
export function planArpDetails(atas,details,{kind,state={},now=new Date(),limit=5,slot=Math.floor(now.getTime()/14400000)}={}){
 if(!['compras','instruments','files'].includes(kind)||!pos(limit)||limit>(kind==='files'?50:10))throw Error('Plano invalido');
 const by=new Map(details.map(d=>[d.ataId,d])),today=now.toISOString().slice(0,10),groups=new Map();
 for(const a of atas){
  if(!inScopePurchaseId(a.procurementId))continue;
  const stamp=state[arpKey(a,kind)],known=Object.hasOwn(by.get(a.id)||{},kind);
  if(state[arpFailureKey(a,kind)]===today)continue;
  if(validDay(stamp)&&stamp<=today&&now.getTime()-Date.parse(stamp+'T00:00:00Z')<(known?30:7)*86400000)continue;
  if(!groups.has(a.procurementId))groups.set(a.procurementId,[]);
  groups.get(a.procurementId).push(a);
 }
 const out=[];
 // Exhaust unqueried records across purchases before routine revalidation. Rotate each four-hour slot.
 for(const known of [false,true]){
  const lists=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b))
   .map(([,g])=>g.filter(a=>Object.hasOwn(by.get(a.id)||{},kind)===known).sort((a,b)=>a.sequence-b.sequence)).filter(g=>g.length);
  const offset=(slot*limit)%Math.max(1,lists.length),ordered=lists.slice(offset).concat(lists.slice(0,offset));
  while(out.length<limit&&ordered.some(g=>g.length))for(const g of ordered){if(g.length)out.push(g.shift());if(out.length===limit)break}
 }
 return out;
}
