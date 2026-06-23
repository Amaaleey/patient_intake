# AI Patient Intake Platform

Conversational AI that guides patients through registration, insurance verification, department selection, and appointment booking — in one chat conversation.

Built on Claude Haiku · HAPI FHIR · NIST IAL2 · HIPAA compliant

---

## What it does

A patient opens the app and has a natural conversation with an AI receptionist. By the end they have a confirmed appointment, verified insurance, and their record saved to the EHR. The full returning patient journey takes under 90 seconds.

**Returning patient flow:**
1. Identifies as returning → gives name + date of birth
2. AI looks up their record → verifies city and state for identity
3. Confirms phone and email on file
4. Insurance verified in real time → copay shown before booking
5. Picks department → describes reason for visit
6. AI checks for emergencies → suggests correct department if mismatched
7. Picks appointment slot
8. Booked → confirmation card shown

**New patient flow:** Same as above but collects all details fresh and creates a new record in HAPI FHIR.

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- Docker Desktop
- An Anthropic API key

---

## First time setup

**1. Clone and enter the project**
```bash
cd patient-intake
```

**2. Copy environment files**
```bash
cp .env.example .env
```
Open `.env` and add your `ANTHROPIC_API_KEY`. Everything else works as-is for local dev.

**3. Set up the Python virtual environment**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
cd ..
make install
```

**4. Install frontend dependencies**
```bash
cd frontend
npm install
cd ..
```

---

## Running the app

You need three terminals open at the same time.

**Terminal 1 — start the databases**
```bash
cd patient-intake
docker-compose up -d
```
Starts PostgreSQL, Redis, and HAPI FHIR in the background.

**Terminal 2 — start the backend**
```bash
cd patient-intake
source backend/.venv/bin/activate
make dev
```
Starts 6 MCP servers and the FastAPI backend.

**Terminal 3 — start the frontend**
```bash
cd patient-intake/frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

---
**Terminal 4 — start the MCP Inspector**
```bash
npx @modelcontextprotocol/inspector
```

## Stopping everything

```bash
# Stop frontend — Ctrl+C in Terminal 3
# Stop backend — Ctrl+C in Terminal 2
make stop

# Stop databases
docker-compose down
```

---

## Ports

| Service | Port | What it is |
|---|---|---|
| Frontend (Next.js) | 3000 | Patient chat UI |
| Backend (FastAPI) | 8000 | API + conversation loop |
| PostgreSQL | 5432 | Sessions + patient records |
| Redis | 6379 | Conversation history |
| HAPI FHIR | 8080 | EHR patient records |
| patient-lookup MCP | 5001 | Looks up patients from CSV |
| eligibility MCP | 5002 | Insurance check (mock) |
| hapi-fhir MCP | 5003 | Writes patient records |
| epic MCP | 5004 | Stub — activate when access arrives |
| athena MCP | 5005 | Stub |
| cerner MCP | 5006 | Stub |

---

## MCP servers

### Local MCP servers (running via make dev)

Six MCP servers run locally as part of `make dev`. Each has an SSE endpoint for remote MCP and an HTTP `/call` endpoint for local routing.

| Server | SSE | HTTP /call |
|---|---|---|
| patient-lookup | http://127.0.0.1:5001/sse | http://127.0.0.1:5101/call |
| eligibility | http://127.0.0.1:5002/sse | http://127.0.0.1:5102/call |
| hapi-fhir | http://127.0.0.1:5003/sse | http://127.0.0.1:5103/call |
| epic (stub) | http://127.0.0.1:5004/sse | — |
| athena (stub) | http://127.0.0.1:5005/sse | — |
| cerner (stub) | http://127.0.0.1:5006/sse | — |

### Deployed MCP servers (Hugging Face Spaces)

The three active MCP servers are deployed publicly on Hugging Face for remote MCP use.

| Server | Public URL |
|---|---|
| patient-lookup | https://amalh1-ledelsea-patient-lookup.hf.space/sse |
| eligibility | https://amalh1-ledelsea-eligibility.hf.space/sse |
| hapi-fhir | https://amalh1-hapi-fhir.hf.space/sse |

**Verify all three are running:**
```bash
curl -I https://amalh1-ledelsea-patient-lookup.hf.space/sse
curl -I https://amalh1-ledelsea-eligibility.hf.space/sse
curl -I https://amalh1-hapi-fhir.hf.space/sse
```
All should return `HTTP/2 200`.

