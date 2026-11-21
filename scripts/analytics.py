"""
ProcureLens Analytics & Data Validation Utilities
==================================================

Procurement analytics and data validation utilities for ProcureLens.
Used for offline analysis, data export validation, and reporting.

Usage:
    python scripts/analytics.py --help
    python scripts/analytics.py validate suppliers.json
    python scripts/analytics.py report purchase_requests.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Data validation
# ---------------------------------------------------------------------------

class ValidationError(Exception):
    """Raised when a record fails validation."""


def _assert_field(record: dict, field: str, expected_type: type, required: bool = True) -> None:
    if field not in record:
        if required:
            raise ValidationError(f"Missing required field '{field}'")
        return
    value = record[field]
    if value is None and not required:
        return
    if not isinstance(value, expected_type):
        raise ValidationError(
            f"Field '{field}' expected {expected_type.__name__}, got {type(value).__name__}"
        )


def validate_supplier(record: dict) -> list[str]:
    """
    Validate a supplier record against the ProcureLens schema.

    Returns a list of error strings (empty = valid).
    """
    errors: list[str] = []

    required_strings = ["name", "email", "organizationId"]
    for field in required_strings:
        try:
            _assert_field(record, field, str)
            if not record[field].strip():
                errors.append(f"Field '{field}' must not be empty")
        except ValidationError as exc:
            errors.append(str(exc))

    # Email format
    if "email" in record and isinstance(record["email"], str):
        import re
        if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", record["email"]):
            errors.append(f"Field 'email' has an invalid format: {record['email']!r}")

    # Optional numeric rating 0-5
    if "rating" in record and record["rating"] is not None:
        try:
            rating = float(record["rating"])
            if not (0 <= rating <= 5):
                errors.append(f"Field 'rating' must be between 0 and 5, got {rating}")
        except (TypeError, ValueError):
            errors.append(f"Field 'rating' must be numeric, got {record['rating']!r}")

    # Status enum
    valid_statuses = {"active", "inactive", "blacklisted"}
    if "status" in record and record["status"] not in valid_statuses:
        errors.append(f"Field 'status' must be one of {valid_statuses}, got {record['status']!r}")

    return errors


def validate_purchase_request(record: dict) -> list[str]:
    """
    Validate a purchase request record against the ProcureLens schema.

    Returns a list of error strings (empty = valid).
    """
    errors: list[str] = []

    required_strings = ["title", "description", "organizationId"]
    for field in required_strings:
        try:
            _assert_field(record, field, str)
            if not record[field].strip():
                errors.append(f"Field '{field}' must not be empty")
        except ValidationError as exc:
            errors.append(str(exc))

    # quantity > 0
    if "quantity" in record and record["quantity"] is not None:
        try:
            qty = float(record["quantity"])
            if qty <= 0:
                errors.append(f"Field 'quantity' must be positive, got {qty}")
        except (TypeError, ValueError):
            errors.append(f"Field 'quantity' must be numeric")

    # estimatedBudget >= 0
    if "estimatedBudget" in record and record["estimatedBudget"] is not None:
        try:
            budget = float(record["estimatedBudget"])
            if budget < 0:
                errors.append(f"Field 'estimatedBudget' must not be negative, got {budget}")
        except (TypeError, ValueError):
            errors.append(f"Field 'estimatedBudget' must be numeric")

    # requiredByDate ISO-8601 date
    if "requiredByDate" in record and record["requiredByDate"]:
        try:
            datetime.fromisoformat(record["requiredByDate"])
        except ValueError:
            errors.append(
                f"Field 'requiredByDate' is not a valid ISO-8601 date: {record['requiredByDate']!r}"
            )

    valid_statuses = {"draft", "pending", "approved", "in_progress", "completed", "cancelled"}
    if "status" in record and record["status"] not in valid_statuses:
        errors.append(f"Field 'status' must be one of {valid_statuses}, got {record['status']!r}")

    valid_priorities = {"low", "medium", "high", "urgent"}
    if "priority" in record and record["priority"] not in valid_priorities:
        errors.append(
            f"Field 'priority' must be one of {valid_priorities}, got {record['priority']!r}"
        )

    return errors


def validate_file(path: Path, record_type: str) -> None:
    """Validate all records in a JSON export file and print a summary."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: Could not parse JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    records: list[dict] = data if isinstance(data, list) else data.get("records", [])
    if not records:
        print("No records found in file.")
        return

    validators = {
        "suppliers": validate_supplier,
        "purchase_requests": validate_purchase_request,
    }
    validator = validators.get(record_type)
    if validator is None:
        print(f"ERROR: Unknown record type '{record_type}'. Choose from: {list(validators)}")
        sys.exit(1)

    total = len(records)
    fail_count = 0
    for i, record in enumerate(records):
        errors = validator(record)
        if errors:
            fail_count += 1
            rid = record.get("recordId", record.get("id", f"index-{i}"))
            print(f"  FAIL [{rid}]:")
            for err in errors:
                print(f"    • {err}")

    ok_count = total - fail_count
    status = "✓ All valid" if fail_count == 0 else f"✗ {fail_count} invalid"
    print(f"\n{status}  |  {ok_count}/{total} records passed validation")
    if fail_count > 0:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Procurement analytics / reporting
