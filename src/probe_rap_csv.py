"""Confronto documental efêmero CGU API x CSV. Não importa nem corrige dados.

A data do ZIP pode corresponder à última alteração do documento. Ausência
em um arquivo não prova ausência de RAP; igualdade não homologa saldo.
Somente contagens fixas, nunca cabeçalhos arbitrários, identificadores,
valores individuais ou linhas de origem nos logs.
"""
import csv
import io
import json
import os
import re
import zipfile
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from datetime import date
from contextlib import contextmanager

from src.probe_cgu_downloads import (
    FIRST, DOC, EXPANDED_CAP, archive_url, download_sample, inspect_headers,
    normalize, parse_day,
)

LIMIT = 50000
SAFE_CENTS = 9007199254740991
HISTORY = "ItemEmpenhoHistorico"
IMPACTS = {"Liquidacao_EmpenhosImpactados": "Liquidacao",
           "Pagamento_EmpenhosImpactados": "Pagamento"}
PARENTS = ("Empenho", "Liquidacao", "Pagamento")
FIELDS = {
    "liquidatedCents": ("valor liquidado",),
    "paidCents": ("valor pago",),
    "rpInscribedCents": ("valor resto inscrito", "valor inscrito em restos a pagar",
                         "valor restos a pagar inscritos", "valor rp inscrito",
                         "valor restos inscritos"),
    "rpCancelledCents": ("valor resto cancelado", "valor restos a pagar cancelados",
                          "valor cancelado de restos a pagar", "valor rp cancelado",
                          "valor restos cancelados", "valor de restos a pagar cancelados",
                          "valor restos a pagar cancelado", "valor de restos a pagar cancelado"),
    "rpPaidCents": ("valor resto pago", "valor restos a pagar pagos",
                    "valor pago de restos a pagar", "valor rp pago", "valor restos pagos"),
}
HISTORY_FIELDS = {
    "seq": ("sequencial", "sequencial item", "sequencial do item", "numero sequencial",
            "numero sequencial item", "numero do item", "sequencial item empenho",
            "sequencial subitem empenho", "numero sequencial do item"),
    "date": ("data", "data operacao", "data da operacao", "data movimentacao",
             "data da movimentacao", "data movimento"),
    "operation": ("operacao", "descricao operacao", "tipo operacao", "operacao historico"),
    "quantity": ("quantidade", "quantidade item", "quantidade movimentada"),
    "unitPrice": ("valor unitario", "valor unitario item", "valor unitario do item"),
    "cents": ("valor total", "valor total item", "valor total do item"),
}
DOC_HEADERS = {
    "Empenho": (("codigo empenho", "codigo empenho impactado", "codigo documento empenho"),
                ("id empenho", "id empenho impactado")),
    "Liquidacao": (("codigo liquidacao", "codigo documento liquidacao"), ("id liquidacao",)),
    "Pagamento": (("codigo pagamento", "codigo documento pagamento"), ("id pagamento",)),
}
SUBITEM = ("subitem", "codigo subitem", "codigo subitem empenho", "subitem empenho")
NE_RE = re.compile(r"^158459\d{5}20\d{2}NE\d{6}$")
KIND = {"Empenho": {"NE"}, "Liquidacao": {"NS"}, "Pagamento": {"OB", "DF", "DR", "GP"}}


def in_scope(value, kind=None):
    return (isinstance(value, str) and bool(DOC.fullmatch(value)) and
            int(value[11:15]) >= FIRST.year and
            (kind is None or value[15:17] in KIND[kind]))


def operation(value):
    return " ".join(normalize(value or "").split())


def is_inscription(value):
    return bool(re.fullmatch(r"inscricao (de|em) restos? a pagar|inscricao (de |em )?rp",
                             operation(value)))