**To switch to remote MCP** — update `.env` with the HF URLs and uncomment the remote block in `backend/services/claude.py`. See the MCP switching section below.

### Inspecting MCP servers with MCP Inspector

MCP Inspector lets you browse your MCP servers, see all tools, and call them manually from a visual UI.

**Run Inspector:**
```bash
npx @modelcontextprotocol/inspector
```

Opens at **http://localhost:6274**.

**Connect to a server:**
1. Set Transport Type to **SSE**
2. Paste a server URL (local or HF) into the URL field
3. Click **Connect**
4. Browse tools and call them with custom inputs

**Local servers to inspect:**
```
http://127.0.0.1:5001/sse   ← patient-lookup
http://127.0.0.1:5002/sse   ← eligibility
http://127.0.0.1:5003/sse   ← hapi-fhir
```

**Deployed servers to inspect:**
```
https://amalh1-ledelsea-patient-lookup.hf.space/sse
https://amalh1-ledelsea-eligibility.hf.space/sse
https://amalh1-hapi-fhir.hf.space/sse
```

**Test MCP servers programmatically:**
```bash
cd patient-intake
source backend/.venv/bin/activate
python test_mcp_servers.py
```
Runs 8 tests across all 3 active servers and prints pass/fail results.

### Switching between local and remote MCP

**Local mode (default)** — tools are routed through `mcp_client.py` to local servers:
```python
# In backend/services/claude.py — active block:
response = anthropic_client.messages.create(
    model=MODEL,
    max_tokens=800,
    system=system,
    tools=TOOLS,
    messages=history,
)
```

**Remote mode (Hugging Face)** — Anthropic calls HF servers directly:
```python
# In backend/services/claude.py — uncomment this block:
response = anthropic_client.beta.messages.create(
    model=MODEL,
    max_tokens=800,
    system=system,
    messages=history,
    mcp_servers=MCP_SERVERS,
    betas=["mcp-client-2025-04-04"],
)
```

Then update `.env`:
```
MCP_PATIENT_LOOKUP_URL=https://amalh1-ledelsea-patient-lookup.hf.space/sse
MCP_ELIGIBILITY_URL=https://amalh1-ledelsea-eligibility.hf.space/sse
MCP_EHR_URL=https://amalh1-hapi-fhir.hf.space/sse
```

Restart with `make dev`.

---

## Project structure

