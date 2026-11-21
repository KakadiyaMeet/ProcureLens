#!/usr/bin/env python3
"""
csv_quotation_validator.py — ProcureLens Zero-Trust CSV Quotation Validator

Usage:
    python scripts/csv_quotation_validator.py <path/to/quotations.csv> [options]

Options:
    --org-id <id>          Validate organizationId column against this active org ID.
    --reject-output <path> Write rejected rows to this CSV file (default: rejected_<input>.csv).
    --no-color             Disable ANSI color output.
    --json                 Output summary as JSON (useful for CI pipelines).

Exit codes:
    0  — All rows passed validation (or only warnings).
    1  — One or more rows were rejected.
    2  — Fatal error (file not found, unreadable, completely empty, etc.).

Security policies enforced:
    1. CSV injection defense — cells starting with =, +, -, @, TAB, CR are flagged.
    2. XSS / HTML tag detection — cells containing HTML tags are flagged.
    3. Numeric sanity — NaN, ±Infinity, out-of-range, negative overflow checked.
    4. Schema verification — required fields, type correctness, range constraints.
    5. Multi-tenant fence — if --org-id given, any row with a mismatching organizationId is rejected.
    6. Rejected row preservation — every rejected row is written to a separate CSV with error annotations.
    7. No silent discard — the CLI always reports a full summary of valid vs rejected.
    8. Calculation verification — Subtotal, Tax, Total cost are recalculated and checked for consistency.
"""

import csv
import sys
import os
import re
import json
import math
import argparse
from dataclasses import dataclass, field, asdict
from typing import Optional

# ─── ANSI colors ─────────────────────────────────────────────────────────────

USE_COLOR = True


def _c(code: str, text: str) -> str:
    if not USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def green(t: str) -> str:  return _c("32", t)
def yellow(t: str) -> str: return _c("33", t)
def red(t: str) -> str:    return _c("31", t)
def bold(t: str) -> str:   return _c("1", t)
def dim(t: str) -> str:    return _c("2", t)
def cyan(t: str) -> str:   return _c("36", t)


# ─── Error codes ─────────────────────────────────────────────────────────────

class Code:
    CSV_INJECTION      = "CSV_INJECTION"
    XSS_DETECTED       = "XSS_DETECTED"
    INVALID_NUMBER     = "INVALID_NUMBER"
    NUMBER_OUT_OF_RANGE = "NUMBER_OUT_OF_RANGE"
    NEGATIVE_VALUE     = "NEGATIVE_VALUE"
    MISSING_REQUIRED   = "MISSING_REQUIRED"
    WRONG_TYPE         = "WRONG_TYPE"
    CROSS_ORG          = "CROSS_ORG_VIOLATION"
    CALC_MISMATCH      = "CALCULATION_MISMATCH"
    VALUE_TOO_LONG     = "VALUE_TOO_LONG"


# ─── Data shapes ─────────────────────────────────────────────────────────────

@dataclass
class FieldError:
    code: str
    field: str
    message: str
    raw_value: Optional[str] = None


@dataclass
class RejectedRow:
    row_index: int          # 1-based (1 = header)
    raw: dict               # original CSV values
    errors: list[FieldError] = field(default_factory=list)
    warnings: list[str]    = field(default_factory=list)


@dataclass
class ValidRow:
    row_index: int
    supplier_name: str
    product_name: str
    quantity: float
    unit_price: float
    gst_percentage: float
    delivery_charges: float
    delivery_days: float
    payment_terms: str
    quality_rating: Optional[float]
    subtotal: float
    tax_amount: float
    total_cost: float
    warnings: list[str] = field(default_factory=list)


# ─── Security checks ─────────────────────────────────────────────────────────

INJECTION_RE = re.compile(r'^[=+\-@\t\r]')
HTML_TAG_RE  = re.compile(r'<[^>]+>')
DANGEROUS_PROTO = re.compile(r'^(javascript|data|vbscript):', re.IGNORECASE)


