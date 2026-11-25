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
