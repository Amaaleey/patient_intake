# import smtplib
# from email.mime.text import MIMEText
# import os
# from dotenv import load_dotenv


# for env_path in [
#     os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
#     os.path.join(os.path.dirname(__file__), "..", ".env"),
# ]:
#     if os.path.exists(env_path):
#         load_dotenv(env_path)
#         break

# print("[sms] GMAIL_USER:", os.getenv("GMAIL_USER"))

# def send_appointment_confirmation(to_number, patient_name, doctor, date, time, department):
#     # Use email for dev, swap back to Twilio when A2P approved
#     gmail_user = os.getenv("GMAIL_USER")
#     gmail_pass = os.getenv("GMAIL_APP_PASSWORD")  # Gmail app password, not your real password
#     to_email   = os.getenv("DEV_NOTIFY_EMAIL", gmail_user)

#     if not gmail_user:
#         print("[sms] Email not configured — skipping")
#         return False

#     try:
#         msg = MIMEText(
#             f"Hi {patient_name},\n\n"
#             f"Your appointment has been confirmed!\n\n"
#             f"Doctor:      {doctor}\n"
#             f"Department:  {department}\n"
#             f"Date:        {date}\n"
#             f"Time:        {time}\n\n"
#             f"Please arrive 10 minutes early and bring your insurance card and a valid photo ID.\n\n"
#             f"To reschedule or cancel, please call us directly.\n\n"
#             f"— Ledelsea Health\n"
#             f"Powered by AI Patient Intake Platform"
#         )
#         msg["Subject"] = f"Appointment Confirmed — {patient_name} with {doctor} on {date}" 
#         msg["From"]    = gmail_user
#         msg["To"]      = to_email

#         with smtplib.SMTP_SSL("smtp.gmail.com", 587) as smtp:
#             smtp.login(gmail_user, gmail_pass)
#             smtp.send_message(msg)
#         print(f"[sms] Confirmation email sent to {to_email}")
#         return True
#     except Exception as e:
#         print(f"[sms] Email failed: {e}")
#         return False
    
# def send_payment_receipt(
#     patient_name: str,
#     doctor: str,
#     date: str,
#     time: str,
#     department: str,
#     amount: str,
#     payment_date: str,
# ) -> bool:
#     gmail_user = os.getenv("GMAIL_USER")
#     gmail_pass = os.getenv("GMAIL_APP_PASSWORD")
#     to_email   = os.getenv("DEV_NOTIFY_EMAIL", gmail_user)

#     if not gmail_user:
#         print("[sms] Email not configured — skipping receipt")
#         return False

#     try:
#         msg = MIMEText(
#             f"Hi {patient_name},\n\n"
#             f"Payment received — thank you!\n\n"
#             f"Receipt\n"
#             f"-------\n"
#             f"Amount paid:   ${amount}\n"
#             f"Date paid:     {payment_date}\n"
#             f"Doctor:        {doctor}\n"
#             f"Department:    {department}\n"
#             f"Appointment:   {date} at {time}\n\n"
#             f"Your copay has been processed. See you at your appointment!\n\n"
#             f"— Ledelsea Health"
#         )
#         msg["Subject"] = f"Payment Receipt — ${amount} for {patient_name}"
#         msg["From"]    = gmail_user
#         msg["To"]      = to_email

#         with smtplib.SMTP_SSL("smtp.gmail.com", 587) as smtp:
#             smtp.login(gmail_user, gmail_pass)
#             smtp.send_message(msg)
#         print(f"[sms] Receipt email sent to {to_email}")
#         return True
#     except Exception as e:
#         print(f"[sms] Receipt email failed: {e}")
#         return False

import os
import httpx
from dotenv import load_dotenv

for env_path in [
    os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env"),
]:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL     = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")
TO_EMAIL       = os.getenv("DEV_NOTIFY_EMAIL", "amal@ledelsea.com")

print("[sms] RESEND_API_KEY set:", bool(RESEND_API_KEY))


def _send(subject: str, body: str) -> bool:
    if not RESEND_API_KEY:
        print("[sms] RESEND_API_KEY not set — skipping email")
        return False
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": FROM_EMAIL,
                "to": [TO_EMAIL],
                "subject": subject,
                "text": body,
            },
            timeout=10.0,
        )
        if response.status_code == 200 or response.status_code == 201:
            print(f"[sms] Email sent: {subject}")
            return True
        else:
            print(f"[sms] Email failed: {response.status_code} {response.text}")
            return False
    except Exception as e:
        print(f"[sms] Email failed: {e}")
        return False


def send_appointment_confirmation(
    to_number: str,
    patient_name: str,
    doctor: str,
    date: str,
    time: str,
    department: str,
) -> bool:
    return _send(
        subject=f"Appointment Confirmed — {patient_name} with {doctor} on {date}",
        body=(
            f"Hi {patient_name},\n\n"
            f"Your appointment has been confirmed!\n\n"
            f"Doctor:      {doctor}\n"
            f"Department:  {department}\n"
            f"Date:        {date}\n"
            f"Time:        {time}\n\n"
            f"Please arrive 10 minutes early and bring your insurance card and a valid photo ID.\n\n"
            f"To reschedule or cancel, please call us directly.\n\n"
            f"— Ledelsea Health"
        ),
    )


def send_payment_receipt(
    patient_name: str,
    doctor: str,
    date: str,
    time: str,
    department: str,
    amount: str,
    payment_date: str,
) -> bool:
    return _send(
        subject=f"Payment Receipt — ${amount} for {patient_name}",
        body=(
            f"Hi {patient_name},\n\n"
            f"Payment received — thank you!\n\n"
            f"Receipt\n"
            f"-------\n"
            f"Amount paid:   ${amount}\n"
            f"Date paid:     {payment_date}\n"
            f"Doctor:        {doctor}\n"
            f"Department:    {department}\n"
            f"Appointment:   {date} at {time}\n\n"
            f"Your copay has been processed. See you at your appointment!\n\n"
            f"— Ledelsea Health"
        ),
    )