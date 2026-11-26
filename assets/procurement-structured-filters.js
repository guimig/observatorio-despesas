/** Filtros tipados sobre campos ja normalizados; valores monetarios em centavos. */
export function isValidDay(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validRange(from='',to=''){
 return (!from||isValidDay(from))&&(!to||isValidDay(to))&&(!from||!to||from<=to);
}
export function dateRangeMatch(value,from='',to='',monthOnly=false){
 if(!validRange(from,to))return false;
 if(!from&&!to)return true;
 if(monthOnly){
  if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))return false;
  return (!from||value>=from.slice(0,7))&&(!to||value<=to.slice(0,7));
 }
 return isValidDay(value)&&(!from||value>=from)&&(!to||value<=to);
}
export function validityStatus(record,today){
 if(record?.cancelled===true)return 'cancelled';
 if(!isValidDay(today)||!isValidDay(record?.starts)||!isValidDay(record?.ends)||record.starts>record.ends)return 'unknown';
 if(record.ends<today)return 'expired';
 if(record.starts>today)return 'future';
 return 'current';
}
export function filterDates(record,{dateKind='signed',dateFrom='',dateTo='',dueFrom='',dueTo='',activeOn='',validity='all',today=''}={}){
 if(!dateRangeMatch(record[dateKind],dateFrom,dateTo,dateKind==='publishedMonth'))return false;
 if(!dateRangeMatch(record.ends,dueFrom,dueTo))return false;
 if(activeOn&&validityStatus(record,activeOn)!=='current')return false;
 if(validity!=='all'&&validityStatus(record,today)!==validity)return false;
 return true;
}
export function filterStructuredNotice(n,{srp='all',minCents=null,maxCents=null,...dates}={}){
 if(!filterDates(n,{dateKind:'published',...dates}))return false;
 if(srp==='yes'&&n.srp!==true||srp==='no'&&n.srp!==false)return false;
 const value=n.estimatedCents;
 if(minCents!==null||maxCents!==null){
  if(!Number.isSafeInteger(value))return false;
  if(minCents!==null&&value<minCents||maxCents!==null&&value>maxCents)return false;
 }
 return true;
}
export function filterStructuredContract(c,{minCents=null,maxCents=null,...dates}={}){
 if(!filterDates(c,dates))return false;
 if(minCents!==null||maxCents!==null){
  if(!Number.isSafeInteger(c.amountCents))return false;
  if(minCents!==null&&c.amountCents<minCents||maxCents!==null&&c.amountCents>maxCents)return false;
 }
 return true;
}
export function parseReaisFilter(value){
 const raw=String(value??'').trim();
 if(!raw)return null;
 const normalized=/^\d{1,3}(?:\.\d{3}){1,3},\d{1,2}$/.test(raw)?raw.replace(/\./g,''):raw;
 if(!/^\d{1,12}(?:[.,]\d{1,2})?$/.test(normalized))return null;
 const n=Number(normalized.replace(',','.'));
 const cents=Math.round(n*100);
 return Number.isSafeInteger(cents)?cents:null;
}

/** Aderente e o titular do instrumento PNCP; nao o gerenciador da ata. */
export function isIfcAdhesion(c){
 return c?.source==='pncp'&&c.adhesion===true&&['10635424000186','10635424000348'].includes(c.orgCnpj)&&
  typeof c.pncpId==='string'&&c.pncpId.startsWith(c.orgCnpj+'-2-');
}


export function isAraquariAdhesion(contract){
 return isIfcAdhesion(contract)&&contract.unitCode==='158459';
}

export function filterStructuredAta(ata,detail,filters={}){
 if(!filterDates(ata,filters))return false;
 const items=filters.items||'all',files=filters.files||'all',adhesion=filters.adhesion||'all';
 if(items==='yes'&&!detail?.compras?.items?.length||items==='no'&&detail?.compras?.items?.length)return false;
 if(files==='yes'&&!detail?.files?.length||files==='empty'&&(!Array.isArray(detail?.files)||detail.files.length)||files==='pending'&&Array.isArray(detail?.files))return false;
 if(adhesion==='yes'&&ata.allowsAdhesion!==true||adhesion==='no'&&ata.allowsAdhesion!==false||adhesion==='unknown'&&typeof ata.allowsAdhesion==='boolean')return false;
 return true;
}
export function filterStructuredTenderItem(item,notice,filters={}){
 const {result='all',srp='all',modality='all',dateKind='published',dateFrom='',dateTo=''}=filters;
 if(result==='has'&&!item.results?.length||result==='empty'&&(!Array.isArray(item.results)||item.results.length)||result==='pending'&&Array.isArray(item.results))return false;
 if(srp==='yes'&&notice?.srp!==true||srp==='no'&&notice?.srp!==false)return false;
 if(modality!=='all'&&String(notice?.modality)!==modality)return false;
 if(dateKind==='resultDate'&&(dateFrom||dateTo))return (item.results||[]).some(r=>dateRangeMatch(r.date,dateFrom,dateTo));
 return dateRangeMatch(dateKind==='checkedAt'?item.checkedAt:notice?.published,dateFrom,dateTo);
}
export function matchesCatalogSearch(query,fields){
 const normalize=v=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
 const q=normalize(query);if(!q)return true;
 const hay=fields.map(normalize).join(' ');
 return q.split(/\s+/).every(term=>hay.includes(term)||(/^\d[\d./-]+$/.test(term)&&fields.some(v=>normalize(v).replace(/[./\s-]/g,'').includes(term.replace(/[./\s-]/g,'')))));
}

export function compareCatalogDates(a,b,{sort='recent',field='signed',fallback=''}={}){
 const value=r=>sort==='expiry'?r.ends:r[field]||r[fallback];
 const x=value(a),y=value(b);
 if(!x&&!y)return String(a.id||a.pncpId||'').localeCompare(String(b.id||b.pncpId||''));
 if(!x)return 1;if(!y)return -1;
 return (sort==='oldest'||sort==='expiry'?x.localeCompare(y):y.localeCompare(x))||String(a.id||a.pncpId||'').localeCompare(String(b.id||b.pncpId||''));
}
