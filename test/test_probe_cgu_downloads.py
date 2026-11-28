import io
import unittest
import zipfile
from src.probe_cgu_downloads import archive_url, inspect_archive, CAP, download_sample

class ProbeTests(unittest.TestCase):
    def test_archive_date(self):
        self.assertTrue(archive_url("2024-01-02").endswith("20240102_Despesas.zip"))
        with self.assertRaises(ValueError):
            archive_url("2023-12-31")

    def test_aggregate_only(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            for suffix, code, kind in [("Empenho","Empenho","NE"),("Liquidacao","Liquidação","NS"),("Pagamento","Pagamento","OB")]:
                header = f"Código Unidade Gestora;Código {code};Data Emissão;Observação"
                rows = [
                    f"158459;158459264222024{kind}000001;02/01/2024;PESSOA",
                    f"158459;158459264222024{kind}000002;01/01/2024;OUTRO",
                    f"158459;158459264222023{kind}000003;31/12/2023;IGNORAR",
                    f"158125;158125264222024{kind}000004;02/01/2024;OUTRO ORGAO",
                ]
                z.writestr(f"20240102_Despesas_{suffix}.csv", ("\n".join([header]+rows)+"\n").encode("latin-1"))
        data.seek(0)
        result = inspect_archive(data, "2024-01-02", {("158459264222024NE000001","2024-01-02",1)})
        self.assertEqual(result["Empenho"]["sameIssueDate"],1)
        self.assertEqual(result["Empenho"]["otherIssueDate"],1)
        self.assertEqual(result["Empenho"]["outsideCutoff"],1)
        self.assertEqual(result["Empenho"]["knownDocuments"],1)
        self.assertNotIn("PESSOA",str(result))
        self.assertNotIn("15845926422",str(result))

    def test_reject_size(self):
        self.assertEqual(download_sample("2024-01-02",{"status":200,"bytes":CAP+1})["status"],"not_downloaded_size_or_http")


from src.probe_rap_csv import canonical_index, choose_dates, inspect_rap_archive, cents_value

class RapCsvTests(unittest.TestCase):
    ne = "158459264222024NE000001"
    ob = "158459264222025OB000001"
    ns = "158459264222025NS000001"
    day = "2025-01-11"

    def fixture(self):
        event = {"date": self.day, "operation": "INSCRICAO EM RP",
                 "quantity": "1", "unitPrice": "100.00", "cents": 10000}
        c = {"rowCount": 1, "repeatedRows": 0, "liquidatedCents": 0,
             "paidCents": 0, "rpInscribedCents": 0, "rpCancelledCents": 0, "rpPaidCents": 10000}
        return canonical_index([
            {"unit": "158459", "month": "2024-12",
             "documents": [{"id": self.ne, "phase": 1, "itemsDetailVersion": 2}],
             "itemsByDocument": {self.ne: [{"seq": 1, "historyChecked": True, "movements": [event, event]}]}},
            {"unit": "158459", "month": "2025-01",
             "documents": [{"id": self.ob, "phase": 3, "date": self.day, "paymentLinksChecked": True}],
             "relations": [{"from": self.ob, "to": self.ne, "impactComponents": c}]}])

    def archive(self, entries):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            for suffix, body in entries.items():
                z.writestr("20250111_Despesas_" + suffix + ".csv", body.encode("latin-1"))
        data.seek(0)
        return data

    def test_match_history_multiplicity_and_impact_by_full_identity(self):
        row = f"{self.ne};1;11/01/2025;INSCRIÇÃO EM RP;1;100,00;100,00;PESSOA\n"
        a = self.archive({
            "ItemEmpenhoHistorico": "Código Empenho;Sequencial;Data Operação;Operação;Quantidade;Valor Unitário;Valor Total;Observação\n" + row + row,
            "Pagamento_EmpenhosImpactados": f"Código Pagamento;Código Empenho;Subitem;Valor Liquidado;Valor Pago;Valor Resto Inscrito;Valor Resto Cancelado;Valor Resto Pago\n{self.ob};{self.ne};01;0,00;0,00;0,00;0,00;100,00\n",
        })
        result = inspect_rap_archive(a, self.day, self.fixture())
        history = result["ItemEmpenhoHistorico"]
        self.assertEqual(history["sameMultisetItems"], 1)
        self.assertEqual(history["archiveRepeatedOccurrences"], 1)
        self.assertEqual(history["matchedOccurrences"], 2)
        impact = result["Pagamento_EmpenhosImpactados"]
        self.assertEqual(impact["fields"]["rpPaidCents"]["equal"], 1)
        self.assertEqual(impact["fields"]["rpCancelledCents"]["zero"], 1)
        self.assertEqual(result["Liquidacao_EmpenhosImpactados"]["status"], "missing_member")
        self.assertNotIn(self.ne, str(result))
        self.assertNotIn("PESSOA", str(result))

    def test_join_with_official_internal_ids_and_ambiguity(self):
        row = "1;2;01;100,00\n"
        a = self.archive({
            "Empenho": f"Id Empenho;Código Empenho\n2;{self.ne}\n",
            "Pagamento": f"Id Pagamento;Código Pagamento\n1;{self.ob}\n",
            "Pagamento_EmpenhosImpactados": "Id Pagamento;Id Empenho;Subitem;Valor Resto Pago\n" + row + row,
        })
        result = inspect_rap_archive(a, self.day, self.fixture())["Pagamento_EmpenhosImpactados"]
        self.assertEqual(result["knownPairs"], 1)
        self.assertEqual(result["ambiguousPairs"], 1)
        self.assertEqual(result["fields"]["rpPaidCents"]["unavailable"], 1)
        self.assertEqual(result["fields"]["rpPaidCents"]["compared"], 0)

    def test_partial_fields_and_explicit_zero(self):
        a = self.archive({
            "Pagamento_EmpenhosImpactados": f"Código Pagamento;Código Empenho;Valor Resto Pago;Valor Resto Cancelado\n{self.ob};{self.ne};0,00;\n",
        })
        result = inspect_rap_archive(a, self.day, self.fixture())["Pagamento_EmpenhosImpactados"]
        self.assertEqual(result["fields"]["rpPaidCents"]["different"], 1)
        self.assertEqual(result["fields"]["rpCancelledCents"]["unavailable"], 1)
        self.assertEqual(result["fields"]["rpInscribedCents"]["compared"], 0)
        self.assertEqual(cents_value("1.234,56"), 123456)
        self.assertIsNone(cents_value("1,001"))

    def test_schema_ambiguity_and_absence_not_zero(self):
        a = self.archive({"ItemEmpenhoHistorico": "Código Empenho;Sequencial;Sequencial Item;Operação\n"})
        result = inspect_rap_archive(a, self.day, self.fixture())
        self.assertEqual(result["ItemEmpenhoHistorico"]["status"], "schema_unavailable")
        self.assertEqual(result["ItemEmpenhoHistorico"]["targetItemsForArchiveDate"], 1)
        self.assertEqual(choose_dates(self.fixture()), [self.day])
        with self.assertRaises(ValueError):
            choose_dates(self.fixture(), "2023-12-31")
