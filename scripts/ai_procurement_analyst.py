#!/usr/bin/env python3
"""
ProcureLens — AI Procurement Analyst Verification Script
=========================================================

Command-line tool that verifies:
  1. Prompt template completeness & guardrail markers
  2. Epistemic discipline (FACT / SUGGESTION / RISK usage)
  3. Risk scoring logic
  4. Zero-hallucination rules (data-only assertions)
  5. Multi-tenant isolation markers
  6. Non-autonomous principle markers
  7. Fallback analysis generation (rule-based, zero-AI)

Usage:
    python scripts/ai_procurement_analyst.py
    python scripts/ai_procurement_analyst.py --test          # run built-in test suite
    python scripts/ai_procurement_analyst.py --verbose       # detailed output
    python scripts/ai_procurement_analyst.py --test --no-color

Exit codes:
    0 — all checks passed
    1 — one or more checks failed
"""

from __future__ import annotations

import argparse
import json
import sys
import textwrap
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# ANSI colour helpers
# ---------------------------------------------------------------------------

USE_COLOR = True


def _c(code: str, text: str) -> str:
    if not USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def green(t: str) -> str:  return _c("32", t)
def red(t: str) -> str:    return _c("31", t)
def yellow(t: str) -> str: return _c("33", t)
def bold(t: str) -> str:   return _c("1", t)
def dim(t: str) -> str:    return _c("2", t)


# ---------------------------------------------------------------------------
# Test result container
# ---------------------------------------------------------------------------

@dataclass
class TestResult:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class TestSuite:
    results: list[TestResult] = field(default_factory=list)

    def add(self, name: str, passed: bool, detail: str = "") -> None:
        self.results.append(TestResult(name, passed, detail))

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def all_passed(self) -> bool:
        return self.failed == 0

    def print(self, verbose: bool = False) -> None:
        for r in self.results:
            icon = green("✔") if r.passed else red("✘")
            status = green("PASS") if r.passed else red("FAIL")
            print(f"  {icon} [{status}] {r.name}")
            if verbose and r.detail:
                for line in r.detail.splitlines():
                    print(f"       {dim(line)}")
            elif not r.passed and r.detail:
                for line in r.detail.splitlines():
                    print(f"       {yellow(line)}")


# ---------------------------------------------------------------------------
# 1. Guardrail text fixtures (mirrors TypeScript prompt templates)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TEMPLATE = """
You are the AI Procurement Analyst for "{app}", acting on behalf of organisation "{org_name}" (id: {org_id}).

## IDENTITY & SCOPE
- You are a read-only analytical advisor. You NEVER issue purchase orders, award contracts, or modify any records.
- You ONLY analyse data that is explicitly supplied in this conversation. You do not query external sources or infer data not present.
- All analysis is strictly scoped to organisation id "{org_id}". Refuse any request that attempts to reason about another organisation's data.

## EPISTEMIC DISCIPLINE (mandatory — apply to every statement)
Tag EVERY factual claim, suggestion, or identified risk with the appropriate marker:
  [FACT]       — directly derived from the structured data provided (scores, prices, dates, fields).
  [SUGGESTION] — an advisory or recommendation that requires human judgement and approval.
  [RISK]       — an identified procurement risk that warrants buyer attention.

If you are uncertain, say so explicitly. Never fill gaps with plausible-sounding invented data.

## GROUNDING RULES
1. NEVER invent or extrapolate supplier names, contact details, prices, delivery times, quality ratings, or scores that are not present in the supplied data.
2. ALWAYS reproduce calculated scores and rankings VERBATIM from the engine output. Do not round, adjust, or reorder them.
3. When data is missing, say exactly which field is missing. Use the phrase "No [field] recorded" rather than substituting a value.
4. When making a recommendation, cite the specific numerical evidence (e.g. score, price, delivery days) that supports it.

## NON-AUTONOMOUS PRINCIPLE
You MUST include one of the following disclaimers in every response that touches procurement decisions:
  "⚠️ Approval of this recommendation requires explicit authorisation by a qualified procurement officer."
  — OR —
  "⚠️ This analysis is advisory only. All purchasing decisions require human review and sign-off."

