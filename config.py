import json
import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ── Apify ──────────────────────────────────
    APIFY_TOKEN: str = os.getenv("APIFY_TOKEN", "")
    APIFY_ACTOR_ID: str = os.getenv("APIFY_ACTOR_ID", "apify/google-maps-scraper")
    _raw_input: str = os.getenv("APIFY_ACTOR_INPUT", "{}")
    try:
        APIFY_ACTOR_INPUT: dict = json.loads(_raw_input)
    except json.JSONDecodeError:
        APIFY_ACTOR_INPUT = {}

    # ── Anthropic ──────────────────────────────
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    # ── Google Sheets ──────────────────────────
    GOOGLE_SHEETS_CREDENTIALS: str = os.getenv("GOOGLE_SHEETS_CREDENTIALS", "credentials.json")
    GOOGLE_SHEET_ID: str = os.getenv("GOOGLE_SHEET_ID", "")
    GOOGLE_SHEET_NAME: str = os.getenv("GOOGLE_SHEET_NAME", "Leads")

    # ── Email ──────────────────────────────────
    NOTIFICATION_EMAIL: str = os.getenv("NOTIFICATION_EMAIL", "")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")

    # ── Twilio (optional) ──────────────────────
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_FROM_NUMBER: str = os.getenv("TWILIO_FROM_NUMBER", "")
    TWILIO_TO_NUMBER: str = os.getenv("TWILIO_TO_NUMBER", "")

    # ── Scoring ────────────────────────────────
    HOT_LEAD_THRESHOLD: int = int(os.getenv("HOT_LEAD_THRESHOLD", "8"))

    # ── Niches & Services ──────────────────────
    TARGET_NICHES: list[str] = [
        n.strip() for n in os.getenv("TARGET_NICHES", "home services").split(",") if n.strip()
    ]
    YOUR_SERVICES: list[str] = [
        s.strip() for s in os.getenv("YOUR_SERVICES", "web design,SEO").split(",") if s.strip()
    ]

    # ── Scheduler ─────────────────────────────
    SCHEDULE_INTERVAL_HOURS: int = int(os.getenv("SCHEDULE_INTERVAL_HOURS", "24"))
    SCHEDULE_TIME: str = os.getenv("SCHEDULE_TIME", "09:00")

    @classmethod
    def validate(cls) -> list[str]:
        """Return list of missing required config values."""
        missing = []
        if not cls.APIFY_TOKEN:
            missing.append("APIFY_TOKEN")
        if not cls.ANTHROPIC_API_KEY:
            missing.append("ANTHROPIC_API_KEY")
        if not cls.GOOGLE_SHEET_ID:
            missing.append("GOOGLE_SHEET_ID")
        if not cls.SMTP_USER or not cls.SMTP_PASSWORD:
            missing.append("SMTP_USER / SMTP_PASSWORD")
        return missing