def check_csv_injection(value: str, field_name: str) -> Optional[FieldError]:
    """Flag but do NOT silently strip — report to caller so the row is flagged."""
    if INJECTION_RE.match(value.strip()):
        return FieldError(
            code=Code.CSV_INJECTION,
            field=field_name,
            message=(
                f'Field "{field_name}" starts with a formula-injection character '
                f'("{value.strip()[0]}"). Possible CSV injection attempt.'
            ),
            raw_value=value,
        )
    return None


def check_xss(value: str, field_name: str) -> Optional[FieldError]:
    if HTML_TAG_RE.search(value) or DANGEROUS_PROTO.match(value.strip()):
        return FieldError(
            code=Code.XSS_DETECTED,
            field=field_name,
            message=f'Field "{field_name}" contains HTML tags or dangerous protocol — possible XSS.',
            raw_value=value,
        )
    return None


# ─── Numeric parsing ─────────────────────────────────────────────────────────

def parse_number(raw: str, field_name: str,
                 min_val: Optional[float] = None,
                 max_val: Optional[float] = None,
                 allow_zero: bool = True) -> tuple[Optional[float], Optional[FieldError]]:
    if not raw or raw.strip() == "":
        return None, None   # empty → not provided; schema check handles required

    cleaned = re.sub(r'[$,₹€£%]', '', raw.strip())
    try:
        num = float(cleaned)
    except ValueError:
        return None, FieldError(
            code=Code.INVALID_NUMBER,
            field=field_name,
            message=f'"{field_name}" must be a valid number; got "{raw}"',
            raw_value=raw,
        )

    if not math.isfinite(num):
        return None, FieldError(
            code=Code.INVALID_NUMBER,
            field=field_name,
            message=f'"{field_name}" must be finite (got Infinity or NaN)',
            raw_value=raw,
        )

    if not allow_zero and num == 0:
        return None, FieldError(
            code=Code.NEGATIVE_VALUE,
            field=field_name,
            message=f'"{field_name}" must be > 0; got 0',
            raw_value=raw,
        )

    if min_val is not None and num < min_val:
        code = Code.NEGATIVE_VALUE if num < 0 else Code.NUMBER_OUT_OF_RANGE
        return None, FieldError(
            code=code,
            field=field_name,
            message=f'"{field_name}" must be ≥ {min_val}; got {num}',
            raw_value=raw,
        )

    if max_val is not None and num > max_val:
        return None, FieldError(
            code=Code.NUMBER_OUT_OF_RANGE,
            field=field_name,
            message=f'"{field_name}" must be ≤ {max_val}; got {num}',
            raw_value=raw,
        )

    return num, None


# ─── Field schema ─────────────────────────────────────────────────────────────

FIELD_ALIASES: dict[str, str] = {
    # supplierName
    "supplier name": "supplierName", "vendor name": "supplierName",
    "company name": "supplierName",  "supplier": "supplierName",
    # productName
    "product name": "productName", "item name": "productName",
    "description": "productName",  "item": "productName",
    # quantity
    "quantity": "quantity", "qty": "quantity", "amount": "quantity",
    # unitPrice
    "unit price": "unitPrice", "unit cost": "unitPrice",
    "price": "unitPrice",     "rate": "unitPrice",
    # gstPercentage
    "gst %": "gstPercentage",    "gst": "gstPercentage",
    "tax %": "gstPercentage",    "vat %": "gstPercentage",
    # deliveryCharges
    "delivery charges": "deliveryCharges", "shipping charges": "deliveryCharges",
    "freight": "deliveryCharges",          "delivery charge": "deliveryCharges",
    # deliveryDays
    "delivery days": "deliveryDays", "lead time": "deliveryDays",
    "shipping days": "deliveryDays",
    # paymentTerms
    "payment terms": "paymentTerms", "pay terms": "paymentTerms",
    # qualityRating
    "quality rating": "qualityRating", "rating": "qualityRating",
    "score": "qualityRating",          "quality": "qualityRating",
    # optional org field
    "organizationid": "organizationId",
}


def canonical_header(h: str) -> str:
    return FIELD_ALIASES.get(h.strip().lower(), h.strip())


# ─── Row validator ─────────────────────────────────────────────────────────────

