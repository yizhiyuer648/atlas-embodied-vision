#!/usr/bin/env python3
"""Offline regression tests for scripts/update_academic.py."""

from __future__ import annotations

import contextlib
import copy
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from . import update_academic
    from .update_academic import (
        build_candidates,
        build_candidate_batch,
        extract_arxiv,
        load_fixture,
        load_tracker,
        merge_raw_records,
        parse_cvf_entries,
    )
except ImportError:
    import update_academic
    from update_academic import (
        build_candidates,
        build_candidate_batch,
        extract_arxiv,
        load_fixture,
        load_tracker,
        merge_raw_records,
        parse_cvf_entries,
    )


HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "academic_events.json"


class AcademicCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tracker = load_tracker()
        self.records = load_fixture(FIXTURE)

    def test_arxiv_version_is_removed(self) -> None:
        self.assertEqual(extract_arxiv("https://arxiv.org/abs/2607.00001v3"), "2607.00001")
        self.assertEqual(extract_arxiv("arXiv:2607.00001v1"), "2607.00001")

    def test_crossref_and_openalex_merge_by_doi(self) -> None:
        groups = merge_raw_records(self.records)
        self.assertEqual(len(groups), 2)
        merged_sources = {record["source"] for group in groups for record in group if len(group) == 2}
        self.assertEqual(merged_sources, {"Crossref", "OpenAlex"})

    def test_existing_arxiv_becomes_publication_event(self) -> None:
        papers = [
            {
                "id": "2607.00001",
                "title": "Atlas Fixture: Vision-Language-Action Policies with Long Context",
                "authors": ["Lin Example", "Ming Example"],
                "published": "2026-07-01",
                "url": "https://arxiv.org/abs/2607.00001v1",
            }
        ]
        candidates = build_candidates(self.records, papers, self.tracker)
        tro = next(candidate for candidate in candidates if candidate["venue"]["id"] == "tro")
        self.assertTrue(tro["duplicate_match"]["is_duplicate"])
        self.assertEqual(tro["duplicate_match"]["matched_by"], "arxiv")
        self.assertEqual(tro["duplicate_match"]["matches"][0]["paper_id"], "2607.00001")
        self.assertEqual(tro["status"], "needs_review")
        self.assertEqual(tro["candidate_kind"], "已有论文的发表事件候选")
        self.assertEqual(tro["sources"], ["Crossref", "OpenAlex"])

    def test_conflicting_dois_never_merge_on_title(self) -> None:
        first = dict(self.records[0])
        second = dict(self.records[0])
        second["source"] = "OpenAlex"
        second["source_id"] = "W-CONFLICT"
        second["external_ids"] = {"doi": "10.5555/atlas.fixture.other", "arxiv": ""}
        second["links"] = {"landing": "https://openalex.org/W-CONFLICT", "doi": "https://doi.org/10.5555/atlas.fixture.other", "arxiv": ""}
        first["external_ids"] = {"doi": "10.5555/atlas.fixture.1", "arxiv": ""}
        first["links"] = {"landing": "https://doi.org/10.5555/atlas.fixture.1", "doi": "https://doi.org/10.5555/atlas.fixture.1", "arxiv": ""}
        self.assertEqual(len(merge_raw_records([first, second])), 2)

    def test_identifierless_bridge_does_not_pollute_conflicting_doi_group(self) -> None:
        first = dict(self.records[0])
        first["external_ids"] = {"doi": "10.5555/version.a", "arxiv": ""}
        first["links"] = {"landing": "https://doi.org/10.5555/version.a", "doi": "https://doi.org/10.5555/version.a", "arxiv": ""}
        second = dict(first)
        second["source"] = "OpenAlex"
        second["source_id"] = "W-VERSION-B"
        second["external_ids"] = {"doi": "10.5555/version.b", "arxiv": ""}
        second["links"] = {"landing": "https://doi.org/10.5555/version.b", "doi": "https://doi.org/10.5555/version.b", "arxiv": ""}
        bridge = dict(first)
        bridge["source"] = "DBLP"
        bridge["source_id"] = "conf/test/bridge"
        bridge["external_ids"] = {"doi": "", "arxiv": ""}
        bridge["links"] = {"landing": "https://dblp.org/rec/conf/test/bridge", "doi": "", "arxiv": ""}
        groups = merge_raw_records([first, second, bridge])
        self.assertEqual(len(groups), 3)
        bridge_group = next(group for group in groups if any(record["source"] == "DBLP" for record in group))
        self.assertEqual(len(bridge_group), 1)
        self.assertIn("冲突组", bridge_group[0]["_dedupe_ambiguity"])

    def test_existing_lower_priority_match_is_blocked_by_doi_conflict(self) -> None:
        papers = [
            {
                "id": "2607.00001",
                "title": "Atlas Fixture: Vision-Language-Action Policies with Long Context",
                "authors": ["Lin Example", "Ming Example"],
                "published": "2026-07-08",
                "url": "https://arxiv.org/abs/2607.00001",
                "doi": "10.5555/old.version",
            }
        ]
        candidates = build_candidates(self.records[:1], papers, self.tracker)
        match = candidates[0]["duplicate_match"]
        self.assertFalse(match["is_duplicate"])
        self.assertEqual(match["possible_matches"][0]["reason"], "strong_identifier_conflict")
        self.assertEqual(match["possible_matches"][0]["conflicting_fields"], ["doi"])

    def test_same_doi_with_conflicting_arxiv_needs_manual_review(self) -> None:
        papers = [
            {
                "id": "2607.99999",
                "title": "Atlas Fixture: Vision-Language-Action Policies with Long Context",
                "authors": ["Lin Example", "Ming Example"],
                "published": "2026-07-08",
                "url": "https://arxiv.org/abs/2607.99999",
                "doi": "10.5555/atlas.fixture.1",
            }
        ]
        match = build_candidates(self.records[:1], papers, self.tracker)[0]["duplicate_match"]
        self.assertFalse(match["is_duplicate"])
        self.assertEqual(match["possible_matches"][0]["conflicting_fields"], ["arxiv"])

    def test_version_only_doi_is_indexed(self) -> None:
        papers = [
            {
                "id": "local-fixture-paper",
                "title": "Atlas Fixture: Vision-Language-Action Policies with Long Context",
                "authors": ["Lin Example", "Ming Example"],
                "published": "2025-12-01",
                "url": "unknown",
                "versions": [
                    {
                        "kind": "journal",
                        "published": "2026-07-08",
                        "external_ids": {"doi": "10.5555/atlas.fixture.1"},
                        "links": {"landing": "https://doi.org/10.5555/atlas.fixture.1"},
                    }
                ],
            }
        ]
        match = build_candidates(self.records[:1], papers, self.tracker)[0]["duplicate_match"]
        self.assertTrue(match["is_duplicate"])
        self.assertEqual(match["matched_by"], "doi")
        self.assertEqual(match["matches"][0]["paper_id"], "local-fixture-paper")

    def test_known_publication_event_is_skipped_from_candidate_queue(self) -> None:
        tracker = copy.deepcopy(self.tracker)
        tracker["publication_events"].append(
            {
                "id": "fixture-authoritative-event",
                "work_id": "doi:10.5555/atlas.fixture.1",
                "paper_id": "doi:10.5555/atlas.fixture.1",
                "title": "Atlas Fixture: Vision-Language-Action Policies with Long Context",
                "status": "published_online",
                "evidence_level": "E1",
                "source_url": "https://doi.org/10.5555/atlas.fixture.1",
                "versions": [
                    {"kind": "journal", "identifier": "doi:10.5555/atlas.fixture.1"}
                ],
            }
        )
        batch = build_candidate_batch(self.records[:1], [], tracker)
        self.assertEqual(batch["candidates"], [])
        self.assertEqual(len(batch["skipped_authoritative_events"]), 1)
        publication_match = batch["skipped_authoritative_events"][0]["publication_event_match"]
        self.assertTrue(publication_match["is_known"])
        self.assertEqual(publication_match["events"][0]["event_id"], "fixture-authoritative-event")

    def test_candidate_id_prefers_arxiv_over_provider_id(self) -> None:
        openalex = dict(self.records[1])
        openalex["title"] = "Stable arXiv Vision-Language Model"
        openalex["authors"] = ["Stable Author"]
        openalex["published"] = "2026-07-09"
        openalex["venue_hint"] = "CVPR"
        openalex["external_ids"] = {"doi": "", "arxiv": "2607.12345"}
        openalex["links"] = {"landing": "https://openalex.org/W-STABLE", "doi": "", "arxiv": "https://arxiv.org/abs/2607.12345"}
        openalex["source_id"] = "https://openalex.org/W-STABLE"
        dblp = dict(openalex)
        dblp["source"] = "DBLP"
        dblp["source_id"] = "conf/cvpr/stable"
        dblp["source_url"] = "https://dblp.org/rec/conf/cvpr/stable"
        first_id = build_candidates([openalex], [], self.tracker)[0]["id"]
        second_id = build_candidates([dblp], [], self.tracker)[0]["id"]
        combined_id = build_candidates([openalex, dblp], [], self.tracker)[0]["id"]
        self.assertEqual(first_id, second_id)
        self.assertEqual(first_id, combined_id)

    def test_matching_prefers_arxiv_over_provider_id(self) -> None:
        record = dict(self.records[1])
        record["title"] = "Stable arXiv Vision-Language Model"
        record["authors"] = ["Stable Author"]
        record["published"] = "2026-07-09"
        record["source"] = "OpenAlex"
        record["source_id"] = "https://openalex.org/W-STABLE"
        record["external_ids"] = {"doi": "", "arxiv": "2607.12345"}
        record["links"] = {
            "landing": "https://openalex.org/W-STABLE",
            "doi": "",
            "arxiv": "https://arxiv.org/abs/2607.12345",
        }

        tracker = {
            "publication_events": [
                {
                    "id": "event-via-platform",
                    "paper_id": "platform-paper",
                    "title": "Provider record",
                    "status": "published_online",
                    "evidence_level": "E4",
                    "source_url": "https://openalex.org/W-STABLE",
                    "work_id": "openalex:W-STABLE",
                    "versions": [],
                },
                {
                    "id": "event-via-arxiv",
                    "paper_id": "arxiv-paper",
                    "title": "Stable arXiv Vision-Language Model",
                    "status": "published_online",
                    "evidence_level": "E1",
                    "source_url": "https://arxiv.org/abs/2607.12345",
                    "work_id": "arxiv:2607.12345",
                    "versions": [],
                },
            ]
        }
        event_match = update_academic.match_publication_events(
            [record], update_academic.build_publication_event_index(tracker)
        )
        self.assertEqual(event_match["matched_by"], "arxiv")
        self.assertEqual(event_match["events"][0]["event_id"], "event-via-arxiv")

        papers = [
            {
                "id": "platform-paper",
                "title": "Provider record",
                "authors": ["Provider Author"],
                "published": "2026-07-09",
                "external_ids": {"openalex": "W-STABLE"},
            },
            {
                "id": "arxiv-paper",
                "title": "Stable arXiv Vision-Language Model",
                "authors": ["Stable Author"],
                "published": "2026-07-09",
                "url": "https://arxiv.org/abs/2607.12345",
            },
        ]
        paper_match = update_academic.match_existing_papers(
            [record], update_academic.build_paper_index(papers)
        )
        self.assertEqual(paper_match["matched_by"], "arxiv")
        self.assertEqual(paper_match["matches"][0]["paper_id"], "arxiv-paper")

    def test_crossref_and_dblp_promote_to_e3(self) -> None:
        crossref = dict(self.records[0])
        dblp = dict(crossref)
        dblp["source"] = "DBLP"
        dblp["source_id"] = "journals/tro/fixture"
        dblp["source_url"] = "https://dblp.org/rec/journals/tro/fixture"
        dblp["evidence_level"] = "E4"
        candidate = build_candidates([crossref, dblp], [], self.tracker)[0]
        self.assertEqual(candidate["evidence_level"], "E3")
        self.assertEqual(candidate["status"], "needs_review")

    def test_cvf_index_extracts_title_and_authors(self) -> None:
        page = '''
        <dt class="ptitle"><br><a href="/content/CVPR2026/html/Test.html">A Vision-Language Model</a></dt>
        <dd>
          <form><input type="hidden" name="query_author" value="Ada Example"></form>
          <form><input type="hidden" name="query_author" value="Bo Example"></form>
        </dd>
        '''
        self.assertEqual(
            parse_cvf_entries(page),
            [("/content/CVPR2026/html/Test.html", "A Vision-Language Model", ["Ada Example", "Bo Example"])],
        )

    def test_fixture_has_no_authority_side_effect(self) -> None:
        before = (HERE.parent / "data" / "academic_tracker.json").read_bytes()
        candidates = build_candidates(self.records, [], self.tracker)
        after = (HERE.parent / "data" / "academic_tracker.json").read_bytes()
        self.assertEqual(before, after)
        self.assertEqual(len(candidates), 2)
        self.assertTrue(all(candidate["manual_review_required"] for candidate in candidates))
        self.assertTrue(all(candidate["status"] == "needs_review" for candidate in candidates))

    def test_total_network_failure_marks_stale_and_preserves_existing_review_queue(self) -> None:
        def failed_provider(*_args: object, **_kwargs: object) -> tuple[list[dict], list[str]]:
            return [], ["offline fixture failure"]

        output = HERE / "fixtures" / "academic_candidates_network_failure_test.json"
        previous = {
            "generated_at": "2026-07-18T00:00:00+00:00",
            "state": "ready",
            "candidate_count": 1,
            "candidates": [{"id": "keep-me", "duplicate_match": {"is_duplicate": False}}],
        }
        output.write_text(json.dumps(previous), encoding="utf-8")
        try:
            argv = [
                "update_academic.py",
                "--sources",
                "crossref",
                "--categories",
                "vla",
                "--per-query",
                "1",
            ]
            with (
                patch.object(update_academic, "OUTPUT_PATH", output),
                patch.dict(update_academic.PROVIDERS, {"crossref": failed_provider}),
                patch.object(sys, "argv", argv),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(update_academic.main(), 1)
            failed = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(failed["state"], "failed_preserved_previous")
            self.assertEqual(failed["candidates"][0]["id"], "keep-me")
            self.assertEqual(failed["previous_success_generated_at"], "2026-07-18T00:00:00+00:00")
        finally:
            output.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
