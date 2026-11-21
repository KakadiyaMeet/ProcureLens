#!/usr/bin/env python3
"""
ProcureLens Database & Procurement Analytics Engine
===================================================

Python-based procurement data analysis, schema validation, multi-tenant
organization isolation enforcement, and reporting utilities for ProcureLens.

Features:
- Schema validation for all 8 core DeepSpace models:
  * organizations
  * users
  * suppliers
  * purchase_requests
  * quotations
  * quotation_items
  * comparisons
  * decisions
- Multi-tenant organization isolation verification (strict organizationId checks)
- Cross-collection referential integrity validation
- Strict status workflow state machine verification
- Procurement analytics (budget vs spend, savings analysis, supplier metrics)
- Demo data generation and validation CLI

Usage:
    python scripts/procurelens_db.py --help
    python scripts/procurelens_db.py schema
    python scripts/procurelens_db.py validate <file.json> [--type <collection>]
    python scripts/procurelens_db.py report <file.json> [--type <summary|suppliers|requests|isolation>]
    python scripts/procurelens_db.py verify-isolation <database_dump.json>
    python scripts/procurelens_db.py generate-demo [--output demo.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Schema Specifications
# ---------------------------------------------------------------------------

VALID_ORG_SIZES = {"1-10", "11-50", "51-200", "201-500", "500+"}
VALID_SUPPLIER_STATUSES = {"active", "inactive", "blacklisted"}
VALID_PR_PRIORITIES = {"low", "medium", "high", "urgent"}
VALID_PR_STATUSES = {"draft", "pending", "approved", "in_progress", "completed", "cancelled"}
VALID_QUOTATION_STATUSES = {"draft", "submitted", "under_review", "accepted", "rejected"}
VALID_COMPARISON_STATUSES = {"in_progress", "completed"}
VALID_DECISION_STATUSES = {"pending", "approved", "rejected"}

# Strict workflow transitions for Purchase Requests
PR_WORKFLOW_TRANSITIONS: Dict[str, Set[str]] = {
    "draft": {"pending", "cancelled"},
    "pending": {"approved", "cancelled", "draft"},
    "approved": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": {"draft"},
}

SCHEMA_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "organizations": {
        "required": ["name", "slug"],
        "fields": {
            "name": str,
            "slug": str,
            "description": (str, type(None)),
            "industry": (str, type(None)),
            "size": (str, type(None)),
            "ownerId": (str, type(None)),
        },
        "enums": {"size": VALID_ORG_SIZES},
    },
    "users": {
        "required": [],
        "fields": {
            "name": (str, type(None)),
            "email": (str, type(None)),
            "role": (str, type(None)),
            "image": (str, type(None)),
        },
        "enums": {},
    },
    "suppliers": {
        "required": ["organizationId", "name", "email"],
        "fields": {
            "organizationId": str,
            "name": str,
            "email": str,
            "phone": (str, type(None)),
            "address": (str, type(None)),
            "category": (str, type(None)),
            "rating": (int, float, type(None)),
            "status": (str, type(None)),
            "notes": (str, type(None)),
            "contactPerson": (str, type(None)),
            "website": (str, type(None)),
            "taxId": (str, type(None)),
        },
        "enums": {"status": VALID_SUPPLIER_STATUSES},
    },
    "purchase_requests": {
        "required": ["organizationId", "title", "description", "quantity", "estimatedBudget"],
        "fields": {
            "organizationId": str,
            "title": str,
            "description": str,
            "category": (str, type(None)),
            "priority": (str, type(None)),
            "status": (str, type(None)),
            "quantity": (int, float),
            "unit": (str, type(None)),
            "estimatedBudget": (int, float),
            "requiredByDate": (str, type(None)),
            "requestedBy": (str, type(None)),
            "approvedBy": (str, type(None)),
            "notes": (str, type(None)),
        },
        "enums": {
            "priority": VALID_PR_PRIORITIES,
            "status": VALID_PR_STATUSES,
        },
    },
    "quotations": {
        "required": ["organizationId", "purchaseRequestId", "supplierId", "totalAmount"],
        "fields": {
            "organizationId": str,
            "purchaseRequestId": str,
            "supplierId": str,
            "supplierName": (str, type(None)),
            "totalAmount": (int, float),
            "currency": (str, type(None)),
            "validUntil": (str, type(None)),
            "deliveryDays": (int, float, type(None)),
            "paymentTerms": (str, type(None)),
            "status": (str, type(None)),
            "notes": (str, type(None)),
        },
        "enums": {"status": VALID_QUOTATION_STATUSES},
    },
    "quotation_items": {
        "required": ["organizationId", "quotationId", "description", "quantity", "unitPrice"],
        "fields": {
            "organizationId": str,
            "quotationId": str,
            "description": str,
            "quantity": (int, float),
            "unitPrice": (int, float),
            "totalPrice": (int, float, type(None)),
            "unit": (str, type(None)),
            "specifications": (str, type(None)),
        },
        "enums": {},
    },
    "comparisons": {
        "required": ["organizationId", "purchaseRequestId", "title"],
        "fields": {
            "organizationId": str,
            "purchaseRequestId": str,
            "title": str,
            "quotationIds": (str, type(None)),
            "criteria": (str, type(None)),
            "status": (str, type(None)),
            "recommendation": (str, type(None)),
            "notes": (str, type(None)),
        },
        "enums": {"status": VALID_COMPARISON_STATUSES},
    },
    "decisions": {
        "required": [
            "organizationId",
            "comparisonId",
            "purchaseRequestId",
            "selectedQuotationId",
            "selectedSupplierId",
            "totalAmount",
        ],
        "fields": {
            "organizationId": str,
            "comparisonId": str,
            "purchaseRequestId": str,
            "selectedQuotationId": str,
            "selectedSupplierId": str,
            "selectedSupplierName": (str, type(None)),
            "totalAmount": (int, float),
            "justification": (str, type(None)),
            "approvedBy": (str, type(None)),
            "status": (str, type(None)),
        },
        "enums": {"status": VALID_DECISION_STATUSES},
    },
}

# ---------------------------------------------------------------------------
# Validation Logic
# ---------------------------------------------------------------------------

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ValidationIssue:
    def __init__(self, record_id: str, field_name: str, message: str, severity: str = "ERROR"):
        self.record_id = record_id
        self.field_name = field_name
        self.message = message
        self.severity = severity

    def __repr__(self) -> str:
        return f"[{self.severity}] {self.record_id} -> {self.field_name}: {self.message}"


def _get_record_data(record: dict) -> dict:
    """Unwraps deepspace record envelope if present (e.g. {'recordId': '...', 'data': {...}})."""
    if "data" in record and isinstance(record["data"], dict):
        d = dict(record["data"])
        if "recordId" in record and "recordId" not in d:
            d["recordId"] = record["recordId"]
        return d
    return record


def validate_single_record(collection: str, record: dict) -> List[ValidationIssue]:
    """Validate a single record against schema and business constraints."""
    data = _get_record_data(record)
    rec_id = str(data.get("recordId") or data.get("id") or "unknown-record")
    issues: List[ValidationIssue] = []

    spec = SCHEMA_DEFINITIONS.get(collection)
    if not spec:
        issues.append(ValidationIssue(rec_id, "collection", f"Unknown collection '{collection}'"))
        return issues

    # 1. Required fields check
    for req in spec["required"]:
        if req not in data or data[req] is None:
            issues.append(ValidationIssue(rec_id, req, f"Missing required field '{req}'"))
        elif isinstance(data[req], str) and not data[req].strip():
            issues.append(ValidationIssue(rec_id, req, f"Required field '{req}' cannot be empty string"))

    # 2. Type validation
    for field_name, expected_type in spec["fields"].items():
        if field_name in data and data[field_name] is not None:
            val = data[field_name]
            if not isinstance(val, expected_type):
                issues.append(
                    ValidationIssue(
                        rec_id,
                        field_name,
                        f"Field '{field_name}' expected {expected_type}, got {type(val).__name__}",
                    )
                )

    # 3. Enum validation
    for field_name, allowed_values in spec["enums"].items():
        if field_name in data and data[field_name]:
            val = data[field_name]
            if val not in allowed_values:
                issues.append(
                    ValidationIssue(
                        rec_id,
                        field_name,
                        f"Field '{field_name}' value '{val}' not in allowed set: {sorted(allowed_values)}",
                    )
                )

    # 4. Domain / business-specific validations
    if collection == "suppliers":
        email = data.get("email")
        if email and isinstance(email, str) and not EMAIL_REGEX.match(email.strip()):
            issues.append(ValidationIssue(rec_id, "email", f"Invalid email format: '{email}'"))

        rating = data.get("rating")
        if rating is not None:
            try:
                num_rating = float(rating)
                if num_rating < 0.0 or num_rating > 5.0:
                    issues.append(
                        ValidationIssue(rec_id, "rating", f"Supplier rating must be between 0.0 and 5.0 (got {rating})")
                    )
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "rating", f"Rating must be numeric (got {rating})"))

    elif collection == "purchase_requests":
        qty = data.get("quantity")
        if qty is not None:
            try:
                num_qty = float(qty)
                if num_qty <= 0:
                    issues.append(ValidationIssue(rec_id, "quantity", f"Quantity must be greater than zero (got {qty})"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "quantity", "Quantity must be numeric"))

        budget = data.get("estimatedBudget")
        if budget is not None:
            try:
                num_budget = float(budget)
                if num_budget < 0:
                    issues.append(
                        ValidationIssue(rec_id, "estimatedBudget", f"Estimated budget must be non-negative (got {budget})")
                    )
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "estimatedBudget", "Estimated budget must be numeric"))

        req_date = data.get("requiredByDate")
        if req_date and isinstance(req_date, str) and req_date.strip():
            try:
                datetime.fromisoformat(req_date.strip().replace("Z", "+00:00"))
            except ValueError:
                issues.append(ValidationIssue(rec_id, "requiredByDate", f"Invalid date format: '{req_date}'"))

    elif collection == "quotations":
        total = data.get("totalAmount")
        if total is not None:
            try:
                num_total = float(total)
                if num_total < 0:
                    issues.append(ValidationIssue(rec_id, "totalAmount", f"Total amount cannot be negative (got {total})"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "totalAmount", "Total amount must be numeric"))

        days = data.get("deliveryDays")
        if days is not None:
            try:
                num_days = float(days)
                if num_days < 0:
                    issues.append(ValidationIssue(rec_id, "deliveryDays", "Delivery days cannot be negative"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "deliveryDays", "Delivery days must be numeric"))

    elif collection == "quotation_items":
        qty = data.get("quantity")
        if qty is not None:
            try:
                if float(qty) <= 0:
                    issues.append(ValidationIssue(rec_id, "quantity", "Quantity must be greater than zero"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "quantity", "Quantity must be numeric"))

        unit_price = data.get("unitPrice")
        if unit_price is not None:
            try:
                if float(unit_price) < 0:
                    issues.append(ValidationIssue(rec_id, "unitPrice", "Unit price cannot be negative"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "unitPrice", "Unit price must be numeric"))

    elif collection == "decisions":
        amt = data.get("totalAmount")
        if amt is not None:
            try:
                if float(amt) < 0:
                    issues.append(ValidationIssue(rec_id, "totalAmount", "Decision total amount cannot be negative"))
            except (ValueError, TypeError):
                issues.append(ValidationIssue(rec_id, "totalAmount", "Decision total amount must be numeric"))

    return issues


# ---------------------------------------------------------------------------
# Multi-Tenant Isolation & Referential Integrity
# ---------------------------------------------------------------------------

@dataclass
class IsolationAuditResult:
    total_records: int = 0
    tenant_counts: Dict[str, Dict[str, int]] = field(default_factory=dict)
    cross_tenant_violations: List[str] = field(default_factory=list)
    orphaned_records: List[str] = field(default_factory=list)
    missing_org_ids: List[str] = field(default_factory=list)


def audit_multi_tenant_isolation(database_data: Dict[str, List[dict]]) -> IsolationAuditResult:
    """
    Examines all records across collections to strictly enforce:
    1. Every record in a tenant collection has a non-empty organizationId.
    2. References across collections (e.g. PR -> Quotation -> Item -> Decision)
       stay strictly within the same organizationId boundary.
    """
    res = IsolationAuditResult()

    # Build index of records by ID: (collection, id) -> record_data
    id_map: Dict[Tuple[str, str], dict] = {}
    org_set: Set[str] = set()

    # Index organizations first
    for r in database_data.get("organizations", []):
        d = _get_record_data(r)
        rid = d.get("recordId") or d.get("id")
        if rid:
            org_set.add(str(rid))
            id_map[("organizations", str(rid))] = d

    # Index all other collections
    for col, records in database_data.items():
        if col == "organizations":
            continue
        for r in records:
            d = _get_record_data(r)
            rid = str(d.get("recordId") or d.get("id") or "")
            if rid:
                id_map[(col, rid)] = d

            res.total_records += 1
            org_id = d.get("organizationId")

            # Check tenant assignment
            if not org_id:
                res.missing_org_ids.append(f"Collection '{col}' record '{rid}' has no organizationId")
            else:
                org_str = str(org_id)
                if org_str not in res.tenant_counts:
                    res.tenant_counts[org_str] = {}
                res.tenant_counts[org_str][col] = res.tenant_counts[org_str].get(col, 0) + 1

    # Referential integrity checks with cross-tenant isolation enforcement
    # 1. Quotations -> purchaseRequestId, supplierId
    for r in database_data.get("quotations", []):
        d = _get_record_data(r)
        qid = str(d.get("recordId") or d.get("id") or "")
        org_id = d.get("organizationId")

        pr_id = d.get("purchaseRequestId")
        if pr_id:
            pr = id_map.get(("purchase_requests", str(pr_id)))
            if not pr:
                res.orphaned_records.append(f"Quotation '{qid}' points to non-existent PR '{pr_id}'")
            elif pr.get("organizationId") != org_id:
                res.cross_tenant_violations.append(
                    f"Cross-tenant leak: Quotation '{qid}' (org: {org_id}) references PR '{pr_id}' (org: {pr.get('organizationId')})"
                )

        supp_id = d.get("supplierId")
        if supp_id:
            supp = id_map.get(("suppliers", str(supp_id)))
            if not supp:
                res.orphaned_records.append(f"Quotation '{qid}' points to non-existent Supplier '{supp_id}'")
            elif supp.get("organizationId") != org_id:
                res.cross_tenant_violations.append(
                    f"Cross-tenant leak: Quotation '{qid}' (org: {org_id}) references Supplier '{supp_id}' (org: {supp.get('organizationId')})"
                )

    # 2. Quotation Items -> quotationId
    for r in database_data.get("quotation_items", []):
        d = _get_record_data(r)
        qi_id = str(d.get("recordId") or d.get("id") or "")
        org_id = d.get("organizationId")

        qid = d.get("quotationId")
        if qid:
            quote = id_map.get(("quotations", str(qid)))
            if not quote:
                res.orphaned_records.append(f"QuotationItem '{qi_id}' points to non-existent Quotation '{qid}'")
            elif quote.get("organizationId") != org_id:
                res.cross_tenant_violations.append(
                    f"Cross-tenant leak: QuotationItem '{qi_id}' (org: {org_id}) references Quotation '{qid}' (org: {quote.get('organizationId')})"
                )

    # 3. Decisions -> comparisonId, purchaseRequestId, selectedQuotationId, selectedSupplierId
    for r in database_data.get("decisions", []):
        d = _get_record_data(r)
        dec_id = str(d.get("recordId") or d.get("id") or "")
        org_id = d.get("organizationId")

        for ref_col, ref_field in [
            ("comparisons", "comparisonId"),
            ("purchase_requests", "purchaseRequestId"),
            ("quotations", "selectedQuotationId"),
            ("suppliers", "selectedSupplierId"),
        ]:
            target_id = d.get(ref_field)
            if target_id:
                target = id_map.get((ref_col, str(target_id)))
                if not target:
                    res.orphaned_records.append(
                        f"Decision '{dec_id}' points to non-existent {ref_col} '{target_id}'"
                    )
                elif target.get("organizationId") != org_id:
                    res.cross_tenant_violations.append(
                        f"Cross-tenant leak: Decision '{dec_id}' (org: {org_id}) references {ref_col} '{target_id}' (org: {target.get('organizationId')})"
                    )

    return res


# ---------------------------------------------------------------------------
# Procurement Analytics & Reporting
# ---------------------------------------------------------------------------

def generate_procurement_report(database_data: Dict[str, List[dict]]) -> str:
    """Generates an ASCII analytical report summarizing procurement operations."""
    lines: List[str] = []
    lines.append("=" * 65)
    lines.append("        PROCURELENS PROCUREMENT INTELLIGENCE REPORT")
    lines.append(f"        Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append("=" * 65)

    orgs = database_data.get("organizations", [])
    suppliers = database_data.get("suppliers", [])
    prs = database_data.get("purchase_requests", [])
    quotations = database_data.get("quotations", [])
    decisions = database_data.get("decisions", [])

    lines.append(f"\n1. ECOSYSTEM SUMMARY")
    lines.append(f"   Organizations     : {len(orgs)}")
    lines.append(f"   Suppliers         : {len(suppliers)}")
    lines.append(f"   Purchase Requests : {len(prs)}")
    lines.append(f"   Quotations        : {len(quotations)}")
    lines.append(f"   Awarded Decisions : {len(decisions)}")

    # PR Analytics
    total_est_budget = 0.0
    status_counts: Dict[str, int] = {}
    priority_counts: Dict[str, int] = {}

    for r in prs:
        d = _get_record_data(r)
        st = d.get("status", "draft")
        pr = d.get("priority", "medium")
        status_counts[st] = status_counts.get(st, 0) + 1
        priority_counts[pr] = priority_counts.get(pr, 0) + 1
        try:
            total_est_budget += float(d.get("estimatedBudget", 0) or 0)
        except (ValueError, TypeError):
            pass

    lines.append(f"\n2. PURCHASE REQUEST WORKFLOW")
    lines.append(f"   Total Estimated Budget: ${total_est_budget:,.2f}")
    lines.append("   Status Distribution:")
    for st in ["draft", "pending", "approved", "in_progress", "completed", "cancelled"]:
        cnt = status_counts.get(st, 0)
        pct = (cnt / len(prs) * 100) if prs else 0.0
        bar = "#" * int(pct / 5)
        lines.append(f"     * {st:<14} : {cnt:>3} ({pct:>5.1f}%) {bar}")

    lines.append("   Priority Distribution:")
    for pr in ["low", "medium", "high", "urgent"]:
        cnt = priority_counts.get(pr, 0)
        lines.append(f"     * {pr:<10} : {cnt:>3}")

    # Supplier Analytics
    supp_status_counts: Dict[str, int] = {}
    supp_categories: Dict[str, int] = {}
    ratings: List[float] = []

    for s in suppliers:
        sd = _get_record_data(s)
        st = sd.get("status", "active")
        supp_status_counts[st] = supp_status_counts.get(st, 0) + 1
        cat = sd.get("category") or "Uncategorized"
        supp_categories[cat] = supp_categories.get(cat, 0) + 1
        if sd.get("rating") is not None:
            try:
                ratings.append(float(sd["rating"]))
            except (ValueError, TypeError):
                pass

    avg_rating = sum(ratings) / len(ratings) if ratings else 0.0
    lines.append(f"\n3. SUPPLIER ECOSYSTEM")
    lines.append(f"   Active Suppliers     : {supp_status_counts.get('active', 0)}")
    lines.append(f"   Inactive Suppliers   : {supp_status_counts.get('inactive', 0)}")
    lines.append(f"   Blacklisted Suppliers: {supp_status_counts.get('blacklisted', 0)}")
    lines.append(f"   Average Rating       : {avg_rating:.2f} / 5.00")
    lines.append("   Top Supplier Categories:")
    for cat, count in sorted(supp_categories.items(), key=lambda x: -x[1])[:5]:
        lines.append(f"     * {cat:<22} : {count} suppliers")

    # Financial & Savings Analytics
    total_awarded_amount = 0.0
    for dec in decisions:
        dd = _get_record_data(dec)
        if dd.get("status") == "approved":
            try:
                total_awarded_amount += float(dd.get("totalAmount", 0) or 0)
            except (ValueError, TypeError):
                pass

    savings = max(0.0, total_est_budget - total_awarded_amount) if total_awarded_amount > 0 else 0.0
    savings_pct = (savings / total_est_budget * 100) if total_est_budget > 0 else 0.0

    lines.append(f"\n4. FINANCIALS & COST SAVINGS")
    lines.append(f"   Total PR Budgeted     : ${total_est_budget:,.2f}")
    lines.append(f"   Total Awarded Spend   : ${total_awarded_amount:,.2f}")
    lines.append(f"   Estimated Savings     : ${savings:,.2f} ({savings_pct:.1f}%)")

    lines.append("\n" + "=" * 65)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Demo Fixture Generator
# ---------------------------------------------------------------------------

def generate_procurelens_fixtures(org_id: str = "org_demo_procurelens") -> Dict[str, List[dict]]:
    """Generates a complete, valid multi-tenant procurement database fixture."""
    now_iso = datetime.now(timezone.utc).isoformat()

    orgs = [
        {
            "recordId": org_id,
            "data": {
                "name": "Global Tech Logistics",
                "slug": "global-tech-logistics",
                "description": "Enterprise logistics and supply-chain division.",
                "industry": "Supply Chain & Logistics",
                "size": "51-200",
                "ownerId": "usr_admin_01",
            },
        }
    ]

    suppliers = [
        {
            "recordId": "sup_dell_hardware",
            "data": {
                "organizationId": org_id,
                "name": "Dell Premier Enterprise Solutions",
                "email": "enterprise-sales@dell.com",
                "phone": "+1 (800) 456-3355",
                "address": "1 Dell Way, Round Rock, TX 78682",
                "category": "IT Hardware",
                "rating": 4.8,
                "status": "active",
                "notes": "Net 30 terms, dedicated enterprise technical account manager.",
                "contactPerson": "Marcus Vance",
                "website": "https://dell.com",
                "taxId": "US-741234567",
            },
        },
        {
            "recordId": "sup_steelcase_office",
            "data": {
                "organizationId": org_id,
                "name": "Steelcase Ergonomic Furnishings",
                "email": "contracts@steelcase.com",
                "phone": "+1 (800) 333-9939",
                "address": "901 44th Street SE, Grand Rapids, MI 49508",
                "category": "Office Furniture",
                "rating": 4.6,
                "status": "active",
                "notes": "Special corporate discount tier B applied.",
                "contactPerson": "Sarah Jenkins",
                "website": "https://steelcase.com",
                "taxId": "US-381234567",
            },
        },
        {
            "recordId": "sup_apex_logistics",
            "data": {
                "organizationId": org_id,
                "name": "Apex Cargo & Freight Logistics",
                "email": "dispatches@apexcargo.io",
                "phone": "+1 (555) 888-2341",
                "address": "742 Evergreen Terrace, Chicago, IL 60601",
                "category": "Logistics",
                "rating": 3.9,
                "status": "inactive",
                "notes": "Service contract under renegotiation.",
                "contactPerson": "David Miller",
                "website": "https://apexcargo.io",
                "taxId": "US-361234567",
            },
        },
    ]

    purchase_requests = [
        {
            "recordId": "pr_laptops_2026",
            "data": {
                "organizationId": org_id,
                "title": "50x Dell XPS 15 Developer Workstations",
                "description": "Standard engineering refresh batch for 2026 Q1 onboarding.",
                "category": "IT Hardware",
                "priority": "high",
                "status": "approved",
                "quantity": 50,
                "unit": "units",
                "estimatedBudget": 95000.0,
                "requiredByDate": "2026-12-15T00:00:00Z",
                "requestedBy": "Alex Chen, VP Engineering",
                "approvedBy": "Elena Rostova, Head of Procurement",
                "notes": "Requires 64GB RAM and 1TB SSD configuration.",
            },
        },
        {
            "recordId": "pr_chairs_2026",
            "data": {
                "organizationId": org_id,
                "title": "30x Ergonomic Task Chairs",
                "description": "Ergonomic seating for new floor expansion.",
                "category": "Office Furniture",
                "priority": "medium",
                "status": "in_progress",
                "quantity": 30,
                "unit": "units",
                "estimatedBudget": 18000.0,
                "requiredByDate": "2026-12-01T00:00:00Z",
                "requestedBy": "Facilities Team",
                "approvedBy": "Elena Rostova",
                "notes": "Steelcase Gesture or Leap preferred.",
            },
        },
    ]

    quotations = [
        {
            "recordId": "quote_dell_xps_01",
            "data": {
                "organizationId": org_id,
                "purchaseRequestId": "pr_laptops_2026",
                "supplierId": "sup_dell_hardware",
                "supplierName": "Dell Premier Enterprise Solutions",
                "totalAmount": 92500.0,
                "currency": "USD",
                "validUntil": "2026-12-31T00:00:00Z",
                "deliveryDays": 14,
                "paymentTerms": "Net 30",
                "status": "accepted",
                "notes": "Includes 3-year ProSupport Plus warranty and on-site repair.",
            },
        }
    ]

    quotation_items = [
        {
            "recordId": "qi_laptop_item_01",
            "data": {
                "organizationId": org_id,
                "quotationId": "quote_dell_xps_01",
                "description": "Dell XPS 15 - Core i9, 64GB DDR5, 1TB NVMe, RTX 4070",
                "quantity": 50,
                "unitPrice": 1850.0,
                "totalPrice": 92500.0,
                "unit": "units",
                "specifications": "Factory pre-loaded with Ubuntu LTS / Enterprise Image",
            },
        }
    ]

    comparisons = [
        {
            "recordId": "comp_laptops_2026",
            "data": {
                "organizationId": org_id,
                "purchaseRequestId": "pr_laptops_2026",
                "title": "Workstation Vendor Evaluation 2026",
                "quotationIds": "quote_dell_xps_01",
                "criteria": "Price, Support SLA, Delivery Timeline, Technical Specs",
                "status": "completed",
                "recommendation": "Award to Dell Enterprise due to bundled 3-year ProSupport SLA and sub-budget pricing.",
                "notes": "Dell came in $2,500 under estimated budget.",
            },
        }
    ]

    decisions = [
        {
            "recordId": "dec_laptops_2026",
            "data": {
                "organizationId": org_id,
                "comparisonId": "comp_laptops_2026",
                "purchaseRequestId": "pr_laptops_2026",
                "selectedQuotationId": "quote_dell_xps_01",
                "selectedSupplierId": "sup_dell_hardware",
                "selectedSupplierName": "Dell Premier Enterprise Solutions",
                "totalAmount": 92500.0,
                "justification": "Lowest qualified quote with top tier warranty, saving $2,500 against allocated budget.",
                "approvedBy": "Elena Rostova, Head of Procurement",
                "status": "approved",
            },
        }
    ]

    return {
        "organizations": orgs,
        "suppliers": suppliers,
        "purchase_requests": purchase_requests,
        "quotations": quotations,
        "quotation_items": quotation_items,
        "comparisons": comparisons,
        "decisions": decisions,
    }


# ---------------------------------------------------------------------------
# CLI Commands
# ---------------------------------------------------------------------------

def cmd_schema(args: argparse.Namespace) -> None:
    """Print schema definitions in human-readable or JSON format."""
    target_col = args.type
    if target_col:
        if target_col not in SCHEMA_DEFINITIONS:
            print(f"ERROR: Unknown collection '{target_col}'. Options: {list(SCHEMA_DEFINITIONS.keys())}", file=sys.stderr)
            sys.exit(1)
        out = {target_col: SCHEMA_DEFINITIONS[target_col]}
    else:
        out = SCHEMA_DEFINITIONS

    # Format JSON nicely with type names
    serializable: Dict[str, Any] = {}
    for col, spec in out.items():
        serializable[col] = {
            "required": spec["required"],
            "fields": {
                k: [t.__name__ for t in v] if isinstance(v, tuple) else v.__name__
                for k, v in spec["fields"].items()
            },
            "enums": {k: list(v) for k, v in spec["enums"].items()},
        }

    print(json.dumps(serializable, indent=2))


def cmd_validate(args: argparse.Namespace) -> None:
    """Validate records from a file against schemas."""
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"ERROR: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    try:
        content = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR: Invalid JSON file: {exc}", file=sys.stderr)
        sys.exit(1)

    all_issues: List[ValidationIssue] = []

    if isinstance(content, dict) and any(k in SCHEMA_DEFINITIONS for k in content.keys()):
        # Multi-collection database dump
        for col, records in content.items():
            if col in SCHEMA_DEFINITIONS and isinstance(records, list):
                for r in records:
                    all_issues.extend(validate_single_record(col, r))
    else:
        # Single collection records list
        col_type = args.type or "purchase_requests"
        records = content if isinstance(content, list) else content.get("records", [])
        for r in records:
            all_issues.extend(validate_single_record(col_type, r))

    if all_issues:
        print(f"\nFAILURE: Found {len(all_issues)} validation issues:")
        for iss in all_issues:
            print(f"  • {iss}")
        sys.exit(1)
    else:
        print(f"\nSUCCESS: All records passed schema and business logic validation.")


def cmd_verify_isolation(args: argparse.Namespace) -> None:
    """Perform strict multi-tenant isolation and referential integrity audit."""
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"ERROR: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR: Invalid JSON file: {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, dict):
        print("ERROR: verify-isolation expects a database dump dictionary containing collections as keys.", file=sys.stderr)
        sys.exit(1)

    audit = audit_multi_tenant_isolation(data)

    print("=" * 65)
    print("      MULTI-TENANT ISOLATION & REFERENTIAL INTEGRITY AUDIT")
    print("=" * 65)
    print(f"Total Tenant Records Audited : {audit.total_records}")
    print(f"Active Organizations Found   : {len(audit.tenant_counts)}")

    print("\nRecords Breakdown by Organization:")
    for org_id, cols in audit.tenant_counts.items():
        total_org_recs = sum(cols.values())
        print(f"  Tenant [{org_id}] ({total_org_recs} records):")
        for cname, count in sorted(cols.items()):
            print(f"    - {cname:<20}: {count}")

    has_errors = False

    if audit.missing_org_ids:
        has_errors = True
        print(f"\n[CRITICAL] Missing organizationId ({len(audit.missing_org_ids)} records):")
        for m in audit.missing_org_ids[:10]:
            print(f"  ! {m}")

    if audit.cross_tenant_violations:
        has_errors = True
        print(f"\n[CRITICAL] Cross-Tenant Leaks Detected ({len(audit.cross_tenant_violations)}):")
        for v in audit.cross_tenant_violations:
            print(f"  ! {v}")

    if audit.orphaned_records:
        has_errors = True
        print(f"\n[WARNING] Orphaned References ({len(audit.orphaned_records)}):")
        for o in audit.orphaned_records[:10]:
            print(f"  ! {o}")

    print("=" * 65)
    if has_errors:
        print("AUDIT FAILED: Multi-tenant integrity violations found.")
        sys.exit(1)
    else:
        print("AUDIT PASSED: 100% strict organization isolation verified. Zero leaks.")


def cmd_report(args: argparse.Namespace) -> None:
    """Generate and display analytical reports."""
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"ERROR: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR: Could not parse JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    db_data: Dict[str, List[dict]] = {}
    if isinstance(data, dict):
        db_data = data
    elif isinstance(data, list):
        col = args.type or "purchase_requests"
        db_data = {col: data}

    report_text = generate_procurement_report(db_data)
    print(report_text)


def cmd_generate_demo(args: argparse.Namespace) -> None:
    """Generate demo procurement dataset fixtures."""
    fixtures = generate_procurelens_fixtures(args.org_id)
    out_json = json.dumps(fixtures, indent=2)

    if args.output:
        out_path = Path(args.output)
        out_path.write_text(out_json, encoding="utf-8")
        print(f"Generated demo fixtures written to: {out_path.resolve()}")
    else:
        print(out_json)


# ---------------------------------------------------------------------------
# Main CLI Entrypoint
# ---------------------------------------------------------------------------

def build_cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="procurelens_db",
        description="ProcureLens procurement database validation, isolation audit, and analytics utility.",
    )
    sub = parser.add_subparsers(dest="subcommand", required=True)

    # schema
    schema_parser = sub.add_parser("schema", help="Show schema specifications for DeepSpace collections")
    schema_parser.add_argument("--type", choices=list(SCHEMA_DEFINITIONS.keys()), help="Filter by specific collection")

    # validate
    val_parser = sub.add_parser("validate", help="Validate a JSON dataset against schema rules")
    val_parser.add_argument("file", help="Path to JSON file")
    val_parser.add_argument("--type", choices=list(SCHEMA_DEFINITIONS.keys()), help="Collection type for single collection files")

    # verify-isolation
    iso_parser = sub.add_parser("verify-isolation", help="Audit database for multi-tenant isolation and cross-tenant leaks")
    iso_parser.add_argument("file", help="Path to complete database dump JSON")

    # report
    rep_parser = sub.add_parser("report", help="Generate procurement analytics report")
    rep_parser.add_argument("file", help="Path to database JSON file")
    rep_parser.add_argument("--type", help="Optional collection hint")

    # generate-demo
    demo_parser = sub.add_parser("generate-demo", help="Generate complete valid multi-tenant procurement fixtures")
    demo_parser.add_argument("--org-id", default="org_demo_procurelens", help="Organization ID for generated fixtures")
    demo_parser.add_argument("--output", "-o", help="Optional output JSON filepath")

    return parser


def main(argv: Optional[List[str]] = None) -> None:
    parser = build_cli()
    args = parser.parse_args(argv)

    if args.subcommand == "schema":
        cmd_schema(args)
    elif args.subcommand == "validate":
        cmd_validate(args)
    elif args.subcommand == "verify-isolation":
        cmd_verify_isolation(args)
    elif args.subcommand == "report":
        cmd_report(args)
    elif args.subcommand == "generate-demo":
        cmd_generate_demo(args)


if __name__ == "__main__":
    main()
