#!/usr/bin/env bash
# Retenta uma vez somente quando a main avancou sem alterar os mesmos arquivos.
# Nunca forca push nem concilia automaticamente dois JSONs concorrentes.
set -euo pipefail
if git push origin HEAD:main; then exit 0; fi
base=$(git rev-parse HEAD^)
git fetch --depth=1 origin main
remote=$(git rev-parse FETCH_HEAD)
if [[ "$remote" == "$base" ]]; then
  echo 'Falha de push sem mudanca da main; nao retentar.' >&2
  exit 1
fi
while IFS= read -r file; do
  [[ "$file" == data/* ]] || { echo 'Commit inclui arquivo fora de data/; abortado.' >&2; exit 1; }
  if ! git diff --quiet "$base" "$remote" -- "$file"; then
    echo 'Main alterou um arquivo de dados da coleta; nova consulta necessaria.' >&2
    exit 1
  fi
done < <(git diff --name-only "$base" HEAD)
if ! git rebase --onto "$remote" "$base"; then
  git rebase --abort || true
  exit 1
fi
npm test
npm run check:data
git push origin HEAD:main
