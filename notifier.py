"""
Notification module for HOT leads.

Primary:  Gmail SMTP (free — requires App Password)
Optional: Twilio SMS (~$0.008/msg — set TWILIO_* env vars to enable)

Hot leads get a digest email/SMS with:
  - Business name, phone, website
  - Score & tier
  - Why it's hot (summary)
  - Specific outreach angle
"""

import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from config import Config

logger = logging.getLogger(__name__)


class Notifier:
    def __init__(self):
        self._twilio_enabled = bool(
            Config.TWILIO_ACCOUNT_SID
            and Config.TWILIO_AUTH_TOKEN
            and Config.TWILIO_FROM_NUMBER
            and Config.TWILIO_TO_NUMBER
        )

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def notify_hot_leads(self, hot_leads: list[dict]) -> bool:
        """Send notifications for all hot leads. Returns True if at least one succeeded."""
        if not hot_leads:
            logger.info("No HOT leads to notify about.")
            return False

        logger.info(f"Sending notifications for {len(hot_leads)} HOT lead(s)…")

        email_sent = self._send_email(hot_leads)

        sms_sent = False
        if self._twilio_enabled:
            sms_sent = self._send_sms(hot_leads)

        return email_sent or sms_sent

    # ──────────────────────────────────────────────────────────
    # Email
    # ──────────────────────────────────────────────────────────

    def _send_email(self, hot_leads: list[dict]) -> bool:
        if not Config.SMTP_USER or not Config.SMTP_PASSWORD:
            logger.warning("SMTP credentials not configured — skipping email.")
            return False

        try:
            subject = f"🔥 Pro Meridian: {len(hot_leads)} HOT Lead(s) Found — {datetime.now().strftime('%b %d, %Y')}"
            html_body = self._build_email_html(hot_leads)
            text_body = self._build_email_text(hot_leads)

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = Config.SMTP_USER
            msg["To"] = Config.NOTIFICATION_EMAIL or Config.SMTP_USER

            msg.attach(MIMEText(text_body, "plain"))
            msg.attach(MIMEText(html_body, "html"))

            with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                server.sendmail(
                    Config.SMTP_USER,
                    Config.NOTIFICATION_EMAIL or Config.SMTP_USER,
                    msg.as_string(),
                )

            logger.info(f"Email sent to {Config.NOTIFICATION_EMAIL or Config.SMTP_USER}")
            return True

        except Exception as e:
            logger.error(f"Email failed: {e}")
            return False

    def _build_email_html(self, leads: list[dict]) -> str:
        cards = ""
        for lead in leads:
            score = lead.get("score", "?")
            name = lead.get("business_name", "Unknown")
            phone = lead.get("phone", "N/A")
            email = lead.get("email", "N/A")
            website = lead.get("website", "N/A")
            city = lead.get("city", "")
            state = lead.get("state", "")
            category = lead.get("category", "N/A")
            summary = lead.get("summary", "")
            outreach = lead.get("outreach_angle", "")
            best_service = lead.get("best_service", "")
            pain_points = lead.get("key_pain_points", "")
            reviews = lead.get("review_count", 0)
            rating = lead.get("rating", "N/A")

            website_link = f'<a href="{website}">{website}</a>' if website != "N/A" else "N/A"
            location = f"{city}, {state}".strip(", ") or "N/A"

            cards += f"""
            <div style="background:#fff;border:2px solid #ff4444;border-radius:12px;
                        padding:24px;margin-bottom:24px;font-family:Arial,sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h2 style="margin:0;color:#1a1a1a;">{name}</h2>
                    <span style="background:#ff4444;color:white;border-radius:50%;
                                 width:48px;height:48px;display:flex;align-items:center;
                                 justify-content:center;font-size:20px;font-weight:bold;">
                        {score}
                    </span>
                </div>
                <p style="color:#666;margin:4px 0 16px;">{category} · {location}</p>

                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <tr>
                        <td style="padding:4px 0;color:#555;width:100px;"><strong>Phone</strong></td>
                        <td style="padding:4px 0;">{phone}</td>
                        <td style="padding:4px 0;color:#555;width:100px;"><strong>Email</strong></td>
                        <td style="padding:4px 0;">{email}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;color:#555;"><strong>Website</strong></td>
                        <td colspan="3" style="padding:4px 0;">{website_link}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;color:#555;"><strong>Rating</strong></td>
                        <td style="padding:4px 0;">{rating} ⭐ ({reviews} reviews)</td>
                        <td style="padding:4px 0;color:#555;"><strong>Best Pitch</strong></td>
                        <td style="padding:4px 0;color:#2e7d32;">{best_service}</td>
                    </tr>
                </table>

                <div style="background:#fff8f8;border-left:4px solid #ff4444;
                            padding:12px 16px;margin-bottom:12px;border-radius:0 8px 8px 0;">
                    <strong style="color:#c62828;">Why It's HOT:</strong><br>
                    <span style="color:#333;">{summary}</span>
                </div>

                <div style="background:#f0f7ff;border-left:4px solid #1565c0;
                            padding:12px 16px;margin-bottom:12px;border-radius:0 8px 8px 0;">
                    <strong style="color:#1565c0;">Outreach Angle:</strong><br>
                    <span style="color:#333;font-style:italic;">"{outreach}"</span>
                </div>

                {"<div style='color:#666;font-size:13px;'><strong>Pain Points:</strong> " + pain_points + "</div>" if pain_points else ""}
            </div>
            """

        return f"""
        <html><body style="background:#f5f5f5;padding:20px;">
            <div style="max-width:700px;margin:0 auto;">
                <h1 style="color:#ff4444;font-family:Arial;">
                    🔥 Pro Meridian — {len(leads)} HOT Lead(s)
                </h1>
                <p style="color:#666;">
                    Generated: {datetime.now().strftime("%B %d, %Y at %I:%M %p")}
                </p>
                {cards}
            </div>
        </body></html>
        """

    def _build_email_text(self, leads: list[dict]) -> str:
        lines = [
            f"PRO MERIDIAN — {len(leads)} HOT LEAD(S) FOUND",
            f"Generated: {datetime.now().strftime('%B %d, %Y at %I:%M %p')}",
            "=" * 60,
        ]
        for i, lead in enumerate(leads, 1):
            lines += [
                f"\n[{i}] {lead.get('business_name', 'Unknown')}  |  Score: {lead.get('score', '?')}/10",
                f"    Phone:    {lead.get('phone', 'N/A')}",
                f"    Email:    {lead.get('email', 'N/A')}",
                f"    Website:  {lead.get('website', 'N/A')}",
                f"    Category: {lead.get('category', 'N/A')}",
                f"    Location: {lead.get('city', '')}, {lead.get('state', '')}",
                f"    Reviews:  {lead.get('review_count', 0)} ({lead.get('rating', 'N/A')} stars)",
                f"\n    WHY HOT:  {lead.get('summary', '')}",
                f"\n    OUTREACH: {lead.get('outreach_angle', '')}",
                f"    PITCH:    {lead.get('best_service', '')}",
                "-" * 60,
            ]
        return "\n".join(lines)

    # ──────────────────────────────────────────────────────────
    # SMS (Twilio)
    # ──────────────────────────────────────────────────────────

    def _send_sms(self, hot_leads: list[dict]) -> bool:
        try:
            from twilio.rest import Client  # noqa: PLC0415
            client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)

            # Keep SMS short — just names, scores, phone numbers
            lines = [f"🔥 PRO MERIDIAN: {len(hot_leads)} HOT LEAD(S)"]
            for lead in hot_leads[:5]:  # max 5 in SMS
                lines.append(
                    f"\n{lead.get('business_name', 'Unknown')} [{lead.get('score', '?')}/10]\n"
                    f"📞 {lead.get('phone', 'N/A')}\n"
                    f"💡 {lead.get('best_service', '')}"
                )
            lines.append("\nFull details in your email.")
            body = "\n".join(lines)

            client.messages.create(
                body=body,
                from_=Config.TWILIO_FROM_NUMBER,
                to=Config.TWILIO_TO_NUMBER,
            )
            logger.info(f"SMS sent to {Config.TWILIO_TO_NUMBER}")
            return True

        except ImportError:
            logger.warning("twilio package not installed — skipping SMS.")
            return False
        except Exception as e:
            logger.error(f"SMS failed: {e}")
            return False