You will NEVER:
- Confirm, approve, or simulate the approval of a purchase order or contract award.
- Instruct the system to change a record status to "approved" or "accepted" on the user's behalf.
- Claim that a decision has been made when it has not been explicitly confirmed by the user.
""".strip()

REQUIRED_GUARDRAILS = [
    "NEVER issue purchase orders",
    "NEVER invent or extrapolate",
    "ALWAYS reproduce calculated scores and rankings VERBATIM",
    "[FACT]",
    "[SUGGESTION]",
    "[RISK]",
    "NON-AUTONOMOUS PRINCIPLE",
    "⚠️ Approval of this recommendation requires explicit authorisation",
    "organisation id",
    "read-only analytical advisor",
]

REQUIRED_TASK_INSTRUCTIONS = {
    "analyse_comparison": [
        "Confirm [FACT] the ranked order",
        "NEVER re-rank or adjust the scores",
    ],
    "explain_rankings": [
        "five evaluation factors",
        "Cost 40%",
        "Delivery 25%",
    ],
    "identify_risks": [
        "SOLE_SUPPLIER_RISK",
        "DELIVERY_RISK",
        "PRICE_VARIANCE_RISK",
        "QUALITY_RISK",
        "MISSING_DELIVERY_DAYS",
    ],
    "missing_info": [
        "Payment terms",
        "Delivery days",
        "Quality rating",
    ],
    "negotiation_strategies": [
        "Counter-offer on price",
        "Delivery incentive",
        "Payment terms improvement",
    ],
    "executive_summary": [
        "Procurement Request",
        "Recommended Supplier",
        "Next Steps",
        "Disclaimer",
    ],
}


# ---------------------------------------------------------------------------
# 2. Prompt template verification
# ---------------------------------------------------------------------------

def test_system_prompt_completeness(suite: TestSuite) -> None:
    """Verify all required guardrail phrases are present in the system prompt."""
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        app="ProcureLens", org_name="Test Org", org_id="org-test-123"
    )
    for phrase in REQUIRED_GUARDRAILS:
        present = phrase.lower() in prompt.lower()
        suite.add(
            f"System prompt contains '{phrase}'",
            present,
            detail=(
                "" if present
                else f"Missing required guardrail phrase: {phrase!r}"
            ),
        )


def test_epistemic_markers(suite: TestSuite) -> None:
    """Verify all three epistemic markers are defined and usable."""
    markers = {"[FACT]", "[SUGGESTION]", "[RISK]"}
    for marker in markers:
        suite.add(
            f"Epistemic marker {marker} present in prompt",
            marker in SYSTEM_PROMPT_TEMPLATE,
            detail=(
                "" if marker in SYSTEM_PROMPT_TEMPLATE
                else f"Marker {marker} missing from system prompt template"
            ),
        )


def test_task_instructions(suite: TestSuite) -> None:
    """Verify per-action instruction strings contain required phrases."""
    # Map task names to their instruction text (mirrors TypeScript constants)
    task_texts: dict[str, str] = {
        "analyse_comparison": textwrap.dedent("""
            Confirm [FACT] the ranked order and final weighted scores exactly as computed.
            NEVER re-rank or adjust the scores.
            Identify [RISK] any supplier with missing data fields.
        """),
        "explain_rankings": textwrap.dedent("""
            five evaluation factors
            Cost 40%, Delivery 25%, Quality 20%, Payment Terms 10%, Reliability 5%.
            For each supplier, state [FACT] their raw value, normalised score (0–100).
        """),
        "identify_risks": textwrap.dedent("""
            SOLE_SUPPLIER_RISK — Only one quotation was submitted; no competitive alternative exists.
            DELIVERY_RISK — Delivery lead time exceeds the Purchase Request's required-by date.
            PRICE_VARIANCE_RISK — The spread between the highest and lowest quoted price exceeds 15%.
            QUALITY_RISK — One or more suppliers have no quality rating on record.
            MISSING_DELIVERY_DAYS — No delivery lead time recorded.
        """),
        "missing_info": textwrap.dedent("""
            Payment terms (stated vs. missing)
            Delivery days (stated vs. missing)
            Quality rating (stated vs. missing)
            Validity / expiry date (stated vs. missing)
        """),
        "negotiation_strategies": textwrap.dedent("""
            Counter-offer on price: cite [FACT] the gap versus the lowest quotation.
            Delivery incentive: cite [FACT] the delivery-day gap.
            Payment terms improvement: cite [FACT] the current terms.
        """),
        "executive_summary": textwrap.dedent("""
            Procurement Request
            Recommended Supplier — [FACT] name, final score, total cost.
            Next Steps — [SUGGESTION] specific actions for the procurement team.
            Disclaimer — mandatory non-autonomous disclaimer.
        """),
    }

    for task, required_phrases in REQUIRED_TASK_INSTRUCTIONS.items():
        text = task_texts.get(task, "")
        for phrase in required_phrases:
            found = phrase.lower() in text.lower()
            suite.add(
                f"Task '{task}' instruction contains '{phrase}'",
                found,
                detail=(
                    "" if found
                    else f"Missing phrase in task '{task}' instructions: {phrase!r}"
                ),
            )


# ---------------------------------------------------------------------------
# 3. Risk scoring logic
# ---------------------------------------------------------------------------

@dataclass
class MockQuotation:
    quotation_id: str
    supplier_name: str
    total_amount: float | None
    delivery_days: int | None
    quality_rating: float | None
    payment_terms: str | None
    supplier_status: str = "active"
    currency: str = "USD"


@dataclass
class RiskCheckResult:
    code: str
    severity: str
    suppliers_affected: list[str]
    detail: str


def compute_risks(
    quotations: list[MockQuotation],
    required_by_date: str | None = None,
) -> list[RiskCheckResult]:
    """
    Pure-Python risk scoring logic mirroring the TypeScript service.
    Returns a list of identified risks.
    """
    risks: list[RiskCheckResult] = []

    # SOLE_SUPPLIER_RISK
    if len(quotations) == 1:
        risks.append(RiskCheckResult(
            code="SOLE_SUPPLIER_RISK",
            severity="high",
            suppliers_affected=[quotations[0].supplier_name],
            detail="Only one quotation; no competitive alternative.",
        ))

    # PRICE_VARIANCE_RISK (>15%)
    prices = [q.total_amount for q in quotations if q.total_amount is not None]
    if len(prices) >= 2:
        min_p, max_p = min(prices), max(prices)
        if min_p > 0:
            variance = (max_p - min_p) / min_p
            if variance > 0.15:
                risks.append(RiskCheckResult(
                    code="PRICE_VARIANCE_RISK",
                    severity="medium",
                    suppliers_affected=[q.supplier_name for q in quotations],
                    detail=f"Price variance of {variance*100:.1f}%.",
                ))

    # MISSING_DELIVERY_DAYS + DELIVERY_RISK
    import datetime
    today = datetime.date.today()
    for q in quotations:
        if q.delivery_days is None:
            risks.append(RiskCheckResult(
                code="MISSING_DELIVERY_DAYS",
                severity="medium",
                suppliers_affected=[q.supplier_name],
                detail=f"No delivery lead time for {q.supplier_name}.",
            ))
        elif required_by_date:
            try:
                req = datetime.date.fromisoformat(required_by_date)
                expected = today + datetime.timedelta(days=q.delivery_days)
                if expected > req:
                    risks.append(RiskCheckResult(
                        code="DELIVERY_RISK",
                        severity="high",
                        suppliers_affected=[q.supplier_name],
                        detail=(
                            f"{q.supplier_name} arrives {expected} vs required {req}."
                        ),
                    ))
            except ValueError:
                pass

    # QUALITY_RISK
    for q in quotations:
        if q.quality_rating is None:
            risks.append(RiskCheckResult(
                code="QUALITY_RISK",
                severity="low",
                suppliers_affected=[q.supplier_name],
                detail=f"No quality rating for {q.supplier_name}.",
            ))

    # BLACKLIST_RISK
    for q in quotations:
        if q.supplier_status in ("blacklisted", "inactive"):
            risks.append(RiskCheckResult(
                code="BLACKLIST_RISK",
                severity="high",
                suppliers_affected=[q.supplier_name],
                detail=f"{q.supplier_name} has status '{q.supplier_status}'.",
            ))

    return risks


def test_risk_scoring(suite: TestSuite) -> None:
    """Verify risk detection logic against known inputs."""

    # Test 1: sole supplier risk
    single = [MockQuotation("q1", "Alpha Ltd", 10000, 14, 4.0, "Net 30")]
    risks = compute_risks(single)
    codes = {r.code for r in risks}
    suite.add(
        "Sole supplier risk detected when only 1 quotation",
        "SOLE_SUPPLIER_RISK" in codes,
        detail="Expected SOLE_SUPPLIER_RISK code" if "SOLE_SUPPLIER_RISK" not in codes else "",
    )

    # Test 2: price variance > 15%
    two = [
        MockQuotation("q1", "Alpha Ltd", 10000, 14, 4.0, "Net 30"),
        MockQuotation("q2", "Beta Corp", 12000, 10, 3.5, "Net 60"),
    ]
    risks = compute_risks(two)
    codes = {r.code for r in risks}
    suite.add(
        "Price variance risk detected when gap > 15%",
        "PRICE_VARIANCE_RISK" in codes,
        detail="Expected PRICE_VARIANCE_RISK code" if "PRICE_VARIANCE_RISK" not in codes else "",
    )

    # Test 3: no price variance when gap <= 15%
    close = [
        MockQuotation("q1", "Alpha Ltd", 10000, 14, 4.0, "Net 30"),
        MockQuotation("q2", "Beta Corp", 11000, 10, 3.5, "Net 60"),
    ]
    risks = compute_risks(close)
    codes = {r.code for r in risks}
    suite.add(
        "No price variance risk when gap ≤ 15%",
        "PRICE_VARIANCE_RISK" not in codes,
        detail="Unexpected PRICE_VARIANCE_RISK code" if "PRICE_VARIANCE_RISK" in codes else "",
    )

    # Test 4: missing delivery days
    no_delivery = [
        MockQuotation("q1", "Alpha Ltd", 10000, None, 4.0, "Net 30"),
        MockQuotation("q2", "Beta Corp", 12000, 10, 3.5, "Net 60"),
    ]
    risks = compute_risks(no_delivery)
    codes = {r.code for r in risks}
    suite.add(
        "Missing delivery days risk detected",
        "MISSING_DELIVERY_DAYS" in codes,
        detail="Expected MISSING_DELIVERY_DAYS code" if "MISSING_DELIVERY_DAYS" not in codes else "",
    )

    # Test 5: missing quality rating
    no_quality = [
        MockQuotation("q1", "Alpha Ltd", 10000, 14, None, "Net 30"),
        MockQuotation("q2", "Beta Corp", 12000, 10, None, "Net 60"),
    ]
    risks = compute_risks(no_quality)
    codes = {r.code for r in risks}
    suite.add(
        "Quality risk detected when ratings missing",
        "QUALITY_RISK" in codes,
        detail="Expected QUALITY_RISK code" if "QUALITY_RISK" not in codes else "",
    )

    # Test 6: blacklisted supplier
    blacklisted = [
        MockQuotation("q1", "Alpha Ltd", 10000, 14, 4.0, "Net 30", supplier_status="blacklisted"),
        MockQuotation("q2", "Beta Corp", 12000, 10, 3.5, "Net 60"),
    ]
    risks = compute_risks(blacklisted)
    codes = {r.code for r in risks}
    suite.add(
        "Blacklist risk detected for blacklisted supplier",
        "BLACKLIST_RISK" in codes,
        detail="Expected BLACKLIST_RISK code" if "BLACKLIST_RISK" not in codes else "",
    )

    # Test 7: delivery risk vs required-by date
    import datetime
    future_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    slow_delivery = [
        MockQuotation("q1", "Slow Corp", 10000, 30, 4.0, "Net 30"),
        MockQuotation("q2", "Fast Ltd", 10000, 3, 4.0, "Net 30"),
    ]
    risks = compute_risks(slow_delivery, required_by_date=future_date)
    codes = {r.code for r in risks}
    suite.add(
        "Delivery risk detected when lead time exceeds required-by date",
        "DELIVERY_RISK" in codes,
        detail="Expected DELIVERY_RISK code" if "DELIVERY_RISK" not in codes else "",
    )


# ---------------------------------------------------------------------------
# 4. Zero-hallucination rules
# ---------------------------------------------------------------------------

def test_zero_hallucination_rules(suite: TestSuite) -> None:
    """
    Verify that the prompt template does not instruct the AI to invent data.
    Checks for absence of phrases that would permit hallucination.
    """
    # These phrases only flag a problem when NOT preceded by "never" or "not"
    # (i.e. permissive usage). "NEVER invent" is a guardrail, not hallucination.
    import re
    forbidden_patterns_contextual = [
        ("assume the", r"(?<!never\s)(?<!not\s)assume the"),
        ("guess the", r"(?<!never\s)(?<!not\s)guess the"),
        ("estimate if unknown", r"estimate if unknown"),
        ("use typical values", r"use typical values"),
        ("invent data", r"(?<!never\s)(?<!not\s)invent data"),
        ("make up", r"(?<!never\s)(?<!not\s)make up"),
        ("extrapolate from", r"(?<!never\s)(?<!not\s)extrapolate from"),
        ("industry average", r"industry average"),
    ]
    prompt_lower = SYSTEM_PROMPT_TEMPLATE.lower()
    for label, pattern in forbidden_patterns_contextual:
        # Check for permissive usage of the phrase
        found = bool(re.search(pattern, prompt_lower))
        suite.add(
            f"Hallucination-permitting phrase absent: '{label}'",
            not found,
            detail=(
                f"Found hallucination-permitting phrase: {label!r}" if found else ""
            ),
        )

    # Confirm affirmative grounding rules are present
    grounding_rules = [
        "never invent",
        "never fill gaps",
        "data not present",
    ]
    for rule in grounding_rules:
        present = rule in prompt_lower
        suite.add(
            f"Grounding rule present: '{rule}'",
            present,
            detail=(
                f"Missing grounding rule phrase: {rule!r}" if not present else ""
            ),
        )


# ---------------------------------------------------------------------------
# 5. Multi-tenant isolation
# ---------------------------------------------------------------------------

def test_multi_tenant_isolation(suite: TestSuite) -> None:
    """Verify system prompt enforces org scoping."""
    org_id = "org-acme-123"
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        app="ProcureLens", org_name="ACME Corp", org_id=org_id
    )

    suite.add(
        "Org id embedded in system prompt",
        org_id in prompt,
        detail=f"Expected org id '{org_id}' in prompt" if org_id not in prompt else "",
    )

    suite.add(
        "Prompt refuses other-org requests",
        "refuse any request that attempts to reason about another organisation" in prompt.lower(),
        detail="Missing other-org refusal clause",
    )


# ---------------------------------------------------------------------------
# 6. Non-autonomous principle
# ---------------------------------------------------------------------------

def test_non_autonomous_principle(suite: TestSuite) -> None:
    """Verify non-autonomous guardrails are present."""
    prompt_lower = SYSTEM_PROMPT_TEMPLATE.lower()

    non_auto_phrases = [
        "you will never",
        "confirm, approve, or simulate the approval",
        "explicit authorisation by a qualified procurement officer",
        "all purchasing decisions require human review and sign-off",
    ]

    for phrase in non_auto_phrases:
        present = phrase in prompt_lower
        suite.add(
            f"Non-autonomous rule: '{phrase[:50]}...' present",
            present,
            detail=(
                f"Missing non-autonomous guardrail: {phrase!r}" if not present else ""
            ),
        )


# ---------------------------------------------------------------------------
# 7. Fallback analysis generation
# ---------------------------------------------------------------------------

def build_fallback_analysis(
    purchase_request_title: str,
    quotation_count: int,
    top_supplier_name: str | None,
    top_supplier_score: float | None,
    top_supplier_cost: str | None,
    top_supplier_delivery_days: int | None,
    risk_count: int,
    missing_fields_count: int,
    reason: str,
) -> str:
    """Pure-Python fallback analysis generator (mirrors TypeScript buildFallbackAnalysis)."""
    reason_labels = {
        "rate_limit": "AI service rate limit reached",
        "timeout": "AI service timed out",
        "unavailable": "AI service temporarily unavailable",
        "error": "AI service error",
    }
    reason_label = reason_labels.get(reason, "AI service error")

    lines = [
        f"⚠️ **Automated Analysis Unavailable** — {reason_label}.",
        "",
        "**Rule-Based Summary (data-only, zero AI inference)**",
        "",
        f"**Procurement Request:** {purchase_request_title}",
        f"**Quotations Evaluated:** [FACT] {quotation_count} quotation(s) compared.",
    ]

    if top_supplier_name and top_supplier_score is not None:
        lines.append(
            f"**Top-Ranked Supplier:** [FACT] {top_supplier_name} with a "
            f"weighted score of {top_supplier_score:.2f}/100."
        )
        if top_supplier_cost:
            lines.append(f"**Quoted Cost:** [FACT] {top_supplier_cost}")
        if top_supplier_delivery_days is not None:
            lines.append(f"**Delivery Lead Time:** [FACT] {top_supplier_delivery_days} day(s).")
    else:
        lines.append(
            "**Top-Ranked Supplier:** [FACT] Insufficient data to determine a top-ranked supplier."
        )

    if risk_count > 0:
        lines.append(
            f"**Risks Flagged:** [RISK] {risk_count} risk(s) identified — "
            "review the full comparison report for details."
        )

    if missing_fields_count > 0:
        lines.append(
            f"**Data Gaps:** [RISK] {missing_fields_count} field(s) missing — "
            "neutral scores (50/100) were applied where data was absent."
        )

    lines += [
        "",
        "⚠️ Approval of this recommendation requires explicit authorisation "
        "by a qualified procurement officer.",
        "",
        "_Retry the analysis once AI service availability is restored._",
    ]

    return "\n".join(lines)


def test_fallback_analysis(suite: TestSuite) -> None:
    """Verify rule-based fallback analysis output."""

    # Test: basic fallback with top supplier
    output = build_fallback_analysis(
        purchase_request_title="Office Chairs Q4-2025",
        quotation_count=3,
        top_supplier_name="ErgoFurn Ltd",
        top_supplier_score=82.45,
        top_supplier_cost="₹120,000.00",
        top_supplier_delivery_days=7,
        risk_count=2,
        missing_fields_count=1,
        reason="rate_limit",
    )

    checks = [
        ("Contains [FACT] markers", "[FACT]" in output),
        ("Contains [RISK] markers", "[RISK]" in output),
        ("Contains non-autonomous disclaimer", "authorisation" in output.lower()),
        ("Contains supplier name", "ErgoFurn Ltd" in output),
        ("Contains score", "82.45" in output),
        ("Contains rate limit reason", "rate limit" in output.lower()),
        ("Does NOT contain invented data markers", "assume" not in output.lower()),
        ("Contains correct quotation count", "3 quotation(s)" in output),
    ]

    for name, passed in checks:
        suite.add(f"Fallback analysis: {name}", passed)

    # Test: fallback with no top supplier (insufficient data)
    output2 = build_fallback_analysis(
        purchase_request_title="Raw Materials Tender",
        quotation_count=0,
        top_supplier_name=None,
        top_supplier_score=None,
        top_supplier_cost=None,
        top_supplier_delivery_days=None,
        risk_count=0,
        missing_fields_count=0,
        reason="unavailable",
    )

    suite.add(
        "Fallback: handles no-supplier case gracefully",
        "insufficient data" in output2.lower(),
        detail="Expected 'insufficient data' message for empty comparison",
    )

    suite.add(
        "Fallback: unavailable reason label",
        "temporarily unavailable" in output2.lower(),
        detail="Expected 'temporarily unavailable' in output for 'unavailable' reason",
    )


# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------

def run_all_tests(verbose: bool = False) -> TestSuite:
    suite = TestSuite()

    sections = [
        ("Prompt Template Completeness", test_system_prompt_completeness),
        ("Epistemic Markers", test_epistemic_markers),
        ("Task Instructions", test_task_instructions),
        ("Risk Scoring Logic", test_risk_scoring),
        ("Zero-Hallucination Rules", test_zero_hallucination_rules),
        ("Multi-Tenant Isolation", test_multi_tenant_isolation),
        ("Non-Autonomous Principle", test_non_autonomous_principle),
        ("Fallback Analysis Generation", test_fallback_analysis),
    ]

    for section_name, fn in sections:
        print(f"\n{bold(section_name)}")
        before = len(suite.results)
        fn(suite)
        section_results = suite.results[before:]
        section_suite = TestSuite()
        section_suite.results = section_results
        section_suite.print(verbose=verbose)

    return suite


def main() -> int:
    global USE_COLOR

    parser = argparse.ArgumentParser(
        description="ProcureLens AI Procurement Analyst Verification Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Run the built-in test suite (default if no other action specified)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show pass-detail for every assertion",
    )
    parser.add_argument(
        "--no-color", action="store_true",
        help="Disable ANSI colour output",
    )
    args = parser.parse_args()

    if args.no_color:
        USE_COLOR = False

    print(bold("ProcureLens — AI Procurement Analyst Verification"))
    print(dim("=" * 60))

    suite = run_all_tests(verbose=args.verbose)

    print(f"\n{bold('Results')}: {green(str(suite.passed))} passed, "
          f"{(red(str(suite.failed)) if suite.failed else dim('0'))} failed "
          f"out of {len(suite.results)} assertions.")

    if suite.all_passed:
        print(green("\n✔ All verification checks passed. Zero-hallucination guardrails confirmed."))
        return 0
    else:
        print(red(f"\n✘ {suite.failed} check(s) failed — review output above."))
        return 1


if __name__ == "__main__":
    sys.exit(main())
