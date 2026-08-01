"""
setup_inbound_dispatch.py
─────────────────────────
Creates a SIP Dispatch Rule in LiveKit so that inbound calls
(someone calling the Vobiz/SIP number) are automatically routed
to the 'realzentic-dubai-agent' AI worker.

Run once from the VPS after setting up the inbound SIP trunk:
    python setup_inbound_dispatch.py

Updated for livekit-agents >= 1.5.x SDK (removed deprecated room_prefix/pin).
"""

import asyncio
import os
from dotenv import load_dotenv
from livekit import api

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# ─── HARDCODED correct inbound trunk ID ───────────────────────────────────────
# This is the LiveKit INBOUND trunk (ST_9bvtevghR8Fk = "inbound ai calling agent")
# It is DIFFERENT from the outbound trunk (ST_tid7UwRXffGP)
INBOUND_TRUNK_ID = "ST_9bvtevghR8Fk"
AGENT_NAME       = "realzentic-dubai-agent"
AGENT_METADATA   = '{"call_type": "inbound"}'


async def main():
    lk_url    = os.getenv("LIVEKIT_URL")
    lk_key    = os.getenv("LIVEKIT_API_KEY")
    lk_secret = os.getenv("LIVEKIT_API_SECRET")

    if not all([lk_url, lk_key, lk_secret]):
        print("❌ LiveKit credentials missing in .env")
        return

    lkapi = api.LiveKitAPI(url=lk_url, api_key=lk_key, api_secret=lk_secret)

    print(f"LiveKit URL     : {lk_url}")
    print(f"Inbound Trunk   : {INBOUND_TRUNK_ID}")
    print(f"Agent Name      : {AGENT_NAME}")
    print()

    try:
        # ── 1. List and delete ALL existing dispatch rules ─────────────────────
        try:
            # Use new non-deprecated method first, fall back to old one
            try:
                existing = await lkapi.sip.list_dispatch_rule(
                    api.ListSIPDispatchRuleRequest()
                )
            except AttributeError:
                existing = await lkapi.sip.list_sip_dispatch_rule(
                    api.ListSIPDispatchRuleRequest()
                )

            if existing.items:
                print(f"Found {len(existing.items)} existing dispatch rule(s) — deleting all...")
                for rule in existing.items:
                    try:
                        await lkapi.sip.delete_sip_dispatch_rule(
                            api.DeleteSIPDispatchRuleRequest(
                                sip_dispatch_rule_id=rule.sip_dispatch_rule_id
                            )
                        )
                        print(f"  ✓ Deleted rule {rule.sip_dispatch_rule_id} (trunks: {rule.trunk_ids})")
                    except Exception as del_err:
                        print(f"  ⚠ Could not delete {rule.sip_dispatch_rule_id}: {del_err}")
                print()
            else:
                print("No existing dispatch rules found.")
                print()
        except Exception as list_err:
            print(f"⚠ Could not list existing rules: {list_err}")
            print()

        # ── 2. Create the correct dispatch rule ────────────────────────────────
        # SIPDispatchRuleDirect: newer SDK removed room_prefix and pin fields.
        # Just use SIPDispatchRuleDirect() with no arguments.
        print("Creating dispatch rule...")
        rule = await lkapi.sip.create_sip_dispatch_rule(
            api.CreateSIPDispatchRuleRequest(
                trunk_ids=[INBOUND_TRUNK_ID],
                rule=api.SIPDispatchRule(
                    dispatch_rule_direct=api.SIPDispatchRuleDirect()
                ),
                # Route all inbound calls to the named AI agent worker
                dispatch=api.RoomAgentDispatch(
                    agent_name=AGENT_NAME,
                    metadata=AGENT_METADATA,
                ),
            )
        )

        print()
        print("✅ Dispatch rule created successfully!")
        print(f"   Rule ID   : {rule.sip_dispatch_rule_id}")
        print(f"   Trunk IDs : {rule.trunk_ids}")
        print()
        print("Inbound SIP calls will now be dispatched to 'realzentic-dubai-agent'.")
        print("Test: call your Vobiz number and watch: docker compose logs ai-agent -f")

    except Exception as exc:
        print(f"❌ Error creating dispatch rule: {exc}")
        import traceback
        traceback.print_exc()
    finally:
        await lkapi.aclose()


if __name__ == "__main__":
    asyncio.run(main())