def decimal_value(value, csv_locale=False):
    # CSV usa separador decimal brasileiro ou representação decimal explícita.
    # Não arredondar nem interpretar uma sequência ambígua de separadores.
    if not isinstance(value, str):
        return None
    value = value.strip()
    if csv_locale and "," in value:
        if not re.fullmatch(r"-?(?:\d{1,12}|\d{1,3}(?:\.\d{3})+),\d{1,8}", value):
            return None
        value = value.replace(".", "").replace(",", ".")
    if not re.fullmatch(r"-?\d{1,12}(?:\.\d{1,8})?", value):
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def cents_value(value):
    v = decimal_value(value, csv_locale=True)
    if v is None or v * 100 != (v * 100).to_integral_value() or abs(v * 100) > SAFE_CENTS:
        return None
    return int(v * 100)


def canonical_cents(value):
    return value if type(value) is int and abs(value) <= SAFE_CENTS else None


def seq_value(value):
    if type(value) is int:
        return value if 1 <= value <= 100000 else None
    if isinstance(value, str) and re.fullmatch(r"\d{1,6}", value.strip()):
        return seq_value(int(value))
    return None


def day_value(value):
    parsed = parse_day(value) if isinstance(value, str) else None
    return parsed.isoformat() if parsed and FIRST <= parsed < date.today() else None


def canonical_index(months):
    owners = defaultdict(list)
    for month in months:
        if month.get("unit") != "158459" or month.get("month", "") < "2024-01":
            continue
        for doc in month["documents"]:
            if in_scope(doc["id"]):
                owners[doc["id"]].append((doc, month))
    histories, pairs, event_days, payment_days = {}, {}, Counter(), Counter()
    history_targets = defaultdict(set)
    origin2025_targets = defaultdict(set)
    pending_impact_days = defaultdict(set)
    note_dates = defaultdict(set)
    # A data de observação é pista de localização, não data de inscrição.
    for ne, records in owners.items():
        if len(records) == 1 and NE_RE.fullmatch(ne):
            d = day_value(records[0][0].get("date"))
            if d:
                note_dates[ne].add(d)
    for month in months:
        if month.get("unit") != "158459":
            continue
        for obs in month.get("commitmentObservations", []):
            ne = obs.get("id")
            if ne in note_dates:
                d = day_value(obs.get("date"))
                if d:
                    note_dates[ne].add(d)
    for ne, rows in owners.items():
        if len(rows) != 1 or not NE_RE.fullmatch(ne):
            continue
        doc, month = rows[0]
        if doc.get("phase") != 1 or doc.get("itemsDetailVersion") != 2:
            continue
        items = month.get("itemsByDocument", {}).get(ne, [])
        seqs = [seq_value(item.get("seq")) for item in items]
        if None in seqs or len(seqs) != len(set(seqs)):
            continue
        for item, seq in zip(items, seqs):
            if item.get("historyChecked") is not True or not isinstance(item.get("movements"), list):
                continue
            sigs = Counter()
            valid = True
            for e in item["movements"]:
                if not is_inscription(e.get("operation")):
                    continue
                sig = (day_value(e.get("date")), operation(e["operation"]),
                       decimal_value(e.get("quantity")), decimal_value(e.get("unitPrice")),
                       canonical_cents(e.get("cents")))
                if None in sig:
                    valid = False
                    break
                sigs[sig] += 1
            if valid:
                histories[ne, seq] = sigs
                for sig, count in sigs.items():
                    event_days[sig[0]] += count
                if sigs:
                    for d in note_dates[ne]:
                        history_targets[d].add((ne, seq))
    candidates = defaultdict(list)
    stored_pairs = set()
    for month in months:
        if month.get("unit") != "158459":
            continue
        for link in month.get("relations", []):
            src, ne = link.get("from"), link.get("to")
            if not in_scope(src) or not in_scope(ne, "Empenho") or src[11:15] < ne[11:15]:
                continue
            stored_pairs.add((src, ne))
            if src[11:15] > ne[11:15]:
                candidates[src, ne].append((link, month))
    for key, rows in candidates.items():
        if len(rows) != 1 or len(owners.get(key[0], [])) != 1:
            continue
        link, month = rows[0]
        doc, owner = owners[key[0]][0]
        phase = doc.get("phase")
        if owner is not month or phase not in (2, 3) or not in_scope(key[0], "Liquidacao" if phase == 2 else "Pagamento"):
            continue
        checked = doc.get("liquidationLinksChecked" if phase == 2 else "paymentLinksChecked") is True
        c = link.get("impactComponents") if checked else None
        if isinstance(c, dict) and c.get("repeatedRows") == 0:
            c = {field: canonical_cents(c.get(field)) for field in FIELDS}
        else:
            c = None
        pairs[key] = c
        d = day_value(doc.get("date"))
        if d:
            if c is None or any(c[field] is None for field in FIELDS):
                pending_impact_days[d].add(key)
            if c and c["rpPaidCents"] not in (None, 0) and phase == 3:
                payment_days[d] += 1
        if key[1][11:15] == "2025" and key[0][11:15] > "2025":
            for note_day in note_dates[key[1]]:
                origin2025_targets[note_day].add(key[1])
    return {"histories": histories, "pairs": pairs,
            "eventDays": event_days, "paymentDays": payment_days,
            "historyTargets": history_targets, "origin2025Targets": origin2025_targets,
            "pendingImpactDays": pending_impact_days,
            "storedPairs": stored_pairs,
            "sourceOwners": {key: len(rows) for key, rows in owners.items()}}


