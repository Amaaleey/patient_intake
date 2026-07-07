from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models import init_db
from routes import intake
from services.patient_lookup import load_patients
from routes.payment import router as payment_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    load_patients()
    yield
    # Shutdown (nothing to do yet)

app = FastAPI(title="Patient Intake API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(intake.router, prefix="/intake")
app.include_router(payment_router)  # ← move here, after app is defined
@app.get("/health")
def health():
    return {"status": "ok"}