/** Filtros tipados sobre campos ja normalizados; valores monetarios em centavos. */
export function filterStructuredNotice(n,{srp='all',minCents=null,maxCents=null}={}){
 if(srp==='yes'&&n.srp!==true||srp==='no'&&n.srp!==false)return false;
 const value=n.estimatedCents;
 if(minCents!==null||maxCents!==null){
  if(!Number.isSafeInteger(value))return false;
  if(minCents!==null&&value<minCents||maxCents!==null&&value>maxCents)return false;
 }
 return true;
}
export function filterStructuredContract(c,{minCents=null,maxCents=null,activeOn=''}={}){
 if(minCents!==null||maxCents!==null){
  if(!Number.isSafeInteger(c.amountCents))return false;
  if(minCents!==null&&c.amountCents<minCents||maxCents!==null&&c.amountCents>maxCents)return false;
 }
 if(activeOn){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(activeOn)||!c.starts||!c.ends)return false;
  if(c.starts>activeOn||c.ends<activeOn)return false;
 }
 return true;
}
export function parseReaisFilter(value){
 const raw=String(value??'').trim();
 if(!raw)return null;
 if(!/^\d{1,12}(?:[.,]\d{1,2})?$/.test(raw))return null;
 const n=Number(raw.replace(',','.'));
 const cents=Math.round(n*100);
 return Number.isSafeInteger(cents)?cents:null;
}
