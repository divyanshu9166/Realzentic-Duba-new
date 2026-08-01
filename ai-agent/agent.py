"""
Realzentic Dubai AI Calling Agent (livekit-agents v1.5.x)
Uses LiveKit + Deepgram STT/TTS + Groq/OpenAI LLM + Vobiz SIP
Handles both inbound and outbound calls for Dubai real-estate enquiries
"""

import asyncio
import json
import logging
import os
import time
from typing import Optional

import aiohttp
from dotenv import load_dotenv
from livekit import api
from livekit.agents import AutoSubscribe, JobContext, JobProcess, WorkerOptions, cli, llm
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.voice.room_io import AudioInputOptions, AudioOutputOptions, RoomOptions
from livekit.plugins import deepgram, noise_cancellation, openai, silero

from config import (
    AGENT_NAME,
    DEEPGRAM_TTS_MODEL,
    DEEPGRAM_TTS_SAMPLE_RATE,
    GROQ_MAX_TOKENS,
    GROQ_MODEL,
    GROQ_TEMPERATURE,
    GROQ_TOP_P,
    build_outbound_greeting,
    INBOUND_SYSTEM_PROMPT,
    OPENAI_FALLBACK_MODEL,
    OUTBOUND_GREETING_PROMPT,
    OUTBOUND_SYSTEM_PROMPT,
    STT_LANGUAGE,
    STT_MODEL,
    TTS_PROVIDER,
)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger("realzentic-dubai-agent")
logger.setLevel(logging.INFO)

# ─── Config ───
CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000")
CRM_API_SECRET = os.getenv("CRM_API_SECRET", "")
MAX_CALL_DURATION = int(os.getenv("MAX_CALL_DURATION_SECONDS", "600"))
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "")
OUTBOUND_SIP_TRUNK_ID = os.getenv("OUTBOUND_SIP_TRUNK_ID") or os.getenv("VOBIZ_SIP_TRUNK_ID", "")


# ─── Tools ───