# ---------------------------------------------------------------------------

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def report_purchase_requests(records: list[dict]) -> None:
    """Print an analytics summary for purchase request records."""

    total = len(records)
    if total == 0:
        print("No purchase requests to analyse.")
        return

    # Status breakdown
    status_counts: dict[str, int] = {}
    priority_counts: dict[str, int] = {}
    total_budget = 0.0
    approved_budget = 0.0

    for r in records:
        status = r.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1

        priority = r.get("priority", "unknown")
        priority_counts[priority] = priority_counts.get(priority, 0) + 1

        budget = _safe_float(r.get("estimatedBudget"))
        total_budget += budget
        if status in {"approved", "in_progress", "completed"}:
            approved_budget += budget

    # Approval rate
    terminal = sum(status_counts.get(s, 0) for s in ("approved", "completed", "cancelled"))
    pending_or_draft = sum(status_counts.get(s, 0) for s in ("draft", "pending"))
    approval_rate = (
        status_counts.get("approved", 0) / terminal * 100 if terminal > 0 else 0.0
    )

    print("=" * 55)
    print("  ProcureLens — Purchase Request Analytics Report")
    print(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 55)

    print(f"\n  Total requests : {total}")
    print(f"  Open (draft/pending) : {pending_or_draft}")
    print(f"  Reached terminal state : {terminal}")
    print(f"  Approval rate  : {approval_rate:.1f}%")

    print("\n  Status breakdown:")
    for status, count in sorted(status_counts.items()):
        bar = "█" * int(count / total * 20)
        print(f"    {status:<14} {count:>4}  {bar}")

    print("\n  Priority breakdown:")
    for priority, count in sorted(priority_counts.items()):
        bar = "█" * int(count / total * 20)
        print(f"    {priority:<10} {count:>4}  {bar}")

    print(f"\n  Total estimated budget : ${total_budget:,.2f}")
    print(f"  Budget in approved/active PRs : ${approved_budget:,.2f}")
    print("=" * 55)


def report_suppliers(records: list[dict]) -> None:
    """Print an analytics summary for supplier records."""

    total = len(records)
    if total == 0:
        print("No suppliers to analyse.")
        return

    status_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    ratings = []

    for r in records:
        status = r.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1

        category = r.get("category") or "Uncategorised"
        category_counts[category] = category_counts.get(category, 0) + 1

        rating = r.get("rating")
        if rating is not None:
            ratings.append(_safe_float(rating))

    avg_rating = sum(ratings) / len(ratings) if ratings else 0.0

    print("=" * 55)
    print("  ProcureLens — Supplier Analytics Report")
    print(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 55)

    print(f"\n  Total suppliers : {total}")
    print(f"  Average rating  : {avg_rating:.2f} / 5.00")

    print("\n  Status breakdown:")
    for status, count in sorted(status_counts.items()):
        bar = "█" * int(count / total * 20)
        print(f"    {status:<14} {count:>4}  {bar}")

    print("\n  Top categories:")
    for category, count in sorted(category_counts.items(), key=lambda x: -x[1])[:10]:
        bar = "█" * int(count / total * 20)
        print(f"    {category:<20} {count:>4}  {bar}")

    print("=" * 55)


def report_file(path: Path, record_type: str) -> None:
    """Generate an analytics report from a JSON export file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: Could not parse JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    records: list[dict] = data if isinstance(data, list) else data.get("records", [])

    reporters = {
        "purchase_requests": report_purchase_requests,
        "suppliers": report_suppliers,
    }
    reporter = reporters.get(record_type)
    if reporter is None:
        print(f"ERROR: Unknown record type '{record_type}'. Choose from: {list(reporters)}")
        sys.exit(1)

    reporter(records)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="analytics",
        description="ProcureLens procurement analytics and data validation utilities.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # validate
    val_cmd = sub.add_parser("validate", help="Validate a JSON export file")
    val_cmd.add_argument("file", type=Path, help="Path to the JSON export file")
    val_cmd.add_argument(
        "--type",
        dest="record_type",
        default="purchase_requests",
        choices=["purchase_requests", "suppliers"],
        help="Record type to validate (default: purchase_requests)",
    )

    # report
    rep_cmd = sub.add_parser("report", help="Print an analytics summary from a JSON export file")
    rep_cmd.add_argument("file", type=Path, help="Path to the JSON export file")
    rep_cmd.add_argument(
        "--type",
        dest="record_type",
        default="purchase_requests",
        choices=["purchase_requests", "suppliers"],
        help="Record type to report on (default: purchase_requests)",
    )

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.file.exists():
        print(f"ERROR: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    if args.command == "validate":
        print(f"Validating '{args.file}' as {args.record_type}…\n")
        validate_file(args.file, args.record_type)
    elif args.command == "report":
        report_file(args.file, args.record_type)


if __name__ == "__main__":
    main()
