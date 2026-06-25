# """
# sms.py — SMS confirmation service via Twilio.
# Sends appointment confirmation after booking is complete.
# """
# import os
# from dotenv import load_dotenv
# from twilio.rest import Client

# # Load .env from either location
# for env_path in [
#     os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
#     os.path.join(os.path.dirname(__file__), "..", ".env"),
# ]:
#     if os.path.exists(env_path):
#         load_dotenv(env_path)
#         break


# def send_appointment_confirmation(
#     to_number: str,
#     patient_name: str,
#     doctor: str,
#     date: str,
#     time: str,
#     department: str,
# ) -> bool:
#     """
#     Send SMS appointment confirmation to patient.
#     Returns True if sent successfully, False otherwise.
#     """
#     account_sid = os.getenv("TWILIO_ACCOUNT_SID")
#     auth_token  = os.getenv("TWILIO_AUTH_TOKEN")
#     from_number = os.getenv("TWILIO_FROM_NUMBER")

#     if not all([account_sid, auth_token, from_number]):
#         print("[sms] Twilio credentials not configured — skipping SMS")
#         return False

#     try:
#         client = Client(account_sid, auth_token)
#         message = client.messages.create(
#             body=(
#                 f"Confirmed: {patient_name} with {doctor}, "
#                 f"{date} at {time} ({department}). "
#                 f"- Ledelsea Health"
#             ),
#             from_=from_number,
#             to=f"+1{to_number}" if not to_number.startswith("+") else to_number,
#         )
#         print(f"[sms] Confirmation sent to {to_number} — SID: {message.sid}")
#         return True

#     except Exception as e:
#         print(f"[sms] Failed to send SMS: {e}")
#         return False


import smtplib
from email.mime.text import MIMEText
import os
from dotenv import load_dotenv


for env_path in [
    os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env"),
]:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

print("[sms] GMAIL_USER:", os.getenv("GMAIL_USER"))
def send_appointment_confirmation(to_number, patient_name, doctor, date, time, department):
    # Use email for dev, swap back to Twilio when A2P approved
    gmail_user = os.getenv("GMAIL_USER")
    gmail_pass = os.getenv("GMAIL_APP_PASSWORD")  # Gmail app password, not your real password
    to_email   = os.getenv("DEV_NOTIFY_EMAIL", gmail_user)

    if not gmail_user:
        print("[sms] Email not configured — skipping")
        return False

    try:
        msg = MIMEText(
            f"Hi {patient_name},\n\n"
            f"Your appointment has been confirmed!\n\n"
            f"Doctor:      {doctor}\n"
            f"Department:  {department}\n"
            f"Date:        {date}\n"
            f"Time:        {time}\n\n"
            f"Please arrive 10 minutes early and bring your insurance card and a valid photo ID.\n\n"
            f"To reschedule or cancel, please call us directly.\n\n"
            f"— Ledelsea Health\n"
            f"Powered by AI Patient Intake Platform"
        )
        msg["Subject"] = f"Appointment Confirmed — {patient_name} with {doctor} on {date}" 
        msg["From"]    = gmail_user
        msg["To"]      = to_email

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(gmail_user, gmail_pass)
            smtp.send_message(msg)
        print(f"[sms] Confirmation email sent to {to_email}")
        return True
    except Exception as e:
        print(f"[sms] Email failed: {e}")
        return False