"""
patient_lookup.py — loads patient CSV and searches by name/DOB.
Uses built-in csv module instead of pandas to avoid numpy dependency.
"""
import csv
from pathlib import Path

_patients: list[dict] = []


def load_patients() -> list[dict]:
    global _patients
    if _patients:
        return _patients

    for path in [
        Path(__file__).parent.parent / "data" / "patients_enriched.csv",
        Path("backend/data/patients_enriched.csv"),
        Path("data/patients_enriched.csv"),
    ]:
        if path.exists():
            with open(path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                _patients = [{k: (v or "") for k, v in row.items()} for row in reader]
            print(f"[patient_lookup] Loaded {len(_patients)} patients from {path}")
            return _patients

    print("[patient_lookup] WARNING: patients_enriched.csv not found")
    return []


def search_patient(name: str = "", dob: str = "") -> dict | None:
    patients = load_patients()
    name_lower = name.strip().lower()
    dob_clean  = dob.strip()

    for p in patients:
        name_match = name_lower in p.get("name", "").lower()
        dob_match  = dob_clean == p.get("dob", "").strip()
        if name_match and dob_match:
            return p

    return None