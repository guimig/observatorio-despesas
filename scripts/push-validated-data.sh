#!/usr/bin/env bash
# Dois reintentos limitados quando a main mudou apenas em arquivos disjuntos.
# Nunca forca push, sobrescreve outro coletor ou rebaseia arquivos fora de data/.
set -euo pipefail
# Antes de qualquer push, impedir commit parcial de coleta multiarquivo.
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard -- data/)" ]]; then
  echo 'Coleta possui arquivos pendentes de stage/commit; push bloqueado.' >&2
  exit 1
fi
for attempt in 1 2 3; do
  if git push origin HEAD:main; then exit 0; fi
  base=$(git rev-parse HEAD^)
  git fetch --depth=1 origin main
  remote=$(git rev-parse FETCH_HEAD)
  if [[ "$remote" == "$(git rev-parse HEAD)" ]]; then exit 0; fi
  if [[ "$remote" == "$base" || "$attempt" == 3 ]]; then
    echo 'Falha de push sem avanco da main ou limite de tentativas; interrompido.' >&2
    exit 1
  fi
  files=$(git diff --name-only "$base" HEAD)
  [[ -n "$files" ]] || { echo 'Commit sem dados; abortado.' >&2; exit 1; }
  while IFS= read -r file; do
    [[ "$file" == data/* ]] || { echo 'Commit inclui arquivo fora de data/; abortado.' >&2; exit 1; }
    if ! git diff --quiet "$base" "$remote" -- "$file"; then
      echo 'Main alterou arquivo de dados da coleta; nova consulta necessaria.' >&2
      exit 1
    fi
  done <<< "$files"
  if ! git rebase --onto "$remote" "$base"; then
    git rebase --abort || true
    exit 1
  fi
  npm test
  npm run check:data
done
exit 1
