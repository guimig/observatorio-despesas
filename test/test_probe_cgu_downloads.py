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


    def test_targeted_date_rotation_and_2025_search(self):
        ne25 = "158459264222025NE000010"
        ob26 = "158459264222026OB000010"
        event = {"date": self.day, "operation": "INSCRICAO EM RP",
                 "quantity": "1", "unitPrice": "100.00", "cents": 10000}
        idx = canonical_index([
            {"unit": "158459", "month": "2024-12",
             "documents": [{"id": self.ne, "phase": 1, "date": "2024-12-03", "itemsDetailVersion": 2}],
             "itemsByDocument": {self.ne: [{"seq": 1, "historyChecked": True, "movements": [event]}]}},
            {"unit": "158459", "month": "2025-12",
             "documents": [{"id": ne25, "phase": 1, "date": "2025-12-12"}],
             "commitmentObservations": [{"id": self.ne, "date": "2025-12-19"}]},
            {"unit": "158459", "month": "2026-11",
             "documents": [{"id": ob26, "phase": 3, "date": "2026-11-16", "paymentLinksChecked": True}],
             "relations": [{"from": ob26, "to": ne25, "cents": 10000}]}])
        self.assertEqual(choose_dates(idx, window=0), ["2024-12-03", "2026-11-16"])
        self.assertEqual(choose_dates(idx, window=1), ["2025-12-12", "2026-11-16"])
        self.assertEqual(choose_dates(idx, window=2)[0], "2025-12-19")
        self.assertEqual(choose_dates(idx, "2025-01-11", window=3), [self.day])
        self.assertEqual(len(choose_dates(idx, window=500)), 2)

    def test_history_presence_different_from_inscription_and_cancel_hint(self):
        idx = self.fixture()
        idx["historyTargets"][self.day].add((self.ne, 1))
        idx["origin2025Targets"][self.day].add("158459264222025NE000010")
        a = self.archive({
            "ItemEmpenhoHistorico": "Código Empenho;Sequencial;Data Operação;Operação;Quantidade;Valor Unitário;Valor Total\n"
                + f"{self.ne};1;11/01/2025;INCLUSAO;1;100,00;100,00\n"
                + "158459264222025NE000010;1;11/01/2025;CANCELAMENTO;1;100,00;100,00\n",
            "Pagamento_EmpenhosImpactados": "Código Pagamento;Código Empenho;Valor Resto Pago;Valor Anulado\n"
                + f"{self.ob};{self.ne};100,00;0,00\n",
        })
        result = inspect_rap_archive(a, self.day, idx)
        history = result["ItemEmpenhoHistorico"]
        self.assertEqual(history["targetItemsSeenInHistory"], 1)
        self.assertEqual(history["targetItemsWithInscription"], 0)
        self.assertEqual(history["search2025NotesSeen"], 1)
        self.assertEqual(history["search2025NotesWithInscription"], 0)
        self.assertEqual(history["operationHints"]["cancellation"], 1)
        self.assertEqual(result["Pagamento_EmpenhosImpactados"]["cancellationHeaderCandidates"], 1)
        self.assertFalse(result["Pagamento_EmpenhosImpactados"]["recognizedFields"]["rpCancelledCents"])
        self.assertNotIn(self.ne, str(result))


    def test_target_handoff_bounded_and_no_personal_fields(self):
        from src.probe_rap_csv import bounded_targets
        idx = self.fixture()
        idx["pairs"][(self.ob, self.ne)] = None
        idx["histories"] = {}
        a = self.archive({
            "ItemEmpenhoHistorico": "Código Empenho;Sequencial;Data Operação;Operação;Quantidade;Valor Unitário;Valor Total;Observação\n"
                + f"{self.ne};1;11/01/2025;INSCRIÇÃO EM RP;1;100,00;100,00;PESSOA\n",
            "Pagamento_EmpenhosImpactados": "Código Pagamento;Código Empenho;Valor Resto Pago;Valor de Restos a Pagar Cancelados\n"
                + f"{self.ob};{self.ne};100,00;0,00\n",
        })
        targets = {"histories": [], "impacts": []}
        summary = inspect_rap_archive(a, self.day, idx, targets)
        plan = bounded_targets(targets)
        self.assertEqual(len(plan["histories"]), 1)
        self.assertEqual(len(plan["impacts"]), 1)
        self.assertEqual(plan["impacts"][0]["components"]["rpCancelledCents"], 0)
        self.assertNotIn("PESSOA", str(plan))
        self.assertNotIn(self.ne, str(summary))
        # Snapshots conflitantes não podem ser mesclados.
        targets["histories"].append({**plan["histories"][0], "events": []})
        self.assertEqual(bounded_targets(targets)["histories"], [])


    def test_missing_positive_payment_candidates_and_focus(self):
        from src.probe_rap_csv import bounded_targets
        idx = self.fixture()
        missing_ob = "158459264222025OB000002"
        unknown_ne = "158459264222024NE000002"
        a = self.archive({
            "Pagamento_EmpenhosImpactados": "Código Pagamento;Código Empenho;Valor Pago;Valor Resto Inscrito;Valor Resto Cancelado;Valor Resto Pago\n"
                + f"{self.ob};{unknown_ne};0,00;0,00;0,00;100,00\n"
                + f"{missing_ob};{self.ne};0,00;0,00;0,00;200,00\n",
        })
        targets = {"histories": [], "impacts": []}
        report = inspect_rap_archive(a, self.day, idx, targets)["Pagamento_EmpenhosImpactados"]
        self.assertEqual(report["missingPairSourcePresent"], 1)
        self.assertEqual(report["missingPairSourceAbsent"], 1)
        self.assertEqual(report["missingPaymentCandidates"], 2)
        self.assertEqual(len(bounded_targets(targets, idx)["impacts"]), 2)
        self.assertNotIn(missing_ob, str(report))
        idx["storedPairs"].add((self.ob, unknown_ne))
        targets = {"histories": [], "impacts": []}
        report = inspect_rap_archive(self.archive({
            "Pagamento_EmpenhosImpactados": "Código Pagamento;Código Empenho;Valor Pago;Valor Resto Inscrito;Valor Resto Cancelado;Valor Resto Pago\n"
                + f"{self.ob};{unknown_ne};0,00;0,00;0,00;100,00\n",
        }), self.day, idx, targets)["Pagamento_EmpenhosImpactados"]
        self.assertEqual(report["unmatchedButStored"], 1)
        self.assertEqual(targets["impacts"], [])
        self.assertEqual(choose_dates(idx, window=0, focus="2025-02-11"),
                         [self.day, "2025-02-11"])
        self.assertEqual(choose_dates(idx, self.day, focus="2025-02-11"), [self.day])
