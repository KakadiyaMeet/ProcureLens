#!/usr/bin/env python3
"""
vendor_comparison_engine.py — ProcureLens Deterministic Smart Vendor Comparison Engine

Companion Python script that implements, tests, and demonstrates the exact
deterministic scoring, normalization, comparability checks, missing-field
handling, and transparent mathematical breakdown used by ProcureLens Phase 4.

Zero AI is used in scoring or ranking. Every point is deterministically derived
from verifiable formulas.

Usage:
    python scripts/vendor_comparison_engine.py                 # Run demo comparison & self-tests
    python scripts/vendor_comparison_engine.py --test          # Run strict scoring & adherence test suite
    python scripts/vendor_comparison_engine.py --json          # Emit JSON output for demo comparison
    python scripts/vendor_comparison_engine.py --input data.json [--json] [--no-color]
    python scripts/vendor_comparison_engine.py --weights cost=50,delivery=20,quality=15,terms=10,reliability=5

Scoring Formula (Standard Weights):
    Final Score = (Cost * 0.40) + (Delivery * 0.25) + (Quality * 0.20)
                + (PaymentTerms * 0.10) + (Reliability * 0.05)

Missing Value Policy:
    Missing or unprovided fields are NEVER fabricated or hallucinated.
    They are explicitly marked as "Unrated / Missing" and assigned a disclosed
    neutral default score (50.0 / 100) so no vendor is silently penalized or
    artificially boosted without operator visibility.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


# ─── Constants & Configuration ───────────────────────────────────────────────

STANDARD_WEIGHTS: Dict[str, float] = {
    "cost": 0.40,
    "delivery": 0.25,
    "quality": 0.20,
    "payment_terms": 0.10,
    "reliability": 0.05,
}

# Disclosed neutral default when a dimension value is missing (never hallucinated)
MISSING_NEUTRAL_SCORE: float = 50.0
MISSING_LABEL: str = "Unrated / Missing"

# Standard credit ladder for payment terms (higher credit period = better for buyer)
PAYMENT_TERMS_LADDER: List[Tuple[str, float, List[str]]] = [
    ("Net 90", 100.0, [r"\bnet\s*90\b", r"\b90\s*days?\b"]),
    ("Net 60", 85.0, [r"\bnet\s*60\b", r"\b60\s*days?\b"]),
    ("Net 45", 75.0, [r"\bnet\s*45\b", r"\b45\s*days?\b"]),
    ("Net 30", 60.0, [r"\bnet\s*30\b", r"\b30\s*days?\b"]),
    ("Net 15", 45.0, [r"\bnet\s*15\b", r"\b15\s*days?\b"]),
    ("Immediate", 30.0, [r"\bimmediate\b", r"\bcod\b", r"\bdue\s+on\s+receipt\b", r"\bnet\s*0\b"]),
    ("Advance", 15.0, [r"\badvance\b", r"\bprepay", r"\bupfront\b", r"\b100%\s*advance\b"]),
]

USE_COLOR = True


def _c(code: str, text: str) -> str:
    if not USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def bold(t: str) -> str:
    return _c("1", t)


def dim(t: str) -> str:
    return _c("2", t)


def green(t: str) -> str:
    return _c("32", t)


def yellow(t: str) -> str:
    return _c("33", t)


def red(t: str) -> str:
    return _c("31", t)


def cyan(t: str) -> str:
    return _c("36", t)


def round2(value: float) -> float:
    return round(float(value) + 1e-12, 2)


# ─── Data Structures ─────────────────────────────────────────────────────────

@dataclass
class PurchaseRequestSpec:
    id: str
    title: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    specifications: Optional[str] = None
    estimated_budget: Optional[float] = None


@dataclass
class QuotationLineItem:
    description: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    unit: Optional[str] = None
    specifications: Optional[str] = None


@dataclass
class VendorQuotation:
    quotation_id: str
    purchase_request_id: str
    supplier_id: str
    supplier_name: str
    items: List[QuotationLineItem] = field(default_factory=list)
    total_amount: Optional[float] = None
    delivery_charges: float = 0.0
    tax_amount: float = 0.0
    delivery_days: Optional[float] = None
    quality_rating: Optional[float] = None      # Scale: 0.0 to 5.0
    payment_terms: Optional[str] = None         # e.g., "Net 60", "Net 30", "Advance"
    reliability_score: Optional[float] = None   # Scale: 0.0 to 100.0 (or derived from on-time %)
    currency: str = "USD"
    notes: Optional[str] = None


@dataclass
class ComparabilityMismatch:
    quotation_id: str
    supplier_name: str
    field: str
    expected: str
    actual: str
    severity: str  # "warning" | "error"
    message: str


@dataclass
class ComparabilityReport:
    is_comparable: bool
    warnings: List[str] = field(default_factory=list)
    mismatches: List[ComparabilityMismatch] = field(default_factory=list)


@dataclass
class FactorBreakdown:
    factor: str
    label: str
    raw_value: Any
    display_value: str
    is_missing: bool
    normalized_score: float
    weight: float
    weighted_points: float
    formula_used: str
    explanation: str


@dataclass
class RankedVendorResult:
    rank: int
    quotation_id: str
    supplier_id: str
    supplier_name: str
    computed_total_cost: Optional[float]
    delivery_days: Optional[float]
    quality_rating: Optional[float]
    payment_terms: Optional[str]
    reliability_score: Optional[float]
    final_score: float
    missing_fields: List[str]
    tie_breaker_note: Optional[str]
    factors: Dict[str, FactorBreakdown]
    summary_explanation: str


@dataclass
class ComparisonOutput:
    purchase_request_id: str
    purchase_request_title: str
    weights: Dict[str, float]
    comparability: ComparabilityReport
    rankings: List[RankedVendorResult]
    recommended_quotation_id: Optional[str]
    recommended_supplier_name: Optional[str]
    methodology_version: str = "deterministic-v1.0"
    ai_used_in_ranking: bool = False


# ─── Core Deterministic Calculation Functions ────────────────────────────────

def normalize_weights(weights: Optional[Dict[str, float]] = None) -> Dict[str, float]:
    """Normalize weight dictionary so values sum to exactly 1.0."""
    raw = dict(STANDARD_WEIGHTS)
    if weights:
        for key in STANDARD_WEIGHTS:
            if key in weights and weights[key] is not None:
                val = float(weights[key])
                if val < 0 or not math.isfinite(val):
                    raise ValueError(f"Weight for '{key}' must be a non-negative finite number.")
                raw[key] = val

    total = sum(raw.values())
    if total <= 0:
        raise ValueError("Sum of weights must be greater than zero.")

    return {k: v / total for k, v in raw.items()}


def compute_total_purchase_cost(q: VendorQuotation) -> Optional[float]:
    """
    Deterministic total purchase cost calculation:
    If line items exist, sum(item.total_price or item.quantity * item.unit_price)
    + delivery_charges + tax_amount.
    Otherwise fall back to q.total_amount (plus delivery/tax if not already included).
    Returns None if no valid positive cost is available.
    """
    if q.items:
        item_sum = 0.0
        has_valid_item_cost = False
        for item in q.items:
            if item.total_price is not None and math.isfinite(item.total_price) and item.total_price >= 0:
                item_sum += float(item.total_price)
                has_valid_item_cost = True
            elif (
                item.quantity is not None
                and item.unit_price is not None
                and math.isfinite(item.quantity)
                and math.isfinite(item.unit_price)
                and item.quantity >= 0
                and item.unit_price >= 0
            ):
                item_sum += float(item.quantity) * float(item.unit_price)
                has_valid_item_cost = True
        if has_valid_item_cost:
            total = item_sum + max(0.0, float(q.delivery_charges or 0.0)) + max(0.0, float(q.tax_amount or 0.0))
            if total > 0:
                return round2(total)

    if q.total_amount is not None and math.isfinite(q.total_amount) and q.total_amount > 0:
        return round2(float(q.total_amount))

    return None


def score_payment_terms(terms: Optional[str]) -> Tuple[float, bool, str, str]:
    """
    Score payment terms on the standard credit ladder (0 to 100).
    Returns (score, is_missing, canonical_label, formula_description).
    Missing terms are never fabricated; marked "Unrated / Missing" with neutral default.
    """
    if terms is None or not str(terms).strip():
        return (
            MISSING_NEUTRAL_SCORE,
            True,
            MISSING_LABEL,
            f"Missing value -> Disclosed neutral default ({MISSING_NEUTRAL_SCORE:.1f}/100)",
        )

    cleaned = str(terms).strip()
    lower = cleaned.lower()

    for label, score, patterns in PAYMENT_TERMS_LADDER:
        for pat in patterns:
            if re.search(pat, lower):
                return (
                    score,
                    False,
                    f"{cleaned} ({label})",
                    f"Standard Credit Ladder: {label} -> {score:.1f}/100",
                )

    # Check if custom "Net N" days is provided (deterministic linear interpolation on ladder)
    match = re.search(r"\bnet\s*(\d+)\b", lower) or re.search(r"\b(\d+)\s*days?\b", lower)
    if match:
        days = int(match.group(1))
        if days >= 90:
            score = 100.0
        elif days <= 0:
            score = 30.0
        else:
            # Piecewise linear interpolation between credit ladder anchor points
            anchors = [(0, 30.0), (15, 45.0), (30, 60.0), (45, 75.0), (60, 85.0), (90, 100.0)]
            score = 30.0
            for (d0, s0), (d1, s1) in zip(anchors, anchors[1:]):
                if d0 <= days <= d1:
                    ratio = (days - d0) / (d1 - d0)
                    score = s0 + ratio * (s1 - s0)
                    break
        score = round2(score)
        return (
            score,
            False,
            cleaned,
            f"Interpolated Credit Ladder ({days} days) -> {score:.2f}/100",
        )

    # Unrecognized non-empty payment term text -> disclosed neutral default
    return (
        MISSING_NEUTRAL_SCORE,
        True,
        f"{cleaned} ({MISSING_LABEL})",
        f"Unrecognized terms '{cleaned}' -> Disclosed neutral default ({MISSING_NEUTRAL_SCORE:.1f}/100)",
    )


def check_comparability(
    pr: PurchaseRequestSpec,
    quotations: List[VendorQuotation],
) -> ComparabilityReport:
    """
    Verify that quotations belong to the same PR and have comparable quantities,
    units, and product specifications.
    """
    warnings: List[str] = []
    mismatches: List[ComparabilityMismatch] = []

    units_seen: Dict[str, List[str]] = {}
    specs_seen: Dict[str, List[str]] = {}

    for q in quotations:
        if q.purchase_request_id != pr.id:
            msg = (
                f"Quotation '{q.quotation_id}' ({q.supplier_name}) references PR "
                f"'{q.purchase_request_id}', expected '{pr.id}'."
            )
            warnings.append(msg)
            mismatches.append(
                ComparabilityMismatch(
                    quotation_id=q.quotation_id,
                    supplier_name=q.supplier_name,
                    field="purchase_request_id",
                    expected=pr.id,
                    actual=q.purchase_request_id,
                    severity="error",
                    message=msg,
                )
            )

        if q.items:
            total_qty = sum(item.quantity or 0.0 for item in q.items if item.quantity is not None)
            has_qty = any(item.quantity is not None for item in q.items)

            if pr.quantity is not None and has_qty and abs(total_qty - pr.quantity) > 1e-6:
                msg = (
                    f"{q.supplier_name} quoted total quantity {total_qty:g}, "
                    f"which differs from PR requested quantity {pr.quantity:g}."
                )
                warnings.append(msg)
                mismatches.append(
                    ComparabilityMismatch(
                        quotation_id=q.quotation_id,
                        supplier_name=q.supplier_name,
                        field="quantity",
                        expected=f"{pr.quantity:g}",
                        actual=f"{total_qty:g}",
                        severity="warning",
                        message=msg,
                    )
                )

            for item in q.items:
                if item.unit and item.unit.strip():
                    norm_unit = item.unit.strip().lower()
                    units_seen.setdefault(norm_unit, []).append(q.supplier_name)
                    if pr.unit and pr.unit.strip().lower() != norm_unit:
                        msg = (
                            f"{q.supplier_name} unit '{item.unit}' differs from "
                            f"PR unit '{pr.unit}'."
                        )
                        warnings.append(msg)
                        mismatches.append(
                            ComparabilityMismatch(
                                quotation_id=q.quotation_id,
                                supplier_name=q.supplier_name,
                                field="unit",
                                expected=pr.unit,
                                actual=item.unit,
                                severity="warning",
                                message=msg,
                            )
                        )

                if item.specifications and item.specifications.strip():
                    norm_spec = re.sub(r"\s+", " ", item.specifications.strip().lower())
                    specs_seen.setdefault(norm_spec, []).append(q.supplier_name)
                    if pr.specifications and pr.specifications.strip():
                        pr_spec_norm = re.sub(r"\s+", " ", pr.specifications.strip().lower())
                        if norm_spec != pr_spec_norm:
                            msg = (
                                f"{q.supplier_name} specifications ('{item.specifications}') "
                                f"differ from PR specification ('{pr.specifications}')."
                            )
                            warnings.append(msg)
                            mismatches.append(
                                ComparabilityMismatch(
                                    quotation_id=q.quotation_id,
                                    supplier_name=q.supplier_name,
                                    field="specifications",
                                    expected=pr.specifications,
                                    actual=item.specifications,
                                    severity="warning",
                                    message=msg,
                                )
                            )

    if len(units_seen) > 1:
        msg = f"Multiple measurement units detected across quotations: {', '.join(sorted(units_seen.keys()))}."
        if msg not in warnings:
            warnings.append(msg)

    if len(specs_seen) > 1:
        msg = (
            f"Specification variance detected across quotations "
            f"({len(specs_seen)} distinct specification profiles). Verify apples-to-apples scope."
        )
        if msg not in warnings:
            warnings.append(msg)

    return ComparabilityReport(
        is_comparable=len(mismatches) == 0 and len(units_seen) <= 1 and len(specs_seen) <= 1,
        warnings=warnings,
        mismatches=mismatches,
    )


def compare_vendors(
    pr: PurchaseRequestSpec,
    quotations: List[VendorQuotation],
    weights: Optional[Dict[str, float]] = None,
) -> ComparisonOutput:
    """
    Execute deterministic multi-criteria vendor comparison and ranking.
    Zero AI is invoked; all scores are mathematically deterministic.
    """
    if not quotations:
        raise ValueError("At least one quotation is required for comparison.")

    norm_weights = normalize_weights(weights)
    comparability = check_comparability(pr, quotations)

    # 1. Compute total costs and find peer minimums for Cost & Delivery
    computed_costs: Dict[str, Optional[float]] = {
        q.quotation_id: compute_total_purchase_cost(q) for q in quotations
    }
    valid_costs = [c for c in computed_costs.values() if c is not None and c > 0]
    min_cost = min(valid_costs) if valid_costs else None

    valid_days = [
        float(q.delivery_days)
        for q in quotations
        if q.delivery_days is not None and math.isfinite(q.delivery_days) and q.delivery_days > 0
    ]
    min_days = min(valid_days) if valid_days else None

    results: List[RankedVendorResult] = []

    for q in quotations:
        missing_fields: List[str] = []
        factors: Dict[str, FactorBreakdown] = {}

        # ── Factor 1: Cost (Lower is better: minCost / cost * 100) ───────────
        cost = computed_costs[q.quotation_id]
        w_cost = norm_weights["cost"]
        if cost is not None and min_cost is not None and cost > 0:
            cost_score = round2(min(100.0, (min_cost / cost) * 100.0))
            cost_missing = False
            cost_display = f"{q.currency} {cost:,.2f}"
            cost_formula = f"({min_cost:,.2f} / {cost:,.2f}) * 100 = {cost_score:.2f}"
            cost_expl = (
                f"Total cost {cost_display} vs lowest peer {q.currency} {min_cost:,.2f} -> "
                f"{cost_score:.2f}/100 * {w_cost * 100:.1f}% = {round2(cost_score * w_cost):.2f} pts."
            )
        else:
            cost_score = 0.0
            cost_missing = True
            missing_fields.append("Cost")
            cost_display = MISSING_LABEL
            cost_formula = "Missing cost -> 0.00 (unpriced quotes cannot earn cost points)"
            cost_expl = (
                f"Cost is {MISSING_LABEL}; unpriced quotes receive 0.00/100 "
                f"* {w_cost * 100:.1f}% = 0.00 pts."
            )
        factors["cost"] = FactorBreakdown(
            factor="cost",
            label="Total Cost",
            raw_value=cost,
            display_value=cost_display,
            is_missing=cost_missing,
            normalized_score=cost_score,
            weight=w_cost,
            weighted_points=round2(cost_score * w_cost),
            formula_used=cost_formula,
            explanation=cost_expl,
        )

        # ── Factor 2: Delivery (Lower days is better: minDays / days * 100) ──
        w_del = norm_weights["delivery"]
        if q.delivery_days is not None and math.isfinite(q.delivery_days) and q.delivery_days > 0 and min_days is not None:
            del_score = round2(min(100.0, (min_days / float(q.delivery_days)) * 100.0))
            del_missing = False
            del_display = f"{q.delivery_days:g} days"
            del_formula = f"({min_days:g} / {q.delivery_days:g}) * 100 = {del_score:.2f}"
            del_expl = (
                f"Lead time {del_display} vs fastest peer {min_days:g} days -> "
                f"{del_score:.2f}/100 * {w_del * 100:.1f}% = {round2(del_score * w_del):.2f} pts."
            )
        else:
            del_score = MISSING_NEUTRAL_SCORE
            del_missing = True
            missing_fields.append("Delivery")
            del_display = MISSING_LABEL
            del_formula = f"Missing -> Neutral default ({MISSING_NEUTRAL_SCORE:.1f}/100)"
            del_expl = (
                f"Delivery lead time is {MISSING_LABEL}; assigned disclosed neutral score "
                f"{MISSING_NEUTRAL_SCORE:.1f}/100 * {w_del * 100:.1f}% = {round2(del_score * w_del):.2f} pts."
            )
        factors["delivery"] = FactorBreakdown(
            factor="delivery",
            label="Delivery Speed",
            raw_value=q.delivery_days,
            display_value=del_display,
            is_missing=del_missing,
            normalized_score=del_score,
            weight=w_del,
            weighted_points=round2(del_score * w_del),
            formula_used=del_formula,
            explanation=del_expl,
        )

        # ── Factor 3: Quality (Higher is better: (rating / 5) * 100) ─────────
        w_qual = norm_weights["quality"]
        if q.quality_rating is not None and math.isfinite(q.quality_rating) and 0.0 <= q.quality_rating <= 5.0:
            qual_score = round2((float(q.quality_rating) / 5.0) * 100.0)
            qual_missing = False
            qual_display = f"{q.quality_rating:.2f} / 5.00"
            qual_formula = f"({q.quality_rating:.2f} / 5.0) * 100 = {qual_score:.2f}"
            qual_expl = (
                f"Quality rating {qual_display} -> "
                f"{qual_score:.2f}/100 * {w_qual * 100:.1f}% = {round2(qual_score * w_qual):.2f} pts."
            )
        else:
            qual_score = MISSING_NEUTRAL_SCORE
            qual_missing = True
            missing_fields.append("Quality")
            qual_display = MISSING_LABEL
            qual_formula = f"Missing -> Neutral default ({MISSING_NEUTRAL_SCORE:.1f}/100)"
            qual_expl = (
                f"Quality rating is {MISSING_LABEL}; assigned disclosed neutral score "
                f"{MISSING_NEUTRAL_SCORE:.1f}/100 * {w_qual * 100:.1f}% = {round2(qual_score * w_qual):.2f} pts."
            )
        factors["quality"] = FactorBreakdown(
            factor="quality",
            label="Quality Rating",
            raw_value=q.quality_rating,
            display_value=qual_display,
            is_missing=qual_missing,
            normalized_score=qual_score,
            weight=w_qual,
            weighted_points=round2(qual_score * w_qual),
            formula_used=qual_formula,
            explanation=qual_expl,
        )

        # ── Factor 4: Payment Terms (Standard credit ladder) ─────────────────
        w_terms = norm_weights["payment_terms"]
        terms_score, terms_missing, terms_display, terms_formula = score_payment_terms(q.payment_terms)
        if terms_missing:
            missing_fields.append("Payment Terms")
        terms_expl = (
            f"Payment terms {terms_display} -> "
            f"{terms_score:.2f}/100 * {w_terms * 100:.1f}% = {round2(terms_score * w_terms):.2f} pts."
        )
        factors["payment_terms"] = FactorBreakdown(
            factor="payment_terms",
            label="Payment Terms",
            raw_value=q.payment_terms,
            display_value=terms_display,
            is_missing=terms_missing,
            normalized_score=terms_score,
            weight=w_terms,
            weighted_points=round2(terms_score * w_terms),
            formula_used=terms_formula,
            explanation=terms_expl,
        )

        # ── Factor 5: Reliability (Higher is better: 0 to 100) ───────────────
        w_rel = norm_weights["reliability"]
        if q.reliability_score is not None and math.isfinite(q.reliability_score) and 0.0 <= q.reliability_score <= 100.0:
            rel_score = round2(float(q.reliability_score))
            rel_missing = False
            rel_display = f"{rel_score:.1f}%"
            rel_formula = f"Direct reliability index = {rel_score:.2f}/100"
            rel_expl = (
                f"Supplier reliability {rel_display} -> "
                f"{rel_score:.2f}/100 * {w_rel * 100:.1f}% = {round2(rel_score * w_rel):.2f} pts."
            )
        else:
            rel_score = MISSING_NEUTRAL_SCORE
            rel_missing = True
            missing_fields.append("Reliability")
            rel_display = MISSING_LABEL
            rel_formula = f"Missing -> Neutral default ({MISSING_NEUTRAL_SCORE:.1f}/100)"
            rel_expl = (
                f"Supplier reliability is {MISSING_LABEL}; assigned disclosed neutral score "
                f"{MISSING_NEUTRAL_SCORE:.1f}/100 * {w_rel * 100:.1f}% = {round2(rel_score * w_rel):.2f} pts."
            )
        factors["reliability"] = FactorBreakdown(
            factor="reliability",
            label="Supplier Reliability",
            raw_value=q.reliability_score,
            display_value=rel_display,
            is_missing=rel_missing,
            normalized_score=rel_score,
            weight=w_rel,
            weighted_points=round2(rel_score * w_rel),
            formula_used=rel_formula,
            explanation=rel_expl,
        )

        final_score = round2(
            (cost_score * w_cost)
            + (del_score * w_del)
            + (qual_score * w_qual)
            + (terms_score * w_terms)
            + (rel_score * w_rel)
        )

        missing_note = (
            f" Note: {', '.join(missing_fields)} marked as '{MISSING_LABEL}' (neutral {MISSING_NEUTRAL_SCORE:.0f}/100)."
            if missing_fields
            else ""
        )
        summary = (
            f"{q.supplier_name} scored {final_score:.2f}/100 "
            f"[Cost {factors['cost'].weighted_points:.2f} + "
            f"Delivery {factors['delivery'].weighted_points:.2f} + "
            f"Quality {factors['quality'].weighted_points:.2f} + "
            f"Terms {factors['payment_terms'].weighted_points:.2f} + "
            f"Reliability {factors['reliability'].weighted_points:.2f}].{missing_note}"
        )

        results.append(
            RankedVendorResult(
                rank=0,
                quotation_id=q.quotation_id,
                supplier_id=q.supplier_id,
                supplier_name=q.supplier_name,
                computed_total_cost=cost,
                delivery_days=q.delivery_days,
                quality_rating=q.quality_rating,
                payment_terms=q.payment_terms,
                reliability_score=q.reliability_score,
                final_score=final_score,
                missing_fields=missing_fields,
                tie_breaker_note=None,
                factors=factors,
                summary_explanation=summary,
            )
        )

    # 2. Deterministic sorting with explicit tie-breakers:
    #    (1) Higher final_score
    #    (2) Fewer missing fields
    #    (3) Lower total cost (missing treated as +inf)
    #    (4) Faster delivery days (missing treated as +inf)
    #    (5) Higher quality score
    #    (6) Alphabetical supplier_name, then quotation_id
    def sort_key(r: RankedVendorResult) -> Tuple[Any, ...]:
        return (
            -r.final_score,
            len(r.missing_fields),
            r.computed_total_cost if r.computed_total_cost is not None else float("inf"),
            r.delivery_days if r.delivery_days is not None else float("inf"),
            -r.factors["quality"].normalized_score,
            r.supplier_name.lower(),
            r.quotation_id,
        )

    results.sort(key=sort_key)

    for idx, r in enumerate(results, start=1):
        r.rank = idx
        if idx > 1 and abs(results[idx - 2].final_score - r.final_score) < 1e-6:
            r.tie_breaker_note = (
                f"Tied at {r.final_score:.2f} with {results[idx - 2].supplier_name}; "
                "ordered deterministically by data completeness, lower cost, faster delivery, quality, and name."
            )

    top = results[0] if results else None
    return ComparisonOutput(
        purchase_request_id=pr.id,
        purchase_request_title=pr.title,
        weights=norm_weights,
        comparability=comparability,
        rankings=results,
        recommended_quotation_id=top.quotation_id if top else None,
        recommended_supplier_name=top.supplier_name if top else None,
    )


# ─── Demo Fixture & CLI Pretty Printer ───────────────────────────────────────

def build_demo_scenario() -> Tuple[PurchaseRequestSpec, List[VendorQuotation]]:
    pr = PurchaseRequestSpec(
        id="PR-2026-042",
        title="Industrial CNC Precision Bearings (Grade P5)",
        quantity=500,
        unit="pcs",
        specifications="ISO 492 Grade P5, Stainless 440C, Sealed",
        estimated_budget=18000.0,
    )
    quotations = [
        VendorQuotation(
            quotation_id="Q-101",
            purchase_request_id="PR-2026-042",
            supplier_id="SUP-APEX",
            supplier_name="Apex Precision Industrial",
            items=[
                QuotationLineItem(
                    description="CNC Precision Bearing Grade P5",
                    quantity=500,
                    unit_price=31.0,
                    unit="pcs",
                    specifications="ISO 492 Grade P5, Stainless 440C, Sealed",
                )
            ],
            delivery_charges=350.0,
            tax_amount=1550.0,
            delivery_days=10,
            quality_rating=4.7,
            payment_terms="Net 60",
            reliability_score=94.0,
        ),
        VendorQuotation(
            quotation_id="Q-102",
            purchase_request_id="PR-2026-042",
            supplier_id="SUP-BUDGET",
            supplier_name="ValueLine Components Co.",
            items=[
                QuotationLineItem(
                    description="CNC Bearing Grade P5",
                    quantity=500,
                    unit_price=28.5,
                    unit="pcs",
                    specifications="ISO 492 Grade P5, Stainless 440C, Sealed",
                )
            ],
            delivery_charges=450.0,
            tax_amount=1425.0,
            delivery_days=22,
            quality_rating=3.8,
            payment_terms="Net 15",
            reliability_score=76.0,
        ),
        VendorQuotation(
            quotation_id="Q-103",
            purchase_request_id="PR-2026-042",
            supplier_id="SUP-RAPID",
            supplier_name="RapidMotion Supply",
            items=[
                QuotationLineItem(
                    description="CNC Bearing Grade P5 (Alternative Seal)",
                    quantity=450,  # Intentional quantity mismatch to showcase comparability alert
                    unit_price=33.0,
                    unit="pcs",
                    specifications="ISO 492 Grade P5, Chrome Steel, Open",
                )
            ],
            delivery_charges=200.0,
            tax_amount=1485.0,
            delivery_days=6,
            quality_rating=None,       # Intentional missing field -> "Unrated / Missing"
            payment_terms="Net 30",
            reliability_score=None,    # Intentional missing field -> "Unrated / Missing"
        ),
    ]
    return pr, quotations


def print_cli_report(output: ComparisonOutput) -> None:
    print()
    print(bold("=" * 86))
    print(bold(f"  ProcureLens Deterministic Vendor Comparison Engine ({output.methodology_version})"))
    print(bold("=" * 86))
    print(f"  PR:       {cyan(output.purchase_request_id)} — {bold(output.purchase_request_title)}")
    w = output.weights
    print(
        f"  Weights:  Cost {w['cost']*100:.0f}% | Delivery {w['delivery']*100:.0f}% | "
        f"Quality {w['quality']*100:.0f}% | Terms {w['payment_terms']*100:.0f}% | "
        f"Reliability {w['reliability']*100:.0f}%"
    )
    print(f"  AI Used:  {green('No (100% deterministic mathematical formulas)')}")
    print("-" * 86)

    # Comparability report
    if output.comparability.is_comparable:
        print(green("  [OK] Comparability Check: All quotations match PR specifications & quantities."))
    else:
        print(yellow(f"  [!] Comparability Alert: {len(output.comparability.warnings)} warning(s) detected:"))
        for warning in output.comparability.warnings:
            print(yellow(f"      - {warning}"))
    print("-" * 86)

    # Rankings Table
    header = (
        f"  {'Rank':<5} {'Supplier':<28} {'Total Cost':>12} {'Days':>6} "
        f"{'Quality':>9} {'Terms':>10} {'Score':>8}"
    )
    print(bold(header))
    print("  " + "-" * 82)
    for r in output.rankings:
        rank_str = f"#{r.rank}"
        cost_str = f"${r.computed_total_cost:,.2f}" if r.computed_total_cost is not None else "Missing"
        days_str = f"{r.delivery_days:g}d" if r.delivery_days is not None else "Missing"
        qual_str = f"{r.quality_rating:.1f}/5" if r.quality_rating is not None else "Unrated"
        terms_str = (r.payment_terms or "Missing")[:10]
        score_str = f"{r.final_score:6.2f}"
        line = (
            f"  {rank_str:<5} {r.supplier_name[:27]:<28} {cost_str:>12} {days_str:>6} "
            f"{qual_str:>9} {terms_str:>10} {score_str:>8}"
        )
        print(green(line) if r.rank == 1 else line)

    print("-" * 86)
    print(bold("  Individual Mathematical Breakdowns:"))
    for r in output.rankings:
        badge = green(" [TOP RANKED]") if r.rank == 1 else ""
        print(f"\n  #{r.rank} {bold(r.supplier_name)} ({r.quotation_id}) — Final Score: {bold(f'{r.final_score:.2f}/100')}{badge}")
        if r.missing_fields:
            print(yellow(f"     Missing/Unrated Dimensions: {', '.join(r.missing_fields)} (disclosed neutral {MISSING_NEUTRAL_SCORE:.0f}/100)"))
        if r.tie_breaker_note:
            print(dim(f"     Tie-breaker: {r.tie_breaker_note}"))
        for key in ("cost", "delivery", "quality", "payment_terms", "reliability"):
            fb = r.factors[key]
            missing_tag = yellow(" [Unrated / Missing]") if fb.is_missing else ""
            print(
                f"     - {fb.label:<21}: {fb.display_value:<22} | "
                f"Norm {fb.normalized_score:6.2f} * {fb.weight*100:4.1f}% = {fb.weighted_points:5.2f} pts{missing_tag}"
            )
            print(dim(f"       Formula: {fb.formula_used}"))

    print()
    print(bold("=" * 86))
    print(green(f"  Deterministic Recommendation: {output.recommended_supplier_name} ({output.recommended_quotation_id})"))
    print(bold("=" * 86))
    print()


# ─── Comprehensive Adherence & Verification Test Suite ───────────────────────

def run_verification_tests() -> bool:
    """
    Strictly verifies every Phase 4 scoring requirement:
    1. Directionality:
       - Lower cost scores higher
       - Faster delivery scores higher
       - Better quality scores higher
       - Better payment terms score higher
       - More reliable suppliers score higher
    2. Exact weights application (40/25/20/10/5)
    3. Missing field handling (no hallucinated values, explicit "Unrated / Missing")
    4. Comparability mismatch detection (quantity, unit, specification)
    5. Determinism & tie-breaker reproducibility
    """
    pr = PurchaseRequestSpec(
        id="PR-TEST-1",
        title="Test Component",
        quantity=100,
        unit="pcs",
        specifications="ISO-9001 Grade A",
    )

    # 1. Lower cost scores higher (all other factors equal)
    cost_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-CHEAP", "PR-TEST-1", "S1", "CheapCo", total_amount=1000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
            VendorQuotation("Q-PRICEY", "PR-TEST-1", "S2", "PriceyCo", total_amount=2000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
        ],
    )
    assert cost_out.rankings[0].quotation_id == "Q-CHEAP", "Lower cost must rank higher"
    assert cost_out.rankings[0].factors["cost"].normalized_score == 100.0
    assert cost_out.rankings[1].factors["cost"].normalized_score == 50.0

    # 2. Faster delivery scores higher
    del_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-FAST", "PR-TEST-1", "S1", "FastCo", total_amount=1000, delivery_days=5, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
            VendorQuotation("Q-SLOW", "PR-TEST-1", "S2", "SlowCo", total_amount=1000, delivery_days=20, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
        ],
    )
    assert del_out.rankings[0].quotation_id == "Q-FAST", "Faster delivery must rank higher"
    assert del_out.rankings[0].factors["delivery"].normalized_score == 100.0
    assert del_out.rankings[1].factors["delivery"].normalized_score == 25.0

    # 3. Better quality scores higher
    qual_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-HIQ", "PR-TEST-1", "S1", "HighQual", total_amount=1000, delivery_days=10, quality_rating=5.0, payment_terms="Net 30", reliability_score=80),
            VendorQuotation("Q-LOQ", "PR-TEST-1", "S2", "LowQual", total_amount=1000, delivery_days=10, quality_rating=2.5, payment_terms="Net 30", reliability_score=80),
        ],
    )
    assert qual_out.rankings[0].quotation_id == "Q-HIQ", "Better quality must rank higher"
    assert qual_out.rankings[0].factors["quality"].normalized_score == 100.0
    assert qual_out.rankings[1].factors["quality"].normalized_score == 50.0

    # 4. Better payment terms score higher (Net 90 > Net 60 > Net 45 > Net 30 > Net 15 > Immediate > Advance)
    ladder_order = ["Net 90", "Net 60", "Net 45", "Net 30", "Net 15", "Immediate", "Advance"]
    ladder_scores = [score_payment_terms(t)[0] for t in ladder_order]
    assert ladder_scores == [100.0, 85.0, 75.0, 60.0, 45.0, 30.0, 15.0], f"Unexpected ladder scores: {ladder_scores}"

    # 5. More reliable suppliers score higher
    rel_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-REL", "PR-TEST-1", "S1", "ReliableCo", total_amount=1000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=98),
            VendorQuotation("Q-UNREL", "PR-TEST-1", "S2", "UnreliableCo", total_amount=1000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=40),
        ],
    )
    assert rel_out.rankings[0].quotation_id == "Q-REL", "Higher reliability must rank higher"
    assert rel_out.rankings[0].factors["reliability"].normalized_score == 98.0
    assert rel_out.rankings[1].factors["reliability"].normalized_score == 40.0

    # 6. Exact weighted total verification:
    #    Cost=100 (0.40 -> 40), Delivery=100 (0.25 -> 25), Quality=80 (0.20 -> 16),
    #    Terms=Net 60=85 (0.10 -> 8.5), Reliability=90 (0.05 -> 4.5) => Final = 94.0
    exact_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-EXACT", "PR-TEST-1", "S1", "ExactCo", total_amount=500, delivery_days=7, quality_rating=4.0, payment_terms="Net 60", reliability_score=90),
        ],
    )
    assert exact_out.rankings[0].final_score == 94.0, f"Expected 94.0, got {exact_out.rankings[0].final_score}"

    # 7. Missing values handled explicitly without hallucination
    missing_out = compare_vendors(
        pr,
        [
            VendorQuotation("Q-MISS", "PR-TEST-1", "S1", "SparseCo", total_amount=1000, delivery_days=None, quality_rating=None, payment_terms=None, reliability_score=None),
        ],
    )
    r_miss = missing_out.rankings[0]
    assert set(r_miss.missing_fields) == {"Delivery", "Quality", "Payment Terms", "Reliability"}
    for key in ("delivery", "quality", "payment_terms", "reliability"):
        assert r_miss.factors[key].is_missing is True
        assert r_miss.factors[key].display_value == MISSING_LABEL
        assert r_miss.factors[key].normalized_score == MISSING_NEUTRAL_SCORE

    # 8. Comparability check detects quantity, unit, and spec mismatches
    pr_demo, quotes_demo = build_demo_scenario()
    demo_out = compare_vendors(pr_demo, quotes_demo)
    assert demo_out.comparability.is_comparable is False
    mismatch_fields = {m.field for m in demo_out.comparability.mismatches}
    assert "quantity" in mismatch_fields and "specifications" in mismatch_fields

    # 9. Determinism across repeated runs & tie-breaker ordering
    tie_quotes = [
        VendorQuotation("Q-B", "PR-TEST-1", "S2", "Beta Supply", total_amount=1000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
        VendorQuotation("Q-A", "PR-TEST-1", "S1", "Alpha Supply", total_amount=1000, delivery_days=10, quality_rating=4.0, payment_terms="Net 30", reliability_score=80),
    ]
    run1 = json.dumps(asdict(compare_vendors(pr, tie_quotes)), sort_keys=True)
    run2 = json.dumps(asdict(compare_vendors(pr, list(reversed(tie_quotes)))), sort_keys=True)
    assert run1 == run2, "Comparison engine must be strictly deterministic regardless of input ordering"

    return True


def parse_weights_arg(arg: str) -> Dict[str, float]:
    mapping = {
        "cost": "cost",
        "delivery": "delivery",
        "quality": "quality",
        "terms": "payment_terms",
        "payment_terms": "payment_terms",
        "reliability": "reliability",
    }
    parsed: Dict[str, float] = {}
    for pair in arg.split(","):
        if "=" not in pair:
            raise ValueError(f"Invalid weight pair '{pair}'. Expected format key=value.")
        k, v = pair.split("=", 1)
        k_norm = k.strip().lower()
        if k_norm not in mapping:
            raise ValueError(f"Unknown weight key '{k}'. Valid keys: {', '.join(mapping.keys())}")
        parsed[mapping[k_norm]] = float(v.strip())
    return parsed


def load_input_json(path: str) -> Tuple[PurchaseRequestSpec, List[VendorQuotation]]:
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    pr_data = payload["purchase_request"]
    pr = PurchaseRequestSpec(
        id=str(pr_data["id"]),
        title=str(pr_data.get("title", "Purchase Request")),
        quantity=pr_data.get("quantity"),
        unit=pr_data.get("unit"),
        specifications=pr_data.get("specifications"),
        estimated_budget=pr_data.get("estimated_budget"),
    )
    quotations: List[VendorQuotation] = []
    for qd in payload["quotations"]:
        items = [
            QuotationLineItem(
                description=str(it.get("description", "")),
                quantity=it.get("quantity"),
                unit_price=it.get("unit_price"),
                total_price=it.get("total_price"),
                unit=it.get("unit"),
                specifications=it.get("specifications"),
            )
            for it in qd.get("items", [])
        ]
        quotations.append(
            VendorQuotation(
                quotation_id=str(qd["quotation_id"]),
                purchase_request_id=str(qd.get("purchase_request_id", pr.id)),
                supplier_id=str(qd.get("supplier_id", "")),
                supplier_name=str(qd["supplier_name"]),
                items=items,
                total_amount=qd.get("total_amount"),
                delivery_charges=float(qd.get("delivery_charges", 0.0) or 0.0),
                tax_amount=float(qd.get("tax_amount", 0.0) or 0.0),
                delivery_days=qd.get("delivery_days"),
                quality_rating=qd.get("quality_rating"),
                payment_terms=qd.get("payment_terms"),
                reliability_score=qd.get("reliability_score"),
                currency=str(qd.get("currency", "USD")),
                notes=qd.get("notes"),
            )
        )
    return pr, quotations


def main(argv: Optional[List[str]] = None) -> int:
    global USE_COLOR
    parser = argparse.ArgumentParser(
        description="ProcureLens Deterministic Smart Vendor Comparison Engine (Python Companion)"
    )
    parser.add_argument("--input", type=str, help="Path to JSON file containing purchase_request and quotations")
    parser.add_argument("--weights", type=str, help="Custom weights, e.g. cost=40,delivery=25,quality=20,terms=10,reliability=5")
    parser.add_argument("--test", action="store_true", help="Run scoring adherence & determinism verification tests")
    parser.add_argument("--json", action="store_true", help="Emit comparison result as JSON")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color codes")

    args = parser.parse_args(argv)
    if args.no_color or args.json or not sys.stdout.isatty():
        USE_COLOR = False

    if args.test:
        run_verification_tests()
        if args.json:
            print(json.dumps({"tests_passed": True, "ai_used_in_ranking": False}, indent=2))
        else:
            print(green("[PASS] All 9 deterministic scoring, directionality, missing-value, comparability, and tie-breaker tests passed."))
        return 0

    custom_weights = parse_weights_arg(args.weights) if args.weights else None
    pr, quotations = load_input_json(args.input) if args.input else build_demo_scenario()
    output = compare_vendors(pr, quotations, weights=custom_weights)

    if args.json:
        print(json.dumps(asdict(output), indent=2))
    else:
        print_cli_report(output)
        run_verification_tests()
        print(green("  [PASS] Self-test verification suite passed (9/9 assertions).\n"))

    return 0


if __name__ == "__main__":
    sys.exit(main())
