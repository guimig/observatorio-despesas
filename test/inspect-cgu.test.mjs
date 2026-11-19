import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuralFields } from '../src/inspect-cgu.mjs';

test('inventário só expõe nomes de campos e tipos, nunca valores sensíveis', () => {
  const value = {
    codigoUg: '158459',
    cpf: '000.123.456-78',
    observacao: 'Texto sensível e CPF 000.123.456-78',
    favorecido: { nome: 'Nome de pessoa', documento: '000.123.456-78' },
    valor: 123.45
  };
  const output = structuralFields(value).join('|');
  assert.match(output, /favorecido.nome:string/);
  assert.match(output, /codigoUg:string/);
  assert.doesNotMatch(output, /000/);
  assert.doesNotMatch(output, /123.45/);
  assert.doesNotMatch(output, /Nome de pessoa/);
  assert.doesNotMatch(output, /Texto sensível/);
});
test('inventário não expõe chaves dinâmicas ou arrays de valores', () => {
  const output = structuralFields({
    '000.123.456-78': 'identificador sensível',
    docs: [{ cpf: '111.222.333-44' }],
    nested: { 'abc-123': 'valor', name: 'sem divulgar' }
  });
  assert.equal(output.includes('000.123.456-78:string'), false);
  assert.deepEqual(output, ['docs:array', 'nested.name:string', 'nested:object'].sort());
});
