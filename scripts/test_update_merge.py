#!/usr/bin/env python3
"""Regression checks for multi-source candidate deduplication."""

from __future__ import annotations

import unittest

from update import candidate_identity_keys, merge_candidates


class MergeCandidatesTests(unittest.TestCase):
    def test_bridge_record_merges_arxiv_and_github_groups(self) -> None:
        raw = [
            {
                "title": "MonkeyOCRv2: A Visual-Text Foundation Model for Document AI",
                "links": {"paper": "http://arxiv.org/abs/2607.11562v1", "github": "unknown"},
                "external_ids": {"arxiv": "2607.11562"},
                "source": "arXiv",
                "source_id": "2607.11562",
                "published_at": "2026-07-13T13:43:39Z",
                "matched_category": "representation",
                "org_guess": "unknown",
            },
            {
                "title": "MonkeyOCRv2",
                "links": {"paper": "unknown", "github": "https://github.com/Yuliang-Liu/MonkeyOCRv2"},
                "external_ids": {},
                "source": "GitHub",
                "source_id": "Yuliang-Liu/MonkeyOCRv2",
                "published_at": "2026-07-10T03:55:38Z",
                "matched_category": "representation",
                "org_guess": "unknown",
            },
            {
                "title": "MonkeyOCRv2: A Visual-Text Foundation Model for Document AI",
                "links": {
                    "paper": "https://arxiv.org/abs/2607.11562",
                    "github": "https://github.com/Yuliang-Liu/MonkeyOCRv2",
                },
                "external_ids": {"arxiv": "2607.11562"},
                "source": "Hugging Face Papers",
                "source_id": "2607.11562",
                "published_at": "2026-07-13T13:43:39+00:00",
                "matched_category": "representation",
                "org_guess": "unknown",
            },
        ]

        merged = merge_candidates(raw, [])

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["sources"], ["arXiv", "GitHub", "Hugging Face Papers"])
        self.assertEqual(len(merged[0]["source_records"]), 3)
        self.assertIn("arxiv:2607.11562", candidate_identity_keys(merged[0]))
        self.assertIn("github:yuliang-liu/monkeyocrv2", candidate_identity_keys(merged[0]))


if __name__ == "__main__":
    unittest.main()
