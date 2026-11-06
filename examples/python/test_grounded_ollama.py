import json
import unittest
from types import SimpleNamespace

from grounded_ollama import REFUSAL, answer_from_context, require_local_model


class FakeModel:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def invoke(self, messages):
        self.calls.append(messages)
        return SimpleNamespace(content=self.payload)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.passages = [
            {"source": "computer.pdf", "text": "A computer processes data according to instructions."},
            {"source": "other.pdf", "text": "Plants use light to grow."},
        ]

    def test_valid_quote_is_returned_with_source(self):
        model = FakeModel(json.dumps({"evidence": [{"source": "computer.pdf", "quote": "A computer processes data according to instructions."}]}))
        answer = answer_from_context("What does a computer do?", self.passages, model, ["computer.pdf"])
        self.assertIn("Source: computer.pdf", answer)
        self.assertIn("=== START RETRIEVED PDF CONTEXT ===", model.calls[0][1][1])
        self.assertNotIn("other.pdf", model.calls[0][1][1])

    def test_rejects_invented_and_cross_document_quotes(self):
        for item in [
            {"source": "computer.pdf", "quote": "A computer was invented in 1920."},
            {"source": "computer.pdf", "quote": "Plants use light to grow."},
            {"source": "other.pdf", "quote": "Plants use light to grow."},
        ]:
            model = FakeModel(json.dumps({"evidence": [item]}))
            self.assertEqual(answer_from_context("Who invented it?", self.passages, model, ["computer.pdf"]), REFUSAL)

    def test_refuses_empty_or_malformed_model_output(self):
        for payload in ('not json', '{"evidence": []}', '{"evidence": [], "answer": "invented"}'):
            self.assertEqual(answer_from_context("What?", self.passages, FakeModel(payload)), REFUSAL)

    def test_rejects_unknown_source_without_calling_model(self):
        model = FakeModel('{}')
        with self.assertRaises(ValueError):
            answer_from_context("What?", self.passages, model, ["missing.pdf"])
        self.assertEqual(model.calls, [])

    def test_rejects_cloud_and_remote_model_aliases(self):
        self.assertEqual(require_local_model("llama3.2", [{"name": "llama3.2:latest"}]), "llama3.2:latest")
        with self.assertRaises(ValueError):
            require_local_model("remote", [{"name": "remote:latest", "remote_host": "example.test"}])
        with self.assertRaises(ValueError):
            require_local_model("model:cloud", [{"name": "model:cloud"}])


if __name__ == "__main__":
    unittest.main()
