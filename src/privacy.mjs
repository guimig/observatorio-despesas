/**
 * Política pública de privacidade: CPF só existe em forma ***.123.456-**.
 * Dados integrais são transitórios, antes de serialização/log/armazenamento.
 */
const RAW_CPF = /(?<!\d)(?:\d{3}[.\s-]\d{3}[.\s-]\d{3}[-\s]?\d{2}|\d{11})(?!\d)/g;
const MASKED_CPF = /^\*\*\*\.\d{3}\.\d{3}-\*\*$/;
export function maskCpf(value) {
  if (typeof value !== 'string') throw Error('CPF deve ser texto');
  const trimmed = value.trim();
  if (MASKED_CPF.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) throw Error('Formato de CPF inesperado');
  return '***.' + digits.slice(3, 6) + '.' + digits.slice(6, 9) + '-**';
}
export function sanitizeText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(RAW_CPF, cpf => maskCpf(cpf));
}
export function containsRawCpf(value) {
  if (typeof value === 'string') {
    RAW_CPF.lastIndex = 0;
    return RAW_CPF.test(value);
  }
  if (Array.isArray(value)) return value.some(containsRawCpf);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) =>
      (key.toLowerCase().includes('cpf') && typeof entry === 'string' && !MASKED_CPF.test(entry)) ||
      containsRawCpf(entry));
  }
  return false;
}
export function assertPublicSafe(value) {
  if (containsRawCpf(value)) throw Error('CPF integral ou campo CPF inválido detectado: publicação bloqueada');
  return value;
}
