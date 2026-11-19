import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../src/build-site.mjs';

test('artefato Pages publica somente a allowlist, nunca arquivos privados', async () => {
  const root = await mkdtemp(join(tmpdir(), 'observatorio-pages-'));
  try {
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'data', 'months'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Teste</title>');
    await writeFile(join(root, '.nojekyll'), '');
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("ok");');
    await writeFile(join(root, 'assets', 'style.css'), 'body{}');
    await writeFile(join(root, 'data', 'manifest.json'), JSON.stringify({
      schema_version: 1, unit: '158459', status: 'aguardando_primeira_coleta', months: []
    }));
    await writeFile(join(root, '.env'), 'CGU_API_KEY=SEGREDO');
    await writeFile(join(root, 'data', 'raw-response.txt'), '000.123.456-78');
    await writeFile(join(root, 'src-private-token.txt'), 'SEGREDO');
    const result = await buildSite(root);
    assert.deepEqual(result, { months: 0, documents: 0 });
    assert.match(await readFile(join(root, 'dist', 'index.html'), 'utf8'), /Teste/);
    await assert.rejects(stat(join(root, 'dist', '.env')));
    await assert.rejects(stat(join(root, 'dist', 'data', 'raw-response.txt')));
    await assert.rejects(stat(join(root, 'dist', 'src-private-token.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artefato recusará manifesto que referência JSON histórico inexistente', async () => {
  const root = await mkdtemp(join(tmpdir(), 'observatorio-pages-'));
  try {
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'manifest.json'), JSON.stringify({
      schema_version: 1, unit: '158459', status: 'dados_publicados',
      months: ['2026-10']
    }));
    await assert.rejects(buildSite(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