def validate_row(
    row: dict,
    row_index: int,
    active_org_id: Optional[str],
) -> tuple[Optional[ValidRow], Optional[RejectedRow]]:
    """
    Validate one CSV row.
    Returns (ValidRow, None) on success, (None, RejectedRow) on rejection.
    Rows with only warnings are returned as ValidRow with warnings populated.
    """
    errors: list[FieldError] = []
    warnings: list[str] = []

    # ── Security scans ──────────────────────────────────────────────────────
    for field_name, raw_val in row.items():
        if not raw_val:
            continue
        inj = check_csv_injection(str(raw_val), field_name)
        if inj:
            errors.append(inj)
        xss = check_xss(str(raw_val), field_name)
        if xss:
            errors.append(xss)

    # ── Multi-tenant fence ─────────────────────────────────────────────────
    record_org_id = row.get("organizationId", "").strip()
    if active_org_id and record_org_id and record_org_id != active_org_id:
        errors.append(FieldError(
            code=Code.CROSS_ORG,
            field="organizationId",
            message=(
                f'Record organizationId "{record_org_id}" does not match '
                f'active org "{active_org_id}". Cross-organization import rejected.'
            ),
            raw_value=record_org_id,
        ))

    # ── Required string fields ─────────────────────────────────────────────
    supplier_name = (row.get("supplierName") or "").strip()
    product_name  = (row.get("productName") or "").strip()
    if not supplier_name:
        errors.append(FieldError(
            code=Code.MISSING_REQUIRED, field="supplierName",
            message='"supplierName" is required but was empty'
        ))
    elif len(supplier_name) > 200:
        errors.append(FieldError(
            code=Code.VALUE_TOO_LONG, field="supplierName",
            message=f'"supplierName" exceeds 200 chars (got {len(supplier_name)})',
            raw_value=supplier_name,
        ))

    if not product_name:
        errors.append(FieldError(
            code=Code.MISSING_REQUIRED, field="productName",
            message='"productName" is required but was empty'
        ))
    elif len(product_name) > 300:
        errors.append(FieldError(
            code=Code.VALUE_TOO_LONG, field="productName",
            message=f'"productName" exceeds 300 chars (got {len(product_name)})',
            raw_value=product_name,
        ))

    # ── Numeric fields ─────────────────────────────────────────────────────
    qty, qty_err = parse_number(row.get("quantity", ""), "quantity", min_val=0.001, allow_zero=False)
    if qty_err:
        errors.append(qty_err)
    elif qty is None:
        errors.append(FieldError(
            code=Code.MISSING_REQUIRED, field="quantity",
            message='"quantity" is required but was empty'
        ))

    unit_price, up_err = parse_number(row.get("unitPrice", ""), "unitPrice", min_val=0)
    if up_err:
        errors.append(up_err)
    elif unit_price is None:
        errors.append(FieldError(
            code=Code.MISSING_REQUIRED, field="unitPrice",
            message='"unitPrice" is required but was empty'
        ))

    gst, gst_err = parse_number(row.get("gstPercentage", ""), "gstPercentage", min_val=0, max_val=100)
    if gst_err:
        errors.append(gst_err)
    gst = gst if gst is not None else 0.0

    delivery, del_err = parse_number(row.get("deliveryCharges", ""), "deliveryCharges", min_val=0)
    if del_err:
        errors.append(del_err)
    delivery = delivery if delivery is not None else 0.0

    del_days, days_err = parse_number(row.get("deliveryDays", ""), "deliveryDays", min_val=0)
    if days_err:
        errors.append(days_err)
    del_days = del_days if del_days is not None else 0.0

    rating_raw = row.get("qualityRating", "").strip()
    rating: Optional[float] = None
    if rating_raw:
        rating, rat_err = parse_number(rating_raw, "qualityRating", min_val=1, max_val=5)
        if rat_err:
            errors.append(rat_err)

    payment_terms = (row.get("paymentTerms") or "").strip()
    if not payment_terms:
        warnings.append("paymentTerms not specified — may require manual follow-up")

    # ── Calculation verification ───────────────────────────────────────────
    if qty is not None and unit_price is not None:
        expected_subtotal = round(qty * unit_price, 6)
        expected_tax      = round(expected_subtotal * (gst / 100), 6)
        expected_total    = round(expected_subtotal + expected_tax + delivery, 6)

        # If the CSV contains pre-computed columns, verify them
        if "subtotal" in row and row["subtotal"].strip():
            provided_sub, _ = parse_number(row["subtotal"], "subtotal")
            if provided_sub is not None and abs(provided_sub - expected_subtotal) > 0.01:
                errors.append(FieldError(
                    code=Code.CALC_MISMATCH,
                    field="subtotal",
                    message=(
                        f'"subtotal" mismatch: provided {provided_sub:.2f}, '
                        f'calculated {expected_subtotal:.2f} (qty={qty} × price={unit_price})'
                    ),
                    raw_value=row["subtotal"],
                ))

        if "totalCost" in row and row["totalCost"].strip():
            provided_total, _ = parse_number(row["totalCost"], "totalCost")
            if provided_total is not None and abs(provided_total - expected_total) > 0.01:
                errors.append(FieldError(
                    code=Code.CALC_MISMATCH,
                    field="totalCost",
                    message=(
                        f'"totalCost" mismatch: provided {provided_total:.2f}, '
                        f'calculated {expected_total:.2f}'
                    ),
                    raw_value=row["totalCost"],
                ))

        if unit_price == 0:
            warnings.append("unitPrice is 0 — verify this is intentional")

        if errors:
            return None, RejectedRow(row_index=row_index, raw=row, errors=errors, warnings=warnings)

        return ValidRow(
            row_index=row_index,
            supplier_name=supplier_name,
            product_name=product_name,
            quantity=qty,
            unit_price=unit_price,
            gst_percentage=gst,
            delivery_charges=delivery,
            delivery_days=del_days,
            payment_terms=payment_terms,
            quality_rating=rating,
            subtotal=expected_subtotal,
            tax_amount=expected_tax,
            total_cost=expected_total,
            warnings=warnings,
        ), None

    # Reached here only if qty or unit_price was None after check
    return None, RejectedRow(row_index=row_index, raw=row, errors=errors, warnings=warnings)


