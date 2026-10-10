"""
Parse PTCC's NABL scope annexures and accreditation certificates into the controlled
reference file used by the application (data/scope/ptcc-nabl-scope.json).

    python -I parse_scope.py <scope.pdf> <certificates.pdf> <out.json>

What this does — and deliberately does not do:
  * Extracts every row of every scope table exactly as printed (ruled tables, read with
    pdfplumber's line strategy). Visual line breaks inside a cell become single spaces.
  * Expands typographic ligatures (fi, ff, ffl, fl) and repairs one known mojibake
    sequence (double-encoded quotation marks). Units and symbols (µ, °, ±, ½, ²) are kept.
  * Keeps the raw cell text and the PDF page of every row, so each catalogue entry can be
    traced back to the source document.
  * Does NOT interpret, merge, rename or "correct" scope content. Normalisation of
    discipline/group names happens in the application importer, which fails loudly on
    anything it does not recognise.

See docs/SERVICE_CATALOGUE.md.
"""

import datetime
import hashlib
import json
import re
import sys

import pdfplumber

PARSER_VERSION = "1"

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl"}
# Seen once in the source (page 70): UTF-8 quotation marks decoded as Windows-1252.
MOJIBAKE = {"â€œ": "“", "â€\u009d": "”", "â€": "”"}


def clean(text):
    if text is None:
        return None
    for bad, good in MOJIBAKE.items():
        text = text.replace(bad, good)
    for lig, rep in LIGATURES.items():
        text = text.replace(lig, rep)
    return text


def joined(cell):
    if cell is None:
        return ""
    return re.sub(r"\s+", " ", clean(cell).replace("\n", " ")).strip()


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iso(date_text):
    """dd/mm/yyyy -> yyyy-mm-dd"""
    if not date_text:
        return None
    day, month, year = date_text.split("/")
    return f"{year}-{month}-{day}"


def parse_certificates(path):
    certificates = []
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            text = clean(page.extract_text() or "")
            flat = re.sub(r"\s+", " ", text)
            number = re.search(r"Certificate Number:?\s*(CC-\d+)", flat)
            issue = re.search(r"Issue Date:?\s*(\d{2}/\d{2}/\d{4})", flat)
            valid = re.search(r"Valid Until:?\s*(\d{2}/\d{2}/\d{4})", flat)
            standard = re.search(r"(ISO/IEC 17025:\d{4})", flat)
            field = re.search(r"in the field of\s+([A-Z ]+?)\s+Certificate Number", flat)
            facility = re.search(r"for its facilities at\s+(.+?)\s+in the field of", flat)
            entity = re.search(r"Name of Legal Entity:\s*(.+?)\s+Signed for", flat)
            if not number:
                raise SystemExit(f"certificates page {pno}: no certificate number found")
            certificates.append(
                {
                    "certificateNumber": number.group(1),
                    "accreditationBody": "NABL",
                    "standard": standard.group(1) if standard else None,
                    "field": field.group(1).strip().title() if field else None,
                    "legalEntity": entity.group(1).strip() if entity else None,
                    "facilityAddress": facility.group(1).strip() if facility else None,
                    "issueDate": iso(issue.group(1)) if issue else None,
                    "validUntil": iso(valid.group(1)) if valid else None,
                    "certificatePdfPage": pno,
                }
            )
    return certificates


