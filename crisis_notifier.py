"""
crisis_notifier.py — Mock crisis notification server.

Runs on port 8001. Receives crisis alerts from the intake app
and broadcasts them to connected WebSocket clients (terminal or browser).

In production: replace _send_mock_alert() with real 911/dispatch API calls.

Run from patient-intake/:
    python crisis_notifier.py
"""
import json
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI(title="Crisis Notification Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Connected WebSocket clients (browser dashboard) ────────────────────────
connected_clients: list[WebSocket] = []

# ── In-memory alert log ────────────────────────────────────────────────────
alert_log: list[dict] = []


async def broadcast(alert: dict):
    """Send alert to all connected browser/terminal clients."""
    message = json.dumps(alert)
    disconnected = []
    for ws in connected_clients:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        connected_clients.remove(ws)


# ── Alert receiver — called by intake backend ──────────────────────────────
@app.post("/alert")
async def receive_alert(alert: dict, request: Request):
    """
    Receive a crisis alert from the intake app.

    Expected payload:
    {
        "type": "mental_health_crisis" | "medical_emergency",
        "session_id": "...",
        "patient_name": "...",
        "patient_address": "...",
        "reason": "patient's exact words",
        "client_ip": "..."
    }

    In production: replace mock logic below with real dispatch API calls.
    """
    alert["received_at"] = datetime.now(timezone.utc).isoformat()
    alert["status"] = "MOCK — not sent to real authorities"
    # Capture IP from the intake request if not already provided
    if not alert.get("client_ip"):
        alert["client_ip"] = request.client.host if request.client else "unknown"

    # Store in log
    alert_log.append(alert)

    # Print to terminal (visible in crisis_notifier.py terminal)
    _print_terminal_alert(alert)

    # Broadcast to browser dashboard
    await broadcast(alert)

    # ── PRODUCTION SWAP POINT ──────────────────────────────────────────────
    # When ready for production, call your real dispatch API here:
    # await _call_911_api(alert)
    # await _notify_social_worker(alert)
    # await _page_on_call_counselor(alert)
    # ──────────────────────────────────────────────────────────────────────

    return {"status": "received", "mock": True, "alert_id": len(alert_log)}


def _print_terminal_alert(alert: dict):
    """Print a visible alert to the crisis_notifier.py terminal."""
    border = "=" * 60
    print(f"\n{border}")
    print(f"  🚨 CRISIS ALERT — {alert.get('type', 'UNKNOWN').upper()}")
    print(border)
    print(f"  Time:       {alert.get('received_at', '')}")
    print(f"  Patient:    {alert.get('patient_name', 'unknown')}")
    print(f"  Address:    {alert.get('patient_address', 'unknown')}")
    print(f"  IP:         {alert.get('client_ip', 'unknown')}")
    print(f"  Reason:     {alert.get('reason', '')}")
    print(f"  Status:     {alert.get('status', '')}")
    print(f"{border}\n")
    print("  [MOCK] In production this would notify local authorities.")
    print(f"{border}\n")


# ── WebSocket endpoint for browser dashboard ───────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    # Send existing alerts on connect
    for alert in alert_log:
        await websocket.send_text(json.dumps(alert))
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        connected_clients.remove(websocket)


# ── Alert log endpoint ─────────────────────────────────────────────────────
@app.get("/alerts")
async def get_alerts():
    return {"alerts": alert_log, "count": len(alert_log)}


# ── Browser dashboard ──────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Crisis Alert Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f1117;
    color: #e0e0e0;
    padding: 32px;
    min-height: 100vh;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 1px solid #2a2a2a;
  }
  .badge {
    background: #c04020;
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 20px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .badge.mock { background: #b06a10; }
  h1 { font-size: 20px; font-weight: 600; }
  .subtitle { font-size: 12px; color: #666; margin-top: 4px; }
  .status {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #666;
  }
  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #555;
    transition: background 0.3s;
  }
  .dot.connected { background: #1a9e75; }
  .empty {
    text-align: center;
    padding: 60px 20px;
    color: #444;
    font-size: 14px;
  }
  .alert-card {
    background: #1a1a1a;
    border: 1px solid #c04020;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 16px;
    animation: slideIn 0.3s ease;
  }
  .alert-card.medical { border-color: #e55a00; }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .alert-type {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #c04020;
    margin-bottom: 10px;
  }
  .alert-card.medical .alert-type { color: #e55a00; }
  .alert-field {
    display: flex;
    gap: 12px;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .alert-label {
    color: #555;
    min-width: 80px;
    flex-shrink: 0;
  }
  .alert-value { color: #e0e0e0; }
  .mock-badge {
    display: inline-block;
    margin-top: 12px;
    font-size: 11px;
    background: #2a1a00;
    color: #b06a10;
    border: 1px solid #b06a10;
    padding: 3px 10px;
    border-radius: 20px;
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <h1>Crisis Alert Dashboard</h1>
      <span class="badge mock">Mock Mode</span>
    </div>
    <div class="subtitle">Ledelsea · AI Patient Intake · For testing only — no real alerts sent</div>
  </div>
  <div class="status">
    <div class="dot" id="dot"></div>
    <span id="status-text">Connecting...</span>
  </div>
</div>

<div id="alerts">
  <div class="empty" id="empty">No alerts yet. Trigger a crisis response in the intake chat to see it here.</div>
</div>

<script>
  const ws = new WebSocket('ws://localhost:8001/ws')
  const dot = document.getElementById('dot')
  const statusText = document.getElementById('status-text')
  const alertsEl = document.getElementById('alerts')
  const emptyEl = document.getElementById('empty')

  ws.onopen = () => {
    dot.classList.add('connected')
    statusText.textContent = 'Connected — listening for alerts'
  }

  ws.onclose = () => {
    dot.classList.remove('connected')
    statusText.textContent = 'Disconnected'
  }

  ws.onmessage = (e) => {
    const alert = JSON.parse(e.data)
    emptyEl && emptyEl.remove()
    renderAlert(alert)
  }

  function renderAlert(alert) {
    const isCrisis = alert.type === 'mental_health_crisis'
    const card = document.createElement('div')
    card.className = 'alert-card' + (isCrisis ? '' : ' medical')
    card.innerHTML = `
      <div class="alert-type">🚨 ${(alert.type || 'unknown').replace(/_/g, ' ').toUpperCase()}</div>
      <div class="alert-field"><span class="alert-label">Time</span><span class="alert-value">${alert.received_at || ''}</span></div>
      <div class="alert-field"><span class="alert-label">Patient</span><span class="alert-value">${alert.patient_name || 'unknown'}</span></div>
      <div class="alert-field"><span class="alert-label">Address</span><span class="alert-value">${alert.patient_address || 'unknown'}</span></div>
      <div class="alert-field"><span class="alert-label">IP</span><span class="alert-value">${alert.client_ip || 'unknown'}</span></div>
      <div class="alert-field"><span class="alert-label">Reason</span><span class="alert-value">${alert.reason || ''}</span></div>
      <div class="mock-badge">MOCK — not sent to real authorities</div>
    `
    alertsEl.prepend(card)
  }
</script>
</body>
</html>"""


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  Crisis Notification Server — MOCK MODE")
    print("  Listening on http://localhost:8001")
    print("  Dashboard: http://localhost:8001")
    print("  Alerts log: http://localhost:8001/alerts")
    print("  NO real alerts will be sent")
    print("=" * 50 + "\n")
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")