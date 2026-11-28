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
                          "valor restos cancelados"),
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
    candidates = defaultdict(list)
    for month in months:
        if month.get("unit") != "158459":
            continue
        for link in month.get("relations", []):
            src, ne = link.get("from"), link.get("to")
            if not in_scope(src) or not in_scope(ne, "Empenho") or src[11:15] <= ne[11:15]:
                continue
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
        if c and c["rpPaidCents"] not in (None, 0) and phase == 3:
            d = day_value(doc.get("date"))
            if d:
                payment_days[d] += 1
    return {"histories": histories, "pairs": pairs,
            "eventDays": event_days, "paymentDays": payment_days}


def load_canonical(root="."):
    months = []
    for path in sorted((Path(root) / "data" / "months").glob("20[0-9][0-9]-[0-9][0-9].json")):
        if path.stem < "2024-01":
            continue
        with path.open(encoding="utf-8") as stream:
            months.append(json.load(stream))
    return canonical_index(months)


def choose_dates(index, explicit=None):
    if explicit:
        archive_url(explicit)
        return [explicit]
    dates = []
    if index["eventDays"]:
        dates.append(sorted(index["eventDays"], key=lambda d: (-index["eventDays"][d], d))[0])
    if index["paymentDays"]:
        dates.append(max(index["paymentDays"]))
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


def inspect_history(archive, member, parent, index, day):
    known = index["histories"]
    expected = {key for key, sigs in known.items() if any(sig[0] == day for sig in sigs)}
    counts = {"status": "inspected", "qualifiedRows": 0, "validRows": 0,
              "invalidRows": 0, "matchedItems": 0, "matchedOccurrences": 0,
              "archiveOnlyOccurrences": 0, "canonicalOnlyOccurrencesForMatchedItems": 0,
              "sameMultisetItems": 0, "differentMultiplicityItems": 0,
              "differentContentItems": 0, "archiveRepeatedOccurrences": 0,
              "unmatchedCheckedItems": 0, "unmatchedCatalogRows": 0,
              "targetItemsForArchiveDate": len(expected), "targetItemsLocated": 0}
    observed = defaultdict(Counter)
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
            if not ne or not is_inscription(get(row, cols["operation"])):
                continue
            counts["qualifiedRows"] += 1
            if counts["qualifiedRows"] > LIMIT:
                raise ValueError("history_limit")
            seq = seq_value(get(row, cols["seq"]))
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
            if key not in known:
                counts["unmatchedCatalogRows"] += 1
    # Não classificar concordância de multiconjunto se houve linha inválida.
    if counts["invalidRows"]:
        counts["status"] = "partial_invalid_rows"
        return counts
    counts["targetItemsLocated"] = len(expected & observed.keys())
    for key, sigs in observed.items():
        counts["archiveRepeatedOccurrences"] += sum(n - 1 for n in sigs.values())
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


def inspect_impacts(archive, member, parents, kind, index):
    fields = {k: {"positive": 0, "zero": 0, "negative": 0, "unavailable": 0,
                  "compared": 0, "equal": 0, "different": 0} for k in FIELDS}
    out = {"status": "inspected", "interannualRows": 0, "invalidRows": 0,
           "pairs": 0, "knownPairs": 0, "pairsWithStoredComponents": 0,
           "ambiguousPairs": 0, "unmatchedPairs": 0, "fields": fields}
    groups = defaultdict(list)
    with csv_rows(archive, member) as (names, rows):
        fromcols = identity_columns(names, kind)
        tocols = identity_columns(names, "Empenho")
        subitem = column(names, SUBITEM)
        cols = {k: column(names, aliases) for k, aliases in FIELDS.items()}
        out["recognizedFields"] = {k: v is not None for k, v in cols.items()}
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
            if not src or not ne or src[11:15] <= ne[11:15]:
                continue
            out["interannualRows"] += 1
            if out["interannualRows"] > LIMIT:
                raise ValueError("impact_limit")
            if len(row) != len(names):
                out["invalidRows"] += 1
                continue
            groups[src, ne].append((get(row, subitem),
                                     tuple(cents_value(get(row, col)) for col in cols.values())))
    if out["invalidRows"]:
        out["status"] = "partial_invalid_rows"
        return out
    out["pairs"] = len(groups)
    for key, values in groups.items():
        known = key in index["pairs"]
        old = index["pairs"].get(key)
        out["knownPairs"] += int(known)
        out["unmatchedPairs"] += int(not known)
        out["pairsWithStoredComponents"] += int(old is not None)
        ambiguous = len(set(values)) != len(values) or (
            len(values) > 1 and (subitem is None or any(not r[0] for r in values)))
        out["ambiguousPairs"] += int(ambiguous)
        for i, field in enumerate(FIELDS):
            amounts = [v[1][i] for v in values]
            total = sum(amounts) if not ambiguous and None not in amounts else None
            if total is not None and abs(total) > SAFE_CENTS:
                total = None
            counts = fields[field]
            counts["unavailable" if total is None else "positive" if total > 0 else
                   "negative" if total < 0 else "zero"] += 1
            if total is not None and old is not None and old[field] is not None:
                counts["compared"] += 1
                counts["equal" if old[field] == total else "different"] += 1
    return out


def inspect_rap_archive(stream, day, index):
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
        out[HISTORY] = inspect_history(archive, members[HISTORY], parents["Empenho"], index, day) if HISTORY in members else {"status": "missing_member"}
        for suffix, kind in IMPACTS.items():
            out[suffix] = inspect_impacts(archive, members[suffix], parents, kind, index) if suffix in members else {"status": "missing_member"}
        return out


def main():
    index = load_canonical()
    days = choose_dates(index, os.environ.get("CGU_RAP_ARCHIVE_DATE") or None)
    print("Plano CSV RAP (somente contagens): " + json.dumps({
        "archives": len(days), "dates": days,
        "checkedItems": len(index["histories"]),
        "interannualPairs": len(index["pairs"]),
        "pairsWithStoredComponents": sum(c is not None for c in index["pairs"].values())
    }))
    if not days:
        print("Sem datas candidatas no acervo; nenhuma consulta.")
        return
    for day in days:
        meta = inspect_headers(day)
        print("Metadados ZIP RAP: " + json.dumps(meta))
        if meta["status"] in (401, 403, 405, 429):
            print("Sondagem interrompida por restricao da fonte.")
            break
        result = download_sample(day, meta, inspector=lambda stream, d: inspect_rap_archive(stream, d, index))
        print("Confronto CSV RAP (somente contagens): " + json.dumps(result))
        if result["status"] in (401, 403, 405, 429):
            break


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, csv.Error, zipfile.BadZipFile, UnicodeError):
        print("Confronto CSV RAP nao concluido; dados preservados.")
        raise SystemExit(1)
