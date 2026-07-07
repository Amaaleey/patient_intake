"""
payment.py — Stripe payment routes.
Handles copay payment intent creation and confirmation.
"""
import stripe
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from models import SessionLocal, Patient
from dotenv import load_dotenv
from datetime import datetime
from services.sms import send_payment_receipt


for env_path in [
    os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env"),
]:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

router = APIRouter()


class CreateIntentRequest(BaseModel):
    patient_id: str
    amount_dollars: float
    patient_name: str
    description: Optional[str] = "Copay payment"


class ConfirmPaymentRequest(BaseModel):
    patient_id: str
    payment_intent_id: str


class PortalLookupRequest(BaseModel):
    name: str
    dob: str


@router.post("/payment/create-intent")
async def create_payment_intent(body: CreateIntentRequest):
    try:
        amount_cents = int(body.amount_dollars * 100)
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency="usd",
            description=body.description,
            metadata={
                "patient_id": body.patient_id,
                "patient_name": body.patient_name,
            },
        )
        print(f"[stripe] Payment intent created — ${body.amount_dollars} for {body.patient_name} — ID: {intent.id}")
        return {
            "client_secret": intent.client_secret,
            "payment_intent_id": intent.id,
            "amount": amount_cents,
        }
    except Exception as e:
        print(f"[stripe] Failed to create intent: {e}")
        raise HTTPException(status_code=400, detail=str(e))



@router.post("/payment/confirm")
async def confirm_payment(body: ConfirmPaymentRequest):
    try:
        intent = stripe.PaymentIntent.retrieve(body.payment_intent_id)
        if intent.status == "succeeded":
            db = SessionLocal()
            try:
                patient = db.query(Patient).filter(
                    Patient.id == body.patient_id
                ).first()
                if patient:
                    payment_date = datetime.now().strftime("%B %d, %Y at %I:%M %p")
                    patient.payment_status    = "paid"
                    patient.payment_intent_id = body.payment_intent_id
                    patient.payment_date      = payment_date
                    db.commit()
                    print(f"[stripe] Payment confirmed — patient: {patient.name} — intent: {body.payment_intent_id}")

                    # Send receipt email
                    send_payment_receipt(
                        patient_name=patient.name or "",
                        doctor=patient.appointment_doctor or "",
                        date=patient.appointment_date or "",
                        time=patient.appointment_time or "",
                        department=patient.department or "",
                        amount=patient.copay or "0",
                        payment_date=payment_date,
                    )
            finally:
                db.close()
            return {"status": "paid"}
        return {"status": intent.status}
    except Exception as e:
        print(f"[stripe] Confirm failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/portal/lookup")
async def portal_lookup(body: PortalLookupRequest):
    db = SessionLocal()
    try:
        patients = db.query(Patient).filter(
            Patient.name.ilike(f"%{body.name.strip()}%"),
            Patient.dob == body.dob.strip(),
        ).all()

        if not patients:
            raise HTTPException(status_code=404, detail="No records found")

        return {
            "patients": [
                {
                    "patient_id":         p.id,
                    "name":               p.name,
                    "dob":                p.dob,
                    "department":         p.department,
                    "appointment_doctor": p.appointment_doctor,
                    "appointment_date":   p.appointment_date,
                    "appointment_time":   p.appointment_time,
                    "payer":              p.payer,
                    "copay":              p.copay,
                    "payment_status":     getattr(p, "payment_status", "unpaid") or "unpaid",
                    "payment_date":       getattr(p, "payment_date", None) or "",
                    "reason":             p.reason_for_visit,
                    "created_at":         p.created_at.isoformat() if p.created_at else "",
                    
                }
                for p in patients
            ]
        }
    finally:
        db.close()


@router.get("/payment/publishable-key")
async def get_publishable_key():
    return {"publishable_key": os.getenv("STRIPE_PUBLISHABLE_KEY")}