def parse_scope(path):
    annexures = {}
    entries = []
    anomalies = []
    facility = None
    current = None
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            text = clean(page.extract_text() or "")
            cert = re.search(r"\b(CC-\d{3,5})\b", text)
            page_of = re.search(r"Page No\s*(\d+)\s*of\s*(\d+)", text)
            validity = re.search(r"(\d{2}/\d{2}/\d{4})\s*to\s*(\d{2}/\d{2}/\d{4})", text)
            amended = re.search(r"Last Amended on\s*(\d{2}/\d{2}/\d{4})", text)
            if not cert:
                anomalies.append({"pdfPage": pno, "issue": "no certificate number on page"})
                continue
            number = cert.group(1)
            if number != current:
                current = number
                facility = None
            annexure = annexures.setdefault(
                number,
                {
                    "certificateNumber": number,
                    "validFrom": iso(validity.group(1)) if validity else None,
                    "validUntil": iso(validity.group(2)) if validity else None,
                    "lastAmendedOn": iso(amended.group(1)) if amended else None,
                    "declaredPages": int(page_of.group(2)) if page_of else None,
                    "pdfPages": [],
                },
            )
            annexure["pdfPages"].append(pno)
            tables = page.extract_tables({"vertical_strategy": "lines", "horizontal_strategy": "lines"})
            if len(tables) != 1:
                anomalies.append({"pdfPage": pno, "issue": f"{len(tables)} tables on page"})
            for table in tables:
                for row in table:
                    cells = list(row) + [None] * (6 - len(row))
                    first = joined(cells[0])
                    if first.startswith("S.No"):
                        continue
                    rest = [joined(c) for c in cells[1:6]]
                    if first and not any(rest):
                        heading = re.match(r"^(Permanent|Site|Mobile)\s+Facility$", first, re.I)
                        if heading:
                            facility = heading.group(1).lower()
                        else:
                            anomalies.append({"pdfPage": pno, "issue": "unrecognised full-width row", "text": first})
                        continue
                    problems = []
                    if len(row) != 6:
                        problems.append(f"{len(row)} cells")
                    if not first:
                        problems.append("no serial number")
                    if facility is None:
                        problems.append("before any facility heading")
                    if not all(rest):
                        problems.append("empty cell")
                    if problems:
                        anomalies.append({"pdfPage": pno, "issue": ", ".join(problems), "cells": [first] + rest})
                    entries.append(
                        {
                            "certificateNumber": number,
                            "facilityType": facility,
                            "serialNumber": first,
                            "disciplineGroup": rest[0],
                            "measurandOrInstrument": rest[1],
                            "method": rest[2],
                            "range": rest[3],
                            "cmc": rest[4],
                            "pdfPage": pno,
                            "annexurePage": int(page_of.group(1)) if page_of else None,
                            "raw": [clean(c) if c is not None else None for c in cells[:6]],
                        }
                    )
    for annexure in annexures.values():
        if annexure["declaredPages"] != len(annexure["pdfPages"]):
            anomalies.append(
                {"certificate": annexure["certificateNumber"], "issue": "page count differs from 'Page n of N'"}
            )
    return list(annexures.values()), entries, anomalies


def main():
    scope_path, certificates_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    certificates = parse_certificates(certificates_path)
    annexures, entries, anomalies = parse_scope(scope_path)
    by_number = {c["certificateNumber"]: c for c in certificates}
    accreditations = []
    for annexure in annexures:
        certificate = by_number.get(annexure["certificateNumber"])
        if not certificate:
            anomalies.append({"certificate": annexure["certificateNumber"], "issue": "scope annexure without certificate"})
            certificate = {}
        accreditations.append({**certificate, **annexure})
    for number in by_number:
        if number not in {a["certificateNumber"] for a in annexures}:
            anomalies.append({"certificate": number, "issue": "certificate without scope annexure"})

    result = {
        "format": "ptcc-scope/v1",
        "generator": f"tools/scope-parser/parse_scope.py v{PARSER_VERSION}",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "sources": [
            {"kind": "scope", "fileName": scope_path.replace("\\", "/").split("/")[-1], "sha256": sha256(scope_path)},
            {"kind": "certificates", "fileName": certificates_path.replace("\\", "/").split("/")[-1], "sha256": sha256(certificates_path)},
        ],
        "accreditations": accreditations,
        "entries": entries,
        "anomalies": anomalies,
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"accreditations: {len(accreditations)}  entries: {len(entries)}  anomalies: {len(anomalies)}")
    for anomaly in anomalies:
        print("  anomaly:", anomaly)


if __name__ == "__main__":
    main()