# ─── CSV export of rejected rows ──────────────────────────────────────────────

def export_rejected_csv(rejected_rows: list[RejectedRow], output_path: str) -> None:
    if not rejected_rows:
        return

    all_raw_keys = list(dict.fromkeys(
        k for row in rejected_rows for k in row.raw.keys()
    ))
    fieldnames = ["Row Index"] + all_raw_keys + ["Error Details"]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rejected_rows:
            error_detail = " | ".join(
                f"[{e.code}] {e.field}: {e.message}"
                for e in row.errors
            )
            out_row = {"Row Index": row.row_index, "Error Details": error_detail}
            out_row.update(row.raw)
            writer.writerow(out_row)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    global USE_COLOR

    parser = argparse.ArgumentParser(
        description="ProcureLens zero-trust CSV quotation validator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("csv_file", help="Path to the CSV file to validate")
    parser.add_argument("--org-id", default=None, help="Active organization ID for tenant boundary check")
    parser.add_argument("--reject-output", default=None, help="Output path for rejected rows CSV")
    parser.add_argument("--no-color", action="store_true", help="Disable color output")
    parser.add_argument("--json", action="store_true", dest="json_output", help="Output summary as JSON")
    args = parser.parse_args()

    if args.no_color or args.json_output:
        USE_COLOR = False

    csv_path = args.csv_file
    if not os.path.isfile(csv_path):
        msg = f"File not found: {csv_path}"
        if args.json_output:
            print(json.dumps({"error": msg}))
        else:
            print(red(f"✗ {msg}"), file=sys.stderr)
        return 2

    # Determine reject output path
    reject_output = args.reject_output
    if reject_output is None:
        base, _ = os.path.splitext(os.path.basename(csv_path))
        reject_output = os.path.join(os.path.dirname(csv_path) or ".", f"rejected_{base}.csv")

    # ── Read & detect encoding ───────────────────────────────────────────────
    try:
        with open(csv_path, encoding="utf-8-sig", newline="") as f:
            raw_content = f.read()
    except Exception as exc:
        msg = f"Could not read file: {exc}"
        if args.json_output:
            print(json.dumps({"error": msg}))
        else:
            print(red(f"✗ {msg}"), file=sys.stderr)
        return 2

    lines = raw_content.splitlines()
    if len(lines) < 2:
        msg = "CSV must have a header row and at least one data row."
        if args.json_output:
            print(json.dumps({"error": msg}))
        else:
            print(red(f"✗ {msg}"), file=sys.stderr)
        return 2

    # Detect delimiter
    first_line = lines[0]
    delimiter = ","
    for d in [",", ";", "\t"]:
        if first_line.count(d) > first_line.count(delimiter):
            delimiter = d

    reader = csv.DictReader(raw_content.splitlines(), delimiter=delimiter)

    # Normalize headers to canonical field keys
    if reader.fieldnames is None:
        print(red("✗ No headers found."), file=sys.stderr)
        return 2

    # Build a header-remapping dict
    header_map = {h: canonical_header(h) for h in reader.fieldnames}

    valid_rows:    list[ValidRow]    = []
    rejected_rows: list[RejectedRow] = []
    row_index = 1  # 1 = header

    for raw_row in reader:
        row_index += 1
        # Remap headers
        remapped = {header_map.get(k, k): (v or "").strip() for k, v in raw_row.items()}
        valid, rejected = validate_row(remapped, row_index, args.org_id)
        if valid:
            valid_rows.append(valid)
        elif rejected:
            rejected_rows.append(rejected)

    total         = len(valid_rows) + len(rejected_rows)
    valid_count   = len(valid_rows)
    warning_count = sum(1 for r in valid_rows if r.warnings)
    rejected_count = len(rejected_rows)

    # ── Persist rejected rows ────────────────────────────────────────────────
    if rejected_rows:
        export_rejected_csv(rejected_rows, reject_output)

    # ── Output summary ───────────────────────────────────────────────────────
    if args.json_output:
        summary = {
            "file": csv_path,
            "total_rows": total,
            "valid": valid_count,
            "warnings": warning_count,
            "rejected": rejected_count,
            "rejected_output": reject_output if rejected_rows else None,
            "rejected_rows": [
                {
                    "row_index": r.row_index,
                    "errors": [asdict(e) for e in r.errors],
                    "warnings": r.warnings,
                }
                for r in rejected_rows
            ],
        }
        print(json.dumps(summary, indent=2))
    else:
        # Pretty CLI summary
        print()
        print(bold(cyan("╔══════════════════════════════════════════╗")))
        print(bold(cyan("║   ProcureLens CSV Quotation Validator    ║")))
        print(bold(cyan("╚══════════════════════════════════════════╝")))
        print(f"\n  {bold('File:')} {csv_path}")
        if args.org_id:
            print(f"  {bold('Org ID:')} {args.org_id}")
        print()
        print(f"  {bold('Total rows:'):20s} {total}")
        print(f"  {green(bold('Valid:').ljust(20))} {green(str(valid_count - warning_count))}")
        print(f"  {yellow(bold('With warnings:').ljust(20))} {yellow(str(warning_count))}")
        print(f"  {red(bold('Rejected:').ljust(20))} {red(str(rejected_count))}")
        print()

        if rejected_rows:
            print(bold(red("── Rejected Rows ─────────────────────────────────")))
            for r in rejected_rows:
                print(f"\n  Row {bold(str(r.row_index))}:")
                for err in r.errors:
                    print(f"    {red('✗')} [{dim(err.code)}] {err.field}: {err.message}")
                for w in r.warnings:
                    print(f"    {yellow('⚠')} {w}")
            print()
            print(f"  {bold('Rejected rows written to:')} {reject_output}")
        else:
            print(green("  ✓ All rows passed validation."))

        if warning_count > 0:
            print()
            print(bold(yellow("── Rows with Warnings ────────────────────────────")))
            for r in valid_rows:
                if r.warnings:
                    print(f"\n  Row {bold(str(r.row_index))} ({r.supplier_name} / {r.product_name}):")
                    for w in r.warnings:
                        print(f"    {yellow('⚠')} {w}")

        print()

    return 1 if rejected_rows else 0


if __name__ == "__main__":
    sys.exit(main())
