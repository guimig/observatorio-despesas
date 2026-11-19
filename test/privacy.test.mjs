import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskCpf, sanitizeText, containsRawCpf, assertPublicSafe } from '../src/privacy.mjs';

test('regra de CPF exata e idempotente', () => {
  assert.equal(maskCpf('000.123.456-78'), '***.123.456-**');
  assert.equal(maskCpf('00012345678'), '***.123.456-**');
  assert.equal(maskCpf('***.123.456-**'), '***.123.456-**');
});
test('CPF jamais permanece integral em texto livre', () => {
  const text = sanitizeText('Favorecido CPF 000.123.456-78; outro: 11122233344.');
  assert.equal(text, 'Favorecido CPF ***.123.456-**; outro: ***.222.333-**.');
  assert.equal(containsRawCpf(text), false);
});
test('CNPJ e documento SIAFI não são classificados como CPF', () => {
  assert.equal(sanitizeText('CNPJ 12.345.678/0001-90'), 'CNPJ 12.345.678/0001-90');
  assert.equal(containsRawCpf('158459000012026NE000001'), false);
});
test('CPF de formato inesperado é rejeitado, nunca ecoado', () => {
  assert.throws(() => maskCpf('invalid'));
  assert.throws(() => maskCpf(12345678901));
});
test('validador de publicação bloqueia CPF bruto, inclusive aninhado', () => {
  assert.throws(() => assertPublicSafe({ a: [{ identificador: '00012345678' }] }));
  assert.throws(() => assertPublicSafe({ fornecedor: { cpf: '000.123.456-78' } }));
  assert.doesNotThrow(() => assertPublicSafe({ cpf: '***.123.456-**' }));
});
