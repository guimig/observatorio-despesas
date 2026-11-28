"""Sondagem efemera de ZIPs diarios oficiais da CGU.
Nao e importador: uma data de arquivo pode ser data da ultima alteracao.
Somente contagens agregadas da UG, sem snapshots, credenciais ou payloads nos logs.
"""
import csv
import io
import json
import os
import re
import tempfile
import unicodedata
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime
from pathlib import Path

FIRST = date(2024, 1, 1)
BASE = "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/despesas/"
CAP = 128 * 1024 * 1024
EXPANDED_CAP = 512 * 1024 * 1024
DOC = re.compile(r"^158459\d{5}20\d{2}[A-Z]{2}\d{6}$")
PHASES = {"Empenho": "codigo empenho", "Liquidacao": "codigo liquidacao", "Pagamento": "codigo pagamento"}
SAMPLES = ("2024-01-02", "2025-12-08", "2026-10-16")


def archive_url(day):
    d = date.fromisoformat(day)
    if d < FIRST or d >= date.today():
        raise ValueError("date_out_of_scope")
    return BASE + d.strftime("%Y%m%d") + "_Despesas.zip"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def opener():
    return urllib.request.build_opener(NoRedirect())


def inspect_headers(day, client=None):
    client = client or opener()
    try:
        with client.open(urllib.request.Request(archive_url(day), method="HEAD"), timeout=25) as res:
            raw = res.headers.get("Content-Length")
            size = int(raw) if raw and raw.isdecimal() else None
            return {"date": day, "status": res.status, "bytes": size}
    except urllib.error.HTTPError as exc:
        exc.close()
        return {"date": day, "status": exc.code}
    except (OSError, ValueError):
        return {"date": day, "status": "unavailable"}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.strip("\ufeff").strip().casefold())
                   if not unicodedata.combining(c))


def parse_day(value):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    return None


def known_documents(root):
    known = set()
    folder = Path(root) / "data" / "months"
    for path in folder.glob("20[0-9][0-9]-[0-9][0-9].json"):
        if path.stem < "2024-01":
            continue
        with path.open(encoding="utf-8") as stream:
            data = json.load(stream)
        for doc in data["documents"] + data.get("phaseObservations", []):
            known.add((doc["id"], doc["date"], doc["phase"]))
    return known


def inspect_archive(stream, day, known=None):
    known = known or set()
    expected = date.fromisoformat(day)
    archive_url(day)
    csv.field_size_limit(1024 * 1024)
    out = {}
    with zipfile.ZipFile(stream) as archive:
        members = {}
        prefix = expected.strftime("%Y%m%d") + "_Despesas_"
        for suffix in PHASES:
            matches = [i for i in archive.infolist()
                       if i.filename.rsplit("/", 1)[-1] == prefix + suffix + ".csv"]
            if len(matches) != 1:
                raise ValueError("missing_or_ambiguous_document_csv")
            members[suffix] = matches[0]
        if sum(i.file_size for i in members.values()) > EXPANDED_CAP:
            raise ValueError("expanded_limit")
        for phase, (suffix, code_header) in enumerate(PHASES.items(), 1):
            member = members[suffix]
            with archive.open(member) as raw:
                header = raw.readline(65536)
            try:
                header.decode("utf-8-sig")
                encoding = "utf-8-sig"
            except UnicodeDecodeError:
                encoding = "latin-1"
            result = {"rows": 0, "validRows": 0, "sameIssueDate": 0,
                      "otherIssueDate": 0, "outsideCutoff": 0, "invalidRows": 0,
                      "observationsPresent": 0}
            unique = set()
            with archive.open(member) as raw, io.TextIOWrapper(raw, encoding=encoding, newline="") as text:
                reader = csv.DictReader(text, delimiter=";")
                names = {normalize(h): h for h in (reader.fieldnames or [])}
                if not {"codigo unidade gestora", "data emissao", code_header}.issubset(names):
                    raise ValueError("schema_mismatch")
                for row in reader:
                    if (row.get(names["codigo unidade gestora"]) or "").strip() != "158459":
                        continue
                    result["rows"] += 1
                    if result["rows"] > 500000:
                        raise ValueError("unit_row_limit")
                    identifier = (row.get(names[code_header]) or "").strip()
                    issued = parse_day(row.get(names["data emissao"]) or "")
                    if not issued or not DOC.fullmatch(identifier):
                        result["invalidRows"] += 1
                        continue
                    if issued < FIRST or int(identifier[11:15]) < FIRST.year or issued >= date.today():
                        result["outsideCutoff"] += 1
                        continue
                    result["validRows"] += 1
                    result["sameIssueDate" if issued == expected else "otherIssueDate"] += 1
                    if (row.get(names.get("observacao", "")) or "").strip():
                        result["observationsPresent"] += 1
                    unique.add((identifier, issued.isoformat(), phase))
            result["distinctDocuments"] = len(unique)
            result["knownDocuments"] = len(unique & known)
            result["newCandidates"] = len(unique - known)
            out[suffix] = result
    return out


def download_sample(day, metadata, client=None, root=".", inspector=None):
    size = metadata.get("bytes")
    if metadata.get("status") != 200 or not isinstance(size, int) or not 0 < size <= CAP:
        return {"date": day, "status": "not_downloaded_size_or_http"}
    client = client or opener()
    try:
        with client.open(archive_url(day), timeout=30) as res, tempfile.TemporaryFile() as temp:
            received = 0
            while True:
                chunk = res.read(1024 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > CAP or received > size:
                    return {"date": day, "status": "compressed_limit"}
                temp.write(chunk)
            if received != size:
                return {"date": day, "status": "size_changed"}
            temp.seek(0)
            if inspector is not None:
                return {"date": day, "status": "inspected", "bytes": received,
                        "comparison": inspector(temp, day)}
            return {"date": day, "status": "inspected", "bytes": received,
                    "phases": inspect_archive(temp, day, known_documents(root))}
    except urllib.error.HTTPError as exc:
        exc.close()
        return {"date": day, "status": exc.code}
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile, UnicodeError, KeyError):
        return {"date": day, "status": "unavailable_or_invalid_schema"}


def main():
    day = os.environ.get("CGU_PROBE_DATE") or SAMPLES[-1]
    archive_url(day)
    dates = list(dict.fromkeys((*SAMPLES, day)))
    metadata = []
    for value in dates:
        result = inspect_headers(value)
        metadata.append(result)
        if result["status"] in (401, 403, 405, 429):
            break
    print("CGU ZIP metadados (somente status): " + json.dumps(metadata))
    target = next((r for r in metadata if r["date"] == day), None)
    if target and not any(r["status"] in (401, 403, 405, 429) for r in metadata):
        print("CGU ZIP amostra (somente contagens): " + json.dumps(download_sample(day, target)))
    else:
        print("Sondagem interrompida por bloqueio ou metadados indisponiveis.")


if __name__ == "__main__":
    main()
