"""
routes/billing.py — Patient Billing Portal

Standalone billing dashboard. Patients look up their account by name + DOB,
see all outstanding bills, and pay them (mock — no real Stripe calls).

Endpoints:
    GET  /billing/lookup              — find patient bills by name + DOB
    GET  /billing/patient/{patient_id} — list all bills for a patient
    POST /billing/pay                 — mock pay a bill
    GET  /billing/receipt/{bill_id}   — get payment receipt
    POST /billing/bills               — (admin) create a new bill
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from models import SessionLocal, Patient, Bill

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class BillLookupRequest(BaseModel):
    name: str
    dob: str  # MM/DD/YYYY


class PayBillRequest(BaseModel):
    bill_id: str
    patient_id: str
    # Mock payment fields — replace with Stripe PaymentIntent in production
    card_last_four: str = "4242"
    card_brand: str = "Visa"


class CreateBillRequest(BaseModel):
    patient_id: str
    description: str       # e.g. "Copay - Family Medicine", "Lab work", "X-Ray"
    amount: float          # in USD
    due_date: Optional[str] = None  # MM/DD/YYYY, defaults to 30 days out


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _bill_to_dict(bill: "Bill") -> dict:
    return {
        "id":           bill.id,
        "patient_id":   bill.patient_id,
        "description":  bill.description,
        "amount":       bill.amount,
        "status":       bill.status,
        "due_date":     bill.due_date,
        "paid_at":      bill.paid_at.isoformat() if bill.paid_at else None,
        "card_last_four": bill.card_last_four,
        "card_brand":   bill.card_brand,
        "created_at":   bill.created_at.isoformat(),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/lookup")
def lookup_patient_bills(name: str, dob: str):
    """
    Find a patient by name + DOB and return all their bills.
    This is the entry point for the billing portal.
    """
    db = SessionLocal()
    try:
        # Case-insensitive name search
        patients = db.query(Patient).filter(
            Patient.name.ilike(f"%{name.strip()}%"),
            Patient.dob == dob.strip()
        ).all()

        if not patients:
            raise HTTPException(
                status_code=404,
                detail="No patient found with that name and date of birth. "
                       "Please check your details or contact the front desk."
            )

        # Return bills for all matching patient records
        # (same person may have multiple intake rows from different visits)
        all_bills = []
        patient_info = None
        for patient in patients:
            bills = db.query(Bill).filter(
                Bill.patient_id == patient.id
            ).order_by(Bill.created_at.desc()).all()
            all_bills.extend([_bill_to_dict(b) for b in bills])
            if not patient_info:
                patient_info = {
                    "name":       patient.name,
                    "dob":        patient.dob,
                    "patient_id": patient.id,
                }

        # Auto-create a copay bill from the most recent intake if none exist
        # This seeds the portal with real data from the intake flow
        if not all_bills and patients:
            most_recent = patients[0]
            if most_recent.copay and most_recent.copay not in ("", "None", "$0"):
                try:
                    amount = float(
                        str(most_recent.copay)
                        .replace("$", "")
                        .replace(",", "")
                        .strip()
                    )
                except ValueError:
                    amount = 0.0

                if amount > 0:
                    bill = Bill(
                        id=str(uuid.uuid4()),
                        patient_id=most_recent.id,
                        description=f"Copay — {most_recent.department or 'Visit'} "
                                    f"with {most_recent.appointment_doctor or 'your doctor'}",
                        amount=amount,
                        status="outstanding",
                        due_date=_thirty_days_from_now(),
                    )
                    db.add(bill)
                    db.commit()
                    db.refresh(bill)
                    all_bills.append(_bill_to_dict(bill))

        total_outstanding = sum(
            b["amount"] for b in all_bills if b["status"] == "outstanding"
        )

        return {
            "patient":           patient_info,
            "bills":             all_bills,
            "total_outstanding": round(total_outstanding, 2),
            "count":             len(all_bills),
        }
    finally:
        db.close()


@router.get("/patient/{patient_id}")
def get_patient_bills(patient_id: str):
    """List all bills for a specific patient ID."""
    db = SessionLocal()
    try:
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        bills = db.query(Bill).filter(
            Bill.patient_id == patient_id
        ).order_by(Bill.created_at.desc()).all()

        total_outstanding = sum(
            b.amount for b in bills if b.status == "outstanding"
        )

        return {
            "patient": {
                "name":       patient.name,
                "dob":        patient.dob,
                "patient_id": patient.id,
                "payer":      patient.payer,
            },
            "bills":             [_bill_to_dict(b) for b in bills],
            "total_outstanding": round(total_outstanding, 2),
            "count":             len(bills),
        }
    finally:
        db.close()


@router.post("/pay")
def pay_bill(body: PayBillRequest):
    """
    Mock pay a bill.

    In production: create a Stripe PaymentIntent here, confirm it,
    then update the bill status on success.

    Mock flow: instantly marks bill as paid, returns a receipt.
    """
    db = SessionLocal()
    try:
        bill = db.query(Bill).filter(Bill.id == body.bill_id).first()
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found")

        if bill.patient_id != body.patient_id:
            raise HTTPException(status_code=403, detail="Bill does not belong to this patient")

        if bill.status == "paid":
            raise HTTPException(
                status_code=400,
                detail="This bill has already been paid."
            )

        # ── PRODUCTION SWAP POINT ────────────────────────────────────────────
        # Replace this block with real Stripe:
        #
        # import stripe
        # stripe.api_key = settings.stripe_secret_key
        # intent = stripe.PaymentIntent.create(
        #     amount=int(bill.amount * 100),  # Stripe uses cents
        #     currency="usd",
        #     payment_method_types=["card"],
        #     metadata={"bill_id": bill.id, "patient_id": bill.patient_id}
        # )
        # Then confirm the intent and only update status on success.
        # ────────────────────────────────────────────────────────────────────

        # Mock: mark as paid immediately
        bill.status        = "paid"
        bill.paid_at       = datetime.now(timezone.utc)
        bill.card_last_four = body.card_last_four
        bill.card_brand    = body.card_brand
        db.commit()
        db.refresh(bill)

        return {
            "status":      "success",
            "message":     f"Payment of ${bill.amount:.2f} received. Thank you!",
            "receipt":     _bill_to_dict(bill),
            "mock":        True,
            "note":        "No real charge was made — mock mode. "
                           "Set STRIPE_SECRET_KEY in .env to enable real payments.",
        }
    finally:
        db.close()


@router.get("/receipt/{bill_id}")
def get_receipt(bill_id: str):
    """Retrieve a payment receipt for a paid bill."""
    db = SessionLocal()
    try:
        bill = db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found")
        if bill.status != "paid":
            raise HTTPException(status_code=400, detail="Bill has not been paid yet")

        patient = db.query(Patient).filter(Patient.id == bill.patient_id).first()

        return {
            "receipt_id":    f"RCP-{bill_id[:8].upper()}",
            "paid_at":       bill.paid_at.isoformat() if bill.paid_at else None,
            "amount":        bill.amount,
            "description":   bill.description,
            "card":          f"{bill.card_brand} ending in {bill.card_last_four}",
            "patient_name":  patient.name if patient else "Unknown",
            "mock":          True,
        }
    finally:
        db.close()


@router.post("/bills")
def create_bill(body: CreateBillRequest):
    """
    Admin endpoint — create a new bill for a patient.
    Called after intake, after a procedure, or manually by staff.
    """
    db = SessionLocal()
    try:
        patient = db.query(Patient).filter(Patient.id == body.patient_id).first()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        bill = Bill(
            id=str(uuid.uuid4()),
            patient_id=body.patient_id,
            description=body.description,
            amount=body.amount,
            status="outstanding",
            due_date=body.due_date or _thirty_days_from_now(),
        )
        db.add(bill)
        db.commit()
        db.refresh(bill)

        return {
            "status":  "created",
            "bill":    _bill_to_dict(bill),
        }
    finally:
        db.close()


def _thirty_days_from_now() -> str:
    from datetime import timedelta
    d = datetime.now() + timedelta(days=30)
    return d.strftime("%m/%d/%Y")