def load_canonical(root="."):
    months = []
    for path in sorted((Path(root) / "data" / "months").glob("20[0-9][0-9]-[0-9][0-9].json")):
        if path.stem < "2024-01":
            continue
        with path.open(encoding="utf-8") as stream:
            months.append(json.load(stream))
    return canonical_index(months)


def choose_dates(index, explicit=None, window=0, focus=None):
    if explicit:
        archive_url(explicit)
        return [explicit]
    if type(window) is not int or window < 0:
        raise ValueError("invalid_window")
    # Alterna as duas coortes, usando datas da listagem/reaparição da NE,
    # em lugar de insistir na data da inscrição (arquivo 11/01/2025 vazio).
    # Ordenação determinística: maior cobertura potencial, depois data.
    def ranked(groups):
        return sorted(groups, key=lambda d: (-len(groups[d]), d))
    known = ranked(index.get("historyTargets", {}))
    search = ranked(index.get("origin2025Targets", {}))
    groups = (known, search) if window % 2 == 0 else (search, known)
    dates = []
    for group in groups:
        if group:
            dates.append(group[(window // 2) % len(group)])
            break
    if not dates and index["eventDays"]:
        candidates = sorted(index["eventDays"], key=lambda d: (-index["eventDays"][d], d))
        dates.append(candidates[window % len(candidates)])
    # Dar preferência a datas com pagamento já verificável e vínculos
    # pendentes; depois rodar as demais datas com componentes faltantes.
    missing = index.get("pendingImpactDays", {})
    preferred = sorted((d for d in missing if d in index["paymentDays"]),
                       key=lambda d: (-len(missing[d]), d))
    others = sorted((d for d in missing if d not in index["paymentDays"]),
                    key=lambda d: (-len(missing[d]), d))
    if preferred and (window % 2 == 0 or not others):
        impacts = preferred
    elif others:
        impacts = others
    else:
        impacts = sorted(index["paymentDays"], reverse=True)
    if impacts:
        rotated = impacts[(window // 2) % len(impacts):] + impacts[:(window // 2) % len(impacts)]
        dates.append(next((d for d in rotated if d not in dates), rotated[0]))
    if focus:
        archive_url(focus)
        # Uma das duas vagas existentes; nunca aumentar o número de ZIPs.
        dates = dates[:1] + [focus] if not dates or dates[0] != focus else dates
    return list(dict.fromkeys(dates))[:2]


def column(names, aliases):
    # Lista fechada; múltiplos candidatos ficam indisponíveis, sem escolher
    # arbitrariamente entre colunas com significados potencialmente distintos.
    matches = [i for i, name in enumerate(names) if name in aliases]
    return matches[0] if len(matches) == 1 else None


def header_name(value):
    return re.sub(r"\s*\(r\$\)$", "", " ".join(normalize(value).split()))


def get(row, col):
    return row[col].strip() if col is not None and col < len(row) else ""


@contextmanager
def csv_rows(archive, member):
    csv.field_size_limit(1024 * 1024)
    with archive.open(member) as raw:
        header = raw.readline(65536)
    try:
        header.decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        encoding = "latin-1"
    with archive.open(member) as raw, io.TextIOWrapper(raw, encoding=encoding, newline="") as stream:
        reader = csv.reader(stream, delimiter=";", strict=True)
        names = [header_name(h) for h in next(reader, [])]
        if not names or len(names) > 512:
            raise ValueError("invalid_header")
        yield names, reader


def parent_index(archive, member, kind):
    if member is None:
        return {}, "missing_parent"
    by_id, conflicts = {}, set()
    with csv_rows(archive, member) as (names, rows):
        code, internal = (column(names, group) for group in DOC_HEADERS[kind])
        if code is None or internal is None:
            return {}, "parent_schema_unavailable"
        for row in rows:
            doc, key = get(row, code), get(row, internal)
            if not in_scope(doc, kind) or not re.fullmatch(r"\d{1,24}", key):
                continue
            if key in by_id and by_id[key] != doc:
                conflicts.add(key)
            by_id[key] = doc
            if len(by_id) > LIMIT:
                raise ValueError("parent_limit")
    return {k: v for k, v in by_id.items() if k not in conflicts}, "available"


def identity(row, cols, lookup, kind):
    code, internal = cols
    full, key = get(row, code), get(row, internal)
    mapped = lookup.get(key)
    if full:
        return full if in_scope(full, kind) and (mapped is None or mapped == full) else None
    return mapped if in_scope(mapped, kind) else None


def identity_columns(names, kind):
    return tuple(column(names, group) for group in DOC_HEADERS[kind])


def inspect_history(archive, member, parent, index, day, targets=None):
    known = index["histories"]
    expected = {key for key, sigs in known.items() if any(sig[0] == day for sig in sigs)}
    date_targets = set(index.get("historyTargets", {}).get(day, ()))
    search_targets = set(index.get("origin2025Targets", {}).get(day, ()))
    seen_target_items, seen_search_notes, search_inscribed = set(), set(), set()
    counts = {"status": "inspected", "qualifiedRows": 0, "validRows": 0,
              "campusHistoryRows": 0, "campusNotesSeen": 0,
              "targetItemsByDocumentDate": len(date_targets),
              "targetItemsSeenInHistory": 0, "targetItemsWithInscription": 0,
              "search2025Notes": len(search_targets), "search2025NotesSeen": 0,
              "search2025NotesWithInscription": 0,
              "operationHints": {"unqualifiedInscription": 0, "cancellation": 0, "reversal": 0},
              "invalidRows": 0, "matchedItems": 0, "matchedOccurrences": 0,
              "archiveOnlyOccurrences": 0, "canonicalOnlyOccurrencesForMatchedItems": 0,
              "sameMultisetItems": 0, "differentMultiplicityItems": 0,
              "differentContentItems": 0, "archiveRepeatedOccurrences": 0,
              "unmatchedCheckedItems": 0, "unmatchedCatalogRows": 0,
              "targetItemsForArchiveDate": len(expected), "targetItemsLocated": 0}
    observed = defaultdict(Counter)
    campus_notes = set()
    with csv_rows(archive, member) as (names, rows):
        idcols = identity_columns(names, "Empenho")
        cols = {k: column(names, aliases) for k, aliases in HISTORY_FIELDS.items()}
        counts["recognizedFields"] = {k: v is not None for k, v in cols.items()}
        counts["fullCodeColumn"] = idcols[0] is not None
        counts["internalIdColumn"] = idcols[1] is not None
        if (idcols[0] is None and (idcols[1] is None or not parent)) or any(v is None for v in cols.values()):
            counts["status"] = "schema_unavailable"
            return counts
        for row in rows:
            ne = identity(row, idcols, parent, "Empenho")
            if not ne:
                continue
            counts["campusHistoryRows"] += 1
            if counts["campusHistoryRows"] > LIMIT:
                raise ValueError("history_limit")
            campus_notes.add(ne)
            seq = seq_value(get(row, cols["seq"]))
            if (ne, seq) in date_targets:
                seen_target_items.add((ne, seq))
            if ne in search_targets:
                seen_search_notes.add(ne)
            label = operation(get(row, cols["operation"]))
            if not is_inscription(label):
                if label == "inscricao":
                    counts["operationHints"]["unqualifiedInscription"] += 1
                elif "cancelamento" in label or "anulacao de rp" in label:
                    counts["operationHints"]["cancellation"] += 1
                elif "estorno" in label:
                    counts["operationHints"]["reversal"] += 1
                continue
            counts["qualifiedRows"] += 1
            sig = (day_value(get(row, cols["date"])), operation(get(row, cols["operation"])),
                   decimal_value(get(row, cols["quantity"]), True),
                   decimal_value(get(row, cols["unitPrice"]), True),
                   cents_value(get(row, cols["cents"])))
            if seq is None or None in sig or len(row) != len(names):
                counts["invalidRows"] += 1
                continue
            counts["validRows"] += 1
            key = (ne, seq)
            observed[key][sig] += 1
            if ne in search_targets:
                search_inscribed.add(ne)
            if key not in known:
                counts["unmatchedCatalogRows"] += 1
    counts["campusNotesSeen"] = len(campus_notes)
    counts["targetItemsSeenInHistory"] = len(seen_target_items)
    counts["targetItemsWithInscription"] = len(date_targets & observed.keys())
    counts["search2025NotesSeen"] = len(seen_search_notes)
    counts["search2025NotesWithInscription"] = len(search_inscribed)
    # Não classificar concordância de multiconjunto se houve linha inválida.
    if counts["invalidRows"]:
        counts["status"] = "partial_invalid_rows"
        return counts
    counts["targetItemsLocated"] = len(expected & observed.keys())
    for key, sigs in observed.items():
        counts["archiveRepeatedOccurrences"] += sum(n - 1 for n in sigs.values())
        if targets is not None and (key not in known or sigs != known[key]):
            # Somente eventos qualificados e campos estritamente estruturados.
            # Não transportar histórico bruto, descrição ou outros favorecidos.
            if sum(sigs.values()) <= 100:
                events = [{"date": sig[0], "operation": sig[1], "quantity": format(sig[2], "f"),
                           "unitPrice": format(sig[3], "f"), "cents": sig[4], "count": n}
                          for sig, n in sorted(sigs.items())]
                targets["histories"].append({"id": key[0], "seq": key[1], "events": events})
        if key not in known:
            continue
        old = known[key]
        counts["matchedItems"] += 1
        counts["matchedOccurrences"] += sum((sigs & old).values())
        counts["archiveOnlyOccurrences"] += sum((sigs - old).values())
        counts["canonicalOnlyOccurrencesForMatchedItems"] += sum((old - sigs).values())
        label = "sameMultisetItems" if old == sigs else (
            "differentMultiplicityItems" if old.keys() == sigs.keys() else "differentContentItems")
        counts[label] += 1
    counts["unmatchedCheckedItems"] = len(expected - observed.keys())
    return counts


def inspect_impacts(archive, member, parents, kind, index, targets=None):
    fields = {k: {"positive": 0, "zero": 0, "negative": 0, "unavailable": 0,
                  "compared": 0, "equal": 0, "different": 0} for k in FIELDS}
    out = {"status": "inspected", "interannualRows": 0, "invalidRows": 0,
           "pairs": 0, "knownPairs": 0, "pairsWithStoredComponents": 0,
           "ambiguousPairs": 0, "unmatchedPairs": 0, "fields": fields,
           "missingPairSourcePresent": 0, "missingPairSourceAbsent": 0,
           "missingPairSourceAmbiguous": 0, "unmatchedButStored": 0,
           "missingPaymentCandidates": 0, "companionPairs": 0}
    groups = defaultdict(list)
    companion_groups = defaultdict(list)
    missing_documents = set()
    scoped_rows = 0
    with csv_rows(archive, member) as (names, rows):
        fromcols = identity_columns(names, kind)
        tocols = identity_columns(names, "Empenho")
        subitem = column(names, SUBITEM)
        cols = {k: column(names, aliases) for k, aliases in FIELDS.items()}
        out["recognizedFields"] = {k: v is not None for k, v in cols.items()}
        out["cancellationHeaderCandidates"] = sum(
            "valor" in name and ("cancel" in name or "anul" in name) for name in names)
        out["subitemColumn"] = subitem is not None
        out["sourceFullCodeColumn"] = fromcols[0] is not None
        out["neFullCodeColumn"] = tocols[0] is not None
        if ((fromcols[0] is None and (fromcols[1] is None or not parents[kind])) or
                (tocols[0] is None and (tocols[1] is None or not parents["Empenho"])) or
                all(v is None for v in cols.values())):
            out["status"] = "schema_unavailable"
            return out
        for row in rows:
            src = identity(row, fromcols, parents[kind], kind)
            ne = identity(row, tocols, parents["Empenho"], "Empenho")
            if not src or not ne or src[11:15] < ne[11:15]:
                continue
            interannual = src[11:15] > ne[11:15]
            if not interannual and (kind != "Pagamento" or targets is None):
                continue
            scoped_rows += 1
            if scoped_rows > LIMIT:
                raise ValueError("impact_limit")
            if interannual:
                out["interannualRows"] += 1
            if len(row) != len(names):
                out["invalidRows"] += 1
                continue
            group = groups if interannual else companion_groups
            group[src, ne].append((get(row, subitem),
                                    tuple(cents_value(get(row, col)) for col in cols.values())))
    if out["invalidRows"]:
        out["status"] = "partial_invalid_rows"
        return out
    out["pairs"] = len(groups)
    possible_companions = []
    for key, values in groups.items():
        known = key in index["pairs"]
        old = index["pairs"].get(key)
        out["knownPairs"] += int(known)
        out["unmatchedPairs"] += int(not known)
        stored = key in index.get("storedPairs", index["pairs"])
        owners = index.get("sourceOwners", {}).get(key[0], 0)
        if not known:
            if stored:
                out["unmatchedButStored"] += 1
            else:
                field = ("missingPairSourcePresent" if owners == 1 else
                         "missingPairSourceAbsent" if owners == 0 else "missingPairSourceAmbiguous")
                out[field] += 1
        out["pairsWithStoredComponents"] += int(old is not None)
        ambiguous = len(set(values)) != len(values) or (
            len(values) > 1 and (subitem is None or any(not r[0] for r in values)))
        out["ambiguousPairs"] += int(ambiguous)
        observed_fields = {}
        for i, field in enumerate(FIELDS):
            amounts = [v[1][i] for v in values]
            total = sum(amounts) if not ambiguous and None not in amounts else None
            if total is not None and abs(total) > SAFE_CENTS:
                total = None
            observed_fields[field] = total
            counts = fields[field]
            counts["unavailable" if total is None else "positive" if total > 0 else
                   "negative" if total < 0 else "zero"] += 1
            if total is not None and old is not None and old[field] is not None:
                counts["compared"] += 1
                counts["equal" if old[field] == total else "different"] += 1
        # Só ampliar a descoberta para pagamentos RP positivos com quatro
        # campos pertinentes presentes, UG/NE integrais e espécie suportada.
        # Um par armazenado porém não elegível não é um par ausente.
        missing_payment = (not stored and owners <= 1 and kind == "Pagamento"
                           and key[0][15:17] in ("OB", "DF") and not ambiguous
                           and (observed_fields["rpPaidCents"] or 0) > 0
                           and all(observed_fields[k] is not None for k in
                                   ("paidCents", "rpInscribedCents", "rpCancelledCents", "rpPaidCents")))
        out["missingPaymentCandidates"] += int(missing_payment)
        if missing_payment:
            missing_documents.add(key[0])
        if targets is not None and kind == "Pagamento" and not stored and owners <= 1 and not ambiguous and key[0][15:17] in ("OB", "DF") and all(
            observed_fields[k] is not None for k in ("paidCents", "rpInscribedCents", "rpCancelledCents", "rpPaidCents")
        ) and not missing_payment:
            possible_companions.append({"id": key[0], "ne": key[1], "phase": 3,
                                        "components": observed_fields})
        if targets is not None and not ambiguous and key[0][15:17] in ("NS", "OB", "DF") and (
            missing_payment or (known and any(
                v is not None and (old is None or old[k] is None or old[k] != v)
                for k, v in observed_fields.items()
            ))
        ):
            targets["impacts"].append({"id": key[0], "ne": key[1],
                                       "phase": 2 if kind == "Liquidacao" else 3,
                                       "components": observed_fields})
    # Complementos só de pagamentos com ao menos um par RAP positivo ausente.
    # Preserva os contadores interanuais e não recupera outro exercício por si só.
    if targets is not None and kind == "Pagamento":
        for key, values in companion_groups.items():
            if key[0] not in missing_documents or key in index.get("storedPairs", index["pairs"]):
                continue
            if len(set(values)) != len(values) or (
                len(values) > 1 and (subitem is None or any(not r[0] for r in values))
            ):
                continue
            components = {}
            for i, field in enumerate(FIELDS):
                amounts = [v[1][i] for v in values]
                total = sum(amounts) if None not in amounts else None
                components[field] = total if total is not None and abs(total) <= SAFE_CENTS else None
            if all(components[k] is not None for k in
                   ("paidCents", "rpInscribedCents", "rpCancelledCents", "rpPaidCents")):
                possible_companions.append({"id": key[0], "ne": key[1], "phase": 3,
                                            "components": components})
        for row in possible_companions:
            if row["id"] in missing_documents:
                targets["impacts"].append(row)
                out["companionPairs"] += 1
    return out


def inspect_rap_archive(stream, day, index, targets=None):
    archive_url(day)
    prefix = day.replace("-", "") + "_Despesas_"
    with zipfile.ZipFile(stream) as archive:
        members = {}
        for suffix in (*PARENTS, HISTORY, *IMPACTS):
            matches = [i for i in archive.infolist()
                       if i.filename.rsplit("/", 1)[-1] == prefix + suffix + ".csv"]
            if len(matches) > 1:
                raise ValueError("ambiguous_member")
            if matches:
                members[suffix] = matches[0]
        if sum(m.file_size for m in members.values()) > EXPANDED_CAP:
            raise ValueError("expanded_limit")
        parents, statuses = {}, {}
        for kind in PARENTS:
            parents[kind], statuses[kind] = parent_index(archive, members.get(kind), kind)
        out = {"parentStatus": statuses}
        out[HISTORY] = inspect_history(archive, members[HISTORY], parents["Empenho"], index, day, targets) if HISTORY in members else {"status": "missing_member"}
        for suffix, kind in IMPACTS.items():
            out[suffix] = inspect_impacts(archive, members[suffix], parents, kind, index, targets) if suffix in members else {"status": "missing_member"}
        return out


def bounded_targets(targets, index=None, window=0):
    # Uma identidade por amostra, nunca fundir snapshots divergentes.
    def unique(rows, key):
        by_key, conflicts = {}, set()
        for row in rows:
            k = key(row)
            if k in by_key and row != by_key[k]:
                conflicts.add(k)
            by_key[k] = row
        return [row for k, row in sorted(by_key.items()) if k not in conflicts]
    histories = unique(targets["histories"], lambda r: (r["id"], r["seq"]))
    histories.sort(key=lambda r: (r["id"][11:15] != "2025", r["id"], r["seq"]))
    impacts = unique(targets["impacts"], lambda r: (r["id"], r["ne"]))
    impacts.sort(key=lambda r: (not any(r["components"][k] not in (0, None)
                                        for k in ("rpPaidCents", "rpCancelledCents", "rpInscribedCents")),
                                 r["id"], r["ne"]))
    # Agrupar por documento: não cortar o conjunto de alvos de um
    # pagamento no meio. Priorizar documentos com pares ausentes e rodiziar.
    groups = defaultdict(list)
    for row in impacts:
        groups[row["id"]].append(row)
    stored = (index or {}).get("storedPairs", (index or {}).get("pairs", {}))
    missing = [key for key, rows in groups.items() if index is not None and any(
        (r["id"], r["ne"]) not in stored for r in rows)]
    if missing:
        offset = window % len(missing)
        missing = missing[offset:] + missing[:offset]
    order = missing + [key for key in groups if key not in missing]
    selected, documents = [], 0
    for key in order:
        rows = groups[key]
        if documents >= 6:
            break
        if len(selected) + len(rows) > 16:
            continue
        documents += 1
        selected.extend(rows)
    return {"version": 1, "histories": histories[:4], "impacts": selected}


def main():
    index = load_canonical()
    targets = {"histories": [], "impacts": []}
    target_file = os.environ.get("CGU_RAP_TARGETS_PATH")
    raw_window = os.environ.get("GITHUB_RUN_NUMBER", "0")
    window = int(raw_window) if raw_window.isdecimal() and len(raw_window) <= 12 else 0
    days = choose_dates(index, os.environ.get("CGU_RAP_ARCHIVE_DATE") or None, window,
                        os.environ.get("CGU_RAP_FOCUS_DATE") or None)
    print("Plano CSV RAP (somente contagens): " + json.dumps({
        "window": window, "datesWithKnownInscriptionTargets": len(index["historyTargets"]),
        "datesWith2025Targets": len(index["origin2025Targets"]),
        "datesWithPendingImpacts": len(index["pendingImpactDays"]),
        "archives": len(days), "dates": days,
        "checkedItems": len(index["histories"]),
        "interannualPairs": len(index["pairs"]),
        "pairsWithStoredComponents": sum(c is not None for c in index["pairs"].values())
    }))
    if not days:
        print("Sem datas candidatas no acervo; nenhuma consulta.")
    for day in days:
        meta = inspect_headers(day)
        print("Metadados ZIP RAP: " + json.dumps(meta))
        if meta["status"] in (401, 403, 405, 429):
            print("Sondagem interrompida por restricao da fonte.")
            targets = {"histories": [], "impacts": []}
            break
        archive_targets = {"histories": [], "impacts": []}
        result = download_sample(day, meta, inspector=lambda stream, d: inspect_rap_archive(
            stream, d, index, archive_targets if target_file else None))
        if result["status"] == "inspected":
            for k in targets:
                targets[k].extend(archive_targets[k])
        print("Confronto CSV RAP (somente contagens): " + json.dumps(result))
        if result["status"] in (401, 403, 405, 429):
            targets = {"histories": [], "impacts": []}
            break
    if target_file:
        plan = bounded_targets(targets, index, window)
        # Workflow usa diretório temporário exclusivo, sem upload de artefatos.
        with open(target_file, "x", encoding="utf-8") as stream:
            json.dump(plan, stream, ensure_ascii=True)
        print("Alvos CSV para API (somente contagens): " + json.dumps({
            "histories": len(plan["histories"]),
            "impactDocuments": len({r["id"] for r in plan["impacts"]}),
            "impactPairs": len(plan["impacts"]),
            "missingPairs": sum((r["id"], r["ne"]) not in index["storedPairs"]
                                for r in plan["impacts"])}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, csv.Error, zipfile.BadZipFile, UnicodeError):
        print("Confronto CSV RAP nao concluido; dados preservados.")
        raise SystemExit(1)
