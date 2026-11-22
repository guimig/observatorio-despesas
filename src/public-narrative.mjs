/** Textos narrativos de fontes oficiais: publicacao estritamente minimizada. */
import {sanitizeText,assertPublicSafe} from './privacy.mjs';

// Limite por campo, nao por registro. Historicos extensos nao vao para tabelas.
export const MAX_PUBLIC_NARRATIVE=12000;

/** Preserva paragrafos, mas recusa campos com marcadores sensiveis.
 * Nao publica fragmentos parciais que possam descontextualizar o objeto.
 */
export function publicNarrativeText(value,max=MAX_PUBLIC_NARRATIVE){
  if(typeof value!=='string'||!Number.isSafeInteger(max)||max<1||max>MAX_PUBLIC_NARRATIVE)
    return null;
  const clean=sanitizeText(value.replace(/\r\n?/g,'\n').replace(/\t/g,' '))
    .replace(/\u00a0/g,' ')
    .split('\n').map(line=>line.replace(/ {2,}/g,' ').trim())
    .join('\n').replace(/\n{3,}/g,'\n\n').trim();
  if(!clean||clean.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean))
    return null;
  if(/@|https?:\/\/|www\.|(?:\+?\d[\s().-]*){10,}/i.test(clean)||
     /\b(?:CPF|RG|PIS|NIS|matr[ií]cula|conta\s+corrente|ag[eê]ncia\s+banc[aá]ria|endere[cç]o\s+residencial)\b/i.test(clean))
    return null;
  return assertPublicSafe(clean);
}