```
patient-intake/
├── .env                        # your config — never commit this
├── .env.example                # safe template to copy from
├── docker-compose.yml          # PostgreSQL + Redis + HAPI FHIR
├── Makefile                    # dev shortcuts
├── start_mcp_servers.py        # launches all MCP servers
├── test_mcp_servers.py         # tests all MCP servers
├── crisis_notifier.py          # mock crisis alert server
├── AGENT_GUIDELINES.md         # clinical behavior rules for the AI agent
├── README.md
│
├── frontend/
│   ├── pages/
│   │   ├── _app.tsx
│   │   └── index.tsx           # main chat UI
│   ├── styles/
│   │   └── globals.css
│   ├── next.config.js
│   └── package.json
│
├── hf_spaces/                  # Hugging Face deployment files
│   ├── patient_lookup/
│   ├── eligibility/
│   └── hapi_fhir/
│
└── backend/
    ├── main.py                 # FastAPI entry point
    ├── config.py               # reads .env
    ├── models.py               # PostgreSQL models
    ├── routes/
    │   └── intake.py           # /intake/start, /intake/message, /intake/session
    ├── services/
    │   ├── claude.py           # conversation loop + tool execution
    │   ├── mcp_client.py       # routes tool calls to local MCP servers
    │   ├── fhir_client.py      # writes to HAPI FHIR
    │   └── patient_lookup.py   # looks up patients from CSV
    ├── mcp_servers/            # one folder per integration
    │   ├── patient_lookup/
    │   ├── eligibility/
    │   ├── hapi_fhir/          # active EHR (default)
    │   ├── epic/               # stub
    │   ├── athena/             # stub
    │   └── cerner/             # stub
    └── data/
        └── patients_enriched.csv   # synthetic patient data for testing
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `FHIR_BASE_URL` | ✅ | HAPI FHIR URL (default: localhost:8080/fhir) |
| `EHR_BACKEND` | | Which EHR to write to: `hapi_fhir` (default), `epic`, `athena`, `cerner` |
| `USE_MOCK_ELIGIBILITY` | | `true` = mock insurance data, `false` = real Availity (default: true) |
| `AVAILITY_CLIENT_ID` | | Only needed when `USE_MOCK_ELIGIBILITY=false` |
| `AVAILITY_CLIENT_SECRET` | | Availity secret |
| `EPIC_CLIENT_ID` | | Only needed when `EHR_BACKEND=epic` |
| `ATHENA_CLIENT_ID` | | Athena sandbox |
| `CERNER_CLIENT_ID` | | Cerner sandbox |
| `MCP_PATIENT_LOOKUP_URL` | | Public URL for remote MCP (default: localhost:5001/sse) |
| `MCP_ELIGIBILITY_URL` | | Public URL for remote MCP (default: localhost:5002/sse) |
| `MCP_EHR_URL` | | Public URL for remote MCP (default: localhost:5003/sse) |
| `CRISIS_NOTIFIER_URL` | | Crisis notification server (default: localhost:8001) |

---

## Switching EHR backends

When Epic, Athena, or Cerner sandbox access arrives, change one line in `.env`:

```bash
EHR_BACKEND=epic
```

Restart with `make dev`. Nothing else changes — the MCP server handles the rest.

---

## Switching to real insurance verification

By default the app uses mock insurance data. To use real Availity:

1. Sign up at developer.availity.com
2. Add credentials to `.env`
3. Set `USE_MOCK_ELIGIBILITY=false`
4. Restart with `make dev`

---

## Crisis notification (mock)

The app sends alerts to a local crisis notification server when a patient mentions suicidal thoughts or a medical emergency. Run it in a separate terminal:

```bash
cd patient-intake
source backend/.venv/bin/activate
python crisis_notifier.py
```

Open **http://localhost:8001** to see the alert dashboard.

In production: replace the mock handler in `crisis_notifier.py` with real dispatch API calls.

---

## Viewing patient data

**In PostgreSQL (quick check):**
```bash
docker exec -it patient-intake-postgres-1 psql -U intake_user -d intake_db
```
```sql
SELECT name, department, appointment_doctor, appointment_date FROM patients ORDER BY created_at DESC LIMIT 5;
\q
```

**In HAPI FHIR:**
Open http://localhost:8080 in your browser → click "Patient" to see all records.

**Using TablePlus (recommended):**
Download from tableplus.com and connect with host `localhost`, port `5432`, database `intake_db`, user `intake_user`, password `intake_password`.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/intake/start` | Start a new intake session |
| POST | `/intake/message` | Send a message and get a reply |
| GET | `/intake/session/{id}` | Get completed intake data |
| GET | `/health` | Health check |

---

## Common problems

**`make: pip: No such file or directory`**
Use `pip3` — or activate the venv first: `source backend/.venv/bin/activate`

**`Cannot connect to backend`**
Make sure `make dev` is running. Check http://localhost:8000/docs to verify FastAPI is up.

**`Patient not found`**
The lookup reads from `backend/data/patients_enriched.csv`. Make sure the file exists and has rows. Run `python clean_phones.py` from `backend/` to clean phone number formatting.

**`FHIR write failed`**
Make sure Docker is running: `docker-compose up -d`. Check http://localhost:8080 to verify HAPI FHIR is up.

**`MCP servers crashing on startup`**
Make sure the venv is activated before running `make dev`. MCP servers use the venv Python at `backend/.venv/bin/python3`.

**`Ports already in use`**
```bash
make stop
lsof -ti:5001,5002,5003,5004,5005,5006,8000 | xargs kill -9 2>/dev/null; true
make dev
```

**`HF Space returning connection error`**
Free tier HF Spaces sleep after inactivity. Visit the Space URL to wake it up, then retry. Check status at https://huggingface.co/spaces/amalH1/ledelsea-patient-lookup.

---

## Clinical guidelines

The AI agent follows strict clinical rules defined in `AGENT_GUIDELINES.md` at the project root. These are loaded automatically at runtime — edit that file to update agent behavior without touching code.

Key rules:
- Hard stop and redirect to 911 for medical emergencies
- Hard stop and provide 988 for mental health crisis
- Never diagnose, recommend medication, or interpret results
- Never substitute or rename a patient's insurance provider
- Direct patients to call the clinic when human help is needed

---

*AI Patient Intake Platform · June 2026 · Confidential*
*Ledelsea · Built on Claude Haiku · HAPI FHIR · NIST IAL2*