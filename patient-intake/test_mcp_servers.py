"""
test_mcp_servers.py
Tests all MCP servers by calling their /call HTTP endpoints directly.
Run from patient-intake/ after make dev:

    python test_mcp_servers.py
"""
import httpx
import json
import asyncio


# ── Test cases ─────────────────────────────────────────────────────────────

TESTS = [

    # Patient lookup — should find a real record from your CSV
    {
        "name": "lookup_patient — found",
        "url": "http://localhost:5101/call",
        "payload": {"tool": "lookup_patient", "input": {"name": "Bobby Jackson", "dob": "03/28/1985"}},
        "expect": lambda r: "name" in r.get("result", ""),
    },

    # Patient lookup — should return NOT_FOUND
    {
        "name": "lookup_patient — not found",
        "url": "http://localhost:5101/call",
        "payload": {"tool": "lookup_patient", "input": {"name": "Fake Person", "dob": "01/01/2000"}},
        "expect": lambda r: r.get("result") == "NOT_FOUND",
    },

    # Eligibility — active PPO
    {
        "name": "check_eligibility — active PPO",
        "url": "http://localhost:5102/call",
        "payload": {"tool": "check_eligibility", "input": {"insurance_id": "MBR-1234-ABCD", "payer": "Blue Cross"}},
        "expect": lambda r: '"covered": true' in r.get("result", "").lower() or
                            json.loads(r.get("result", "{}")).get("covered") == True,
    },

    # Eligibility — Medicare
    {
        "name": "check_eligibility — Medicare",
        "url": "http://localhost:5102/call",
        "payload": {"tool": "check_eligibility", "input": {"insurance_id": "MBR-9999-ZZZZ", "payer": "Medicare"}},
        "expect": lambda r: "medicare" in r.get("result", "").lower(),
    },

    # Eligibility — self pay
    {
        "name": "check_eligibility — self pay",
        "url": "http://localhost:5102/call",
        "payload": {"tool": "check_eligibility", "input": {"insurance_id": "NONE", "payer": "Self-pay"}},
        "expect": lambda r: '"covered": false' in r.get("result", "").lower() or
                            json.loads(r.get("result", "{}")).get("covered") == False,
    },

    # FHIR slots — Family Medicine
    {
        "name": "fhir_get_slots — Family Medicine",
        "url": "http://localhost:5103/call",
        "payload": {"tool": "fhir_get_slots", "input": {"department": "Family Medicine"}},
        "expect": lambda r: "Dr." in r.get("result", ""),
    },

    # FHIR slots — Dermatology
    {
        "name": "fhir_get_slots — Dermatology",
        "url": "http://localhost:5103/call",
        "payload": {"tool": "fhir_get_slots", "input": {"department": "Dermatology"}},
        "expect": lambda r: "Dr. Adams" in r.get("result", ""),
    },

    # FHIR create patient
    {
        "name": "fhir_create_patient",
        "url": "http://localhost:5103/call",
        "payload": {"tool": "fhir_create_patient", "input": {
            "name": "Test Patient",
            "dob": "01/01/1990",
            "phone": "763-316-1054",
            "email": "test@test.com",
            "insurance_id": "MBR-TEST-0001",
            "payer": "Blue Cross",
            "department": "Family Medicine",
            "reason": "test intake",
            "appointment_doctor": "Dr. Patel",
            "appointment_date": "Mon Jun 9",
            "appointment_time": "9:00 AM",
        }},
        "expect": lambda r: "created" in r.get("result", ""),
    },
]


# ── Runner ─────────────────────────────────────────────────────────────────

async def run_tests():
    print("\nTesting MCP servers...\n")
    passed = 0
    failed = 0

    async with httpx.AsyncClient(timeout=5.0) as client:
        for test in TESTS:
            try:
                res = await client.post(test["url"], json=test["payload"])
                res.raise_for_status()
                data = res.json()

                if test["expect"](data):
                    print(f"  ✓  {test['name']}")
                    passed += 1
                else:
                    print(f"  ✗  {test['name']}")
                    print(f"     Got: {json.dumps(data)[:120]}")
                    failed += 1

            except httpx.ConnectError:
                server_port = test["url"].split(":")[2].split("/")[0]
                print(f"  ⚠️  {test['name']}")
                print(f"     MCP server not reachable on port {server_port} — is make dev running?")
                failed += 1

            except Exception as e:
                print(f"  ✗  {test['name']}")
                print(f"     Error: {e}")
                failed += 1

    print(f"\n{passed}/{passed + failed} tests passed")

    if failed > 0:
        print("\nTo fix:")
        print("  1. Make sure make dev is running")
        print("  2. Make sure MCP servers started without errors")
        print("  3. Check ports 5101, 5102, 5103 are not blocked")


if __name__ == "__main__":
    asyncio.run(run_tests())