class RealzenticDubaiTools(llm.ToolContext):
    def __init__(self, ctx: JobContext, phone_number: Optional[str] = None) -> None:
        super().__init__(tools=[])
        self._ctx = ctx
        self._phone_number = phone_number

    @llm.function_tool(
        description=(
            "Transfer the call to a human team member. "
            "Call this tool in TWO situations: "
            "(1) The customer asks to speak to a person/human/manager, OR "
            "(2) The customer asks something you cannot answer (unknown price, policy, complaint, etc.). "
            "Always say a brief goodbye sentence BEFORE calling this tool, for example: "
            "'I will connect you with a property consultant now.'"
        )
    )
    async def transfer_call(self, destination: Optional[str] = None) -> str:
        target = destination or DEFAULT_TRANSFER_NUMBER
        if not target:
            return "No transfer number configured. Apologise and offer to have someone call them back."

        sip_domain = os.getenv("VOBIZ_SIP_DOMAIN") or os.getenv("TWILIO_SIP_DOMAIN", "")
        if not target.startswith(("sip:", "tel:")):
            clean = target.replace("tel:", "").replace("sip:", "").replace(" ", "")
            if sip_domain:
                target = f"sip:{clean}@{sip_domain}"
            else:
                target = f"tel:{clean}"
        elif target.startswith("tel:") and sip_domain:
            clean = target.replace("tel:", "").replace("sip:", "").replace(" ", "")
            target = f"sip:{clean}@{sip_domain}"

        participant_identity = f"sip_{self._phone_number}" if self._phone_number else None
        if not participant_identity:
            for p in self._ctx.room.remote_participants.values():
                if p.identity.startswith("sip_"):
                    participant_identity = p.identity
                    break
        if not participant_identity:
            for p in self._ctx.room.remote_participants.values():
                participant_identity = p.identity
                break

        if not participant_identity:
            return "Transfer failed: could not identify the remote participant."

        logger.info("Transferring call | participant=%s | target=%s", participant_identity, target)
        try:
            await self._ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self._ctx.room.name,
                    participant_identity=participant_identity,
                    transfer_to=target,
                    play_dialtone=False,
                )
            )
            return "Transfer initiated successfully."
        except Exception as exc:
            logger.error("Transfer failed: %s", exc)
            return f"Transfer failed: {exc}"

    @llm.function_tool(
        description=(
            "Schedule a property viewing or appointment for the customer. "
            "Only call this tool AFTER you have collected and verbally confirmed with the customer: "
            "their full name, phone number (digits only, e.g. +971501234567), "
            "date in YYYY-MM-DD format, and time (e.g. '11:00 AM'). "
            "NEVER call this with placeholder values like 'unknown'."
        )
    )
    async def schedule_appointment(
        self,
        customer_name: str,
        phone: str,
        date: str,
        time: str,
            purpose: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> str:
        # Guard against placeholder values the LLM sometimes sends
        invalid = {"unknown", "none", "n/a", "tbd", "", "null"}
        if any(v.strip().lower() in invalid for v in [customer_name, phone, date, time]):
            return (
                "I'm missing some details. Please ask the customer for their "
                "phone number, preferred date (in YYYY-MM-DD format), and time before calling this tool."
            )

        # ── Step 1: Check slot availability before booking ──────────────────
        try:
            async with aiohttp.ClientSession() as http:
                async with http.get(
                    f"{CRM_API_URL}/api/appointments/check-slot",
                    params={"date": date, "time": time},
                    headers={"x-api-secret": CRM_API_SECRET},
                ) as resp:
                    if resp.status == 200:
                        slot_data = await resp.json()
                        if not slot_data.get("available", True):
                            suggestions = slot_data.get("suggestions", [])
                            if suggestions:
                                suggestion_str = ", ".join(suggestions)
                                return (
                                    f"That slot ({time} on {date}) is already booked. "
                                    f"Please ask the customer to choose from these available times: {suggestion_str}. "
                                    f"Once they confirm a new time, call this tool again with the updated time."
                                )
                            else:
                                return (
                                    f"That slot ({time} on {date}) is fully booked and no alternatives are available. "
                                    f"Please ask the customer to choose a different date."
                                )
        except Exception as exc:
            logger.warning("Slot check failed (will proceed with booking): %s", exc)
            # Non-critical: if the check fails, proceed optimistically

        # ── Step 2: Create the appointment ──────────────────────────────────
        payload = {
            "customerName": customer_name,
            "phone": phone,
            "date": date,
            "time": time,
            "purpose": purpose or "Property Viewing",
            "notes": notes or f"Booked via AI Agent ({AGENT_NAME}) during call",
        }
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(
                    f"{CRM_API_URL}/api/appointments/create",
                    json=payload,
                    headers={"Content-Type": "application/json", "x-api-secret": CRM_API_SECRET},
                ) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        appt_id = result.get("data", {}).get("id")
                        logger.info("Appointment created: id=%s date=%s time=%s", appt_id, date, time)
                        return (
                            f"Appointment confirmed and saved successfully. "
                            f"{purpose or 'Property Viewing'} on {date} at {time} for {customer_name}."
                        )
                    else:
                        text = await resp.text()
                        logger.error("Appointment creation failed (%s): %s", resp.status, text)
                        return "I was unable to save the appointment due to a system error. Please ask the customer to call back to confirm."
        except Exception as exc:
            logger.error("schedule_appointment error: %s", exc)
            return "There was a technical issue saving the appointment. Please ask the customer to call back to confirm."

    @llm.function_tool(
        description="End the call politely once the conversation is complete. Always say goodbye before calling this."
    )
    async def end_call(self) -> str:
        logger.info("end_call tool invoked — shutting down.")
        self._ctx.shutdown()
        return "Call ended."


# ─── CRM logging ───

async def log_call_to_crm(
    called_number: str,
    duration_seconds: float,
    transcript: str,
    call_type: str = "outbound",
    purpose: str = "",
    outcome: str = "",
    customer_name: str = "",
) -> None:
    payload = {
        "customerName": customer_name or "Unknown Customer",
        "phone": called_number or "Unknown",
        "direction": "INBOUND" if call_type == "inbound" else "OUTBOUND",
        "status": "COMPLETED",
        "durationSec": round(duration_seconds),
        "agent": f"AI Agent - {AGENT_NAME}",
        "purpose": purpose or f"AI {call_type} call",
        "outcome": outcome or "Completed",
        "notes": f"AI-handled {call_type} call",
        "recording": False,
        "transcript": transcript,
        "callType": f"ai_{call_type}",
    }
    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(
                f"{CRM_API_URL}/api/calls/log",
                json=payload,
                headers={"Content-Type": "application/json", "x-api-secret": CRM_API_SECRET},
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    logger.info("Call logged to CRM: id=%s", result.get("data", {}).get("id"))
                else:
                    logger.error("CRM log failed (%s): %s", resp.status, await resp.text())
    except Exception as e:
        logger.error("Failed to log call to CRM: %s", e)


# ─── Worker ───

def prewarm(proc: JobProcess) -> None:
    # Load with telephony-tuned settings: higher threshold + longer silence to
    # avoid SIP background noise triggering false interruptions
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.65,
    )
    logger.info("Silero VAD pre-warmed (telephony profile).")


async def entrypoint(ctx: JobContext) -> None:
    # Parse metadata
    phone_number: Optional[str] = None
    call_reason = "follow-up"
    call_type = "outbound"
    customer_name = ""

    try:
        if ctx.job.metadata:
            meta = json.loads(ctx.job.metadata)
            raw_phone = meta.get("phone_number", "")
            phone_number = raw_phone.replace(" ", "") if raw_phone else None
            call_reason = meta.get("reason", "follow-up")
            call_type = meta.get("call_type", "outbound")
            customer_name = meta.get("customer_name", "")
    except Exception:
        logger.warning("No valid JSON metadata — browser test mode.")

    logger.info("Job started | type=%s | number=%s | reason=%s", call_type, phone_number or "WEB-TEST", call_reason)

    # Connect to LiveKit room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to room: %s", ctx.room.name)

    call_start = time.time()
    transcript_lines: list[str] = []

    # VAD — use prewarm instance (telephony-tuned settings already applied)
    vad_instance = ctx.proc.userdata.get("vad") or silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.65,
    )

    # Tools
    tools_ctx = RealzenticDubaiTools(ctx, phone_number)

    # System prompt
    system_prompt = OUTBOUND_SYSTEM_PROMPT if call_type == "outbound" else INBOUND_SYSTEM_PROMPT

    # LLM
    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key:
        llm_instance = openai.LLM(
            model=GROQ_MODEL,
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_key,
            temperature=GROQ_TEMPERATURE,
            top_p=GROQ_TOP_P,
            max_completion_tokens=GROQ_MAX_TOKENS,
        )
        logger.info("LLM configured | provider=groq | model=%s", GROQ_MODEL)
    else:
        llm_instance = openai.LLM(model=OPENAI_FALLBACK_MODEL)
        logger.warning("GROQ_API_KEY missing — falling back to %s", OPENAI_FALLBACK_MODEL)

    # Build agent — no VAD here; session owns VAD to avoid double processing.
    # English Deepgram Aura is the deliberate Dubai launch choice. A new TTS
    # provider must be explicitly integrated and tested rather than inheriting
    # the legacy provider through an environment variable.
    if TTS_PROVIDER != "deepgram":
        raise RuntimeError(
            f"Unsupported TTS_PROVIDER '{TTS_PROVIDER}'. Realzentic Dubai currently supports deepgram."
        )

    logger.info(
        "STT configured | provider=deepgram | model=%s | language=%s",
        STT_MODEL,
        STT_LANGUAGE,
    )
    logger.info(
        "TTS configured | provider=deepgram | model=%s | sample_rate=%s",
        DEEPGRAM_TTS_MODEL,
        DEEPGRAM_TTS_SAMPLE_RATE,
    )

    tts_instance = deepgram.TTS(
        model=DEEPGRAM_TTS_MODEL,
        sample_rate=DEEPGRAM_TTS_SAMPLE_RATE,
    )

    agent = Agent(
        instructions=system_prompt,
        stt=deepgram.STT(model=STT_MODEL, language=STT_LANGUAGE),
        llm=llm_instance,
        tts=tts_instance,
        tools=list(tools_ctx.function_tools.values()),
        allow_interruptions=True,
        min_endpointing_delay=0.5,  # 500ms — comfortable pause for phone lines
    )

    # Build session — VAD lives here only
    session = AgentSession(
        vad=vad_instance,
        allow_interruptions=True,
        min_interruption_duration=1.2,   # require 1.2s of speech before interrupting
        min_interruption_words=3,        # require 3 words before interrupting
        min_endpointing_delay=0.5,       # match agent setting
    )

    # Transcript collector
    @session.on("conversation_item_added")
    def on_item(ev) -> None:
        msg = ev.item
        if not isinstance(msg, llm.ChatMessage):
            return
        text = (msg.text_content or "").strip()
        if not text:
            return
        if msg.role == "user":
            transcript_lines.append(f"Customer: {text}")
            logger.info("Customer: %s", text)
        elif msg.role == "assistant":
            transcript_lines.append(f"Agent: {text}")
            logger.info("%s: %s", AGENT_NAME, text)

    session_closed = asyncio.Event()

    @session.on("close")
    def on_close(ev) -> None:
        logger.info("Session closed.")
        session_closed.set()

    # Start session FIRST — before dialing
    await session.start(
        agent,
        room=ctx.room,
        room_options=RoomOptions(
            audio_input=AudioInputOptions(
                sample_rate=8000,
                num_channels=1,
                noise_cancellation=noise_cancellation.BVCTelephony(),
            ),
            audio_output=AudioOutputOptions(sample_rate=8000, num_channels=1),
            close_on_disconnect=True,
        ),
    )
    logger.info("Voice pipeline ready.")

    # Outbound: dial customer, wait for answer, then greet
    if call_type == "outbound" and phone_number and OUTBOUND_SIP_TRUNK_ID:
        logger.info("Dialling %s via trunk %s ...", phone_number, OUTBOUND_SIP_TRUNK_ID)
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=OUTBOUND_SIP_TRUNK_ID,
                    sip_call_to=phone_number,
                    participant_identity=f"sip_{phone_number}",
                    wait_until_answered=True,  # block until customer picks up
                )
            )
            logger.info("Call answered — sending greeting via TTS.")
            await session.say(
                build_outbound_greeting(call_reason),
                allow_interruptions=False,
            )
            logger.info("Greeting playback completed.")
        except Exception as exc:
            logger.error("Outbound call failed: %s", exc)
            ctx.shutdown()
            return

    elif call_type == "outbound" and not OUTBOUND_SIP_TRUNK_ID:
        logger.error("OUTBOUND_SIP_TRUNK_ID not set — cannot dial.")
        ctx.shutdown()
        return

    else:
        # Inbound or browser test — participant already in room
        logger.info("Inbound/browser mode — waiting for participant...")
        await ctx.wait_for_participant()
        await session.say(
            f"Hello, you have reached Realzentic Dubai. This is {AGENT_NAME}. How may I help with your property enquiry today?",
            allow_interruptions=True,
        )

    # Max duration guard
    async def enforce_max_duration() -> None:
        await asyncio.sleep(MAX_CALL_DURATION)
        logger.warning("Max call duration reached — ending call.")
        session.say(
            "I'm sorry, we've reached the maximum call duration. Please don't hesitate to call us back. Have a wonderful day — goodbye!",
            allow_interruptions=False,
        )
        await asyncio.sleep(6)
        ctx.shutdown()

    max_duration_task = asyncio.create_task(enforce_max_duration())

    # Wait for session to close
    try:
        await session_closed.wait()
    finally:
        max_duration_task.cancel()
        call_duration = time.time() - call_start
        full_transcript = "\n".join(transcript_lines)
        logger.info("Call ended | duration=%.1fs | lines=%d", call_duration, len(transcript_lines))

        await log_call_to_crm(
            called_number=phone_number or "web-test",
            duration_seconds=call_duration,
            transcript=full_transcript,
            call_type=call_type,
            purpose=call_reason,
            customer_name=customer_name,
        )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="realzentic-dubai-agent",
        ),
    )
