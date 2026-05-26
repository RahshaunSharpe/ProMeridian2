#!/usr/bin/env python3
"""
Pro Meridian — Lead Generation Pipeline
=========================================
Usage:
  python main.py run              Run the full pipeline once now
  python main.py schedule         Start the scheduler (runs on cron)
  python main.py test             Test all integrations (no data written)
  python main.py analyze-only     Re-analyze leads already in the sheet
  python main.py dataset <ID>     Pull an existing Apify dataset by ID

Options:
  --actor-input '{"key":"val"}'   Override APIFY_ACTOR_INPUT for this run
  --dry-run                       Analyze & score but don't write to sheet
  --no-notify                     Skip notifications this run
"""

import argparse
import json
import logging
import sys
from datetime import datetime

# ── Logging setup ────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("meridian.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def run_pipeline(
    actor_input_override: dict | None = None,
    dry_run: bool = False,
    notify: bool = True,
    dataset_id: str | None = None,
):
    """Full end-to-end pipeline: scrape → clean → analyze → store → notify."""

    from config import Config
    from scraper import ApifyScraper
    from cleaner import LeadCleaner
    from analyzer import LeadAnalyzer
    from sheets import SheetsDB
    from notifier import Notifier

    logger.info("=" * 60)
    logger.info("  PRO MERIDIAN — Pipeline Start")
    logger.info(f"  {datetime.now().strftime('%B %d, %Y  %I:%M %p')}")
    logger.info("=" * 60)

    # ── 1. Validate config ──────────────────────────────────
    missing = Config.validate()
    if missing:
        logger.error(f"Missing required config: {', '.join(missing)}")
        logger.error("Copy .env.example → .env and fill in values.")
        sys.exit(1)

    # ── 2. Load existing leads (for dedup) ──────────────────
    logger.info("\n[1/5] Loading existing leads from Google Sheets…")
    db = SheetsDB()
    existing_leads = db.get_existing_leads()

    # ── 3. Scrape ───────────────────────────────────────────
    logger.info("\n[2/5] Scraping leads via Apify…")
    scraper = ApifyScraper()

    if dataset_id:
        raw_items = scraper.fetch_dataset(dataset_id)
    else:
        raw_items = scraper.run_actor(actor_input=actor_input_override)

    if not raw_items:
        logger.warning("No items returned from Apify. Exiting.")
        return

    # ── 4. Clean & deduplicate ──────────────────────────────
    logger.info("\n[3/5] Cleaning and deduplicating…")
    cleaner = LeadCleaner(existing_leads=existing_leads)
    clean_leads = cleaner.clean(raw_items, source=Config.APIFY_ACTOR_ID)

    if not clean_leads:
        logger.info("No new leads after deduplication. All done.")
        return

    logger.info(f"  {len(clean_leads)} new unique leads ready for analysis.")

    # ── 5. Analyze with Claude ──────────────────────────────
    logger.info("\n[4/5] Analyzing leads with Claude AI…")
    analyzer = LeadAnalyzer()
    analyzed_leads = analyzer.analyze_batch(clean_leads)

    hot_leads = [l for l in analyzed_leads if (l.get("score") or 0) >= Config.HOT_LEAD_THRESHOLD]
    warm_leads = [l for l in analyzed_leads if 5 <= (l.get("score") or 0) < Config.HOT_LEAD_THRESHOLD]
    cold_leads = [l for l in analyzed_leads if (l.get("score") or 0) < 5]

    logger.info(f"\n  Results:")
    logger.info(f"    🔥 HOT  (≥{Config.HOT_LEAD_THRESHOLD}): {len(hot_leads)}")
    logger.info(f"    🟡 WARM (5-{Config.HOT_LEAD_THRESHOLD-1}): {len(warm_leads)}")
    logger.info(f"    🧊 COLD (<5):  {len(cold_leads)}")

    # ── 6. Save to Google Sheets ────────────────────────────
    if not dry_run:
        logger.info("\n[5/5] Saving to Google Sheets…")
        written = db.append_leads(analyzed_leads)
        logger.info(f"  Saved {written} leads to sheet.")
    else:
        logger.info("\n[5/5] DRY RUN — skipping sheet write.")
        for lead in analyzed_leads[:10]:
            logger.info(
                f"  [{lead.get('score', 0):2d}] {lead.get('tier', '?'):<4}  "
                f"{lead.get('business_name', 'Unknown')}"
            )

    # ── 7. Notify on HOT leads ──────────────────────────────
    if hot_leads and notify and not dry_run:
        logger.info(f"\nSending HOT lead notification ({len(hot_leads)} leads)…")
        notifier = Notifier()
        sent = notifier.notify_hot_leads(hot_leads)
        if sent:
            hot_ids = [l["id"] for l in hot_leads]
            db.mark_notified(hot_ids)
    elif hot_leads and dry_run:
        logger.info("\nDRY RUN — would notify about:")
        for lead in hot_leads:
            logger.info(
                f"  🔥 [{lead.get('score')}] {lead.get('business_name')}  "
                f"— {lead.get('outreach_angle', '')[:80]}"
            )

    logger.info("\n" + "=" * 60)
    logger.info("  Pipeline complete.")
    logger.info("=" * 60 + "\n")


def test_connections():
    """Test every integration without writing any data."""
    from config import Config
    from scraper import ApifyScraper
    from sheets import SheetsDB
    from notifier import Notifier
    import anthropic

    print("\nTesting integrations…\n")

    # Config
    missing = Config.validate()
    if missing:
        print(f"  ❌ Config: missing {', '.join(missing)}")
    else:
        print("  ✅ Config: all required values present")

    # Anthropic
    try:
        client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=Config.CLAUDE_MODEL,
            max_tokens=10,
            messages=[{"role": "user", "content": "Say OK"}],
        )
        print(f"  ✅ Claude API: connected ({Config.CLAUDE_MODEL})")
    except Exception as e:
        print(f"  ❌ Claude API: {e}")

    # Google Sheets
    try:
        db = SheetsDB()
        leads = db.get_existing_leads()
        print(f"  ✅ Google Sheets: connected ({len(leads)} existing leads)")
    except Exception as e:
        print(f"  ❌ Google Sheets: {e}")

    # Apify (just validate token, don't run actor)
    try:
        from apify_client import ApifyClient
        client = ApifyClient(Config.APIFY_TOKEN)
        user = client.user().get()
        # Newer apify-client returns an object, older returns a dict
        if isinstance(user, dict):
            plan = user.get('plan', {}).get('id', 'unknown')
        else:
            plan = getattr(getattr(user, 'plan', None), 'id', 'unknown')
        print(f"  ✅ Apify: connected (plan: {plan})")
    except Exception as e:
        print(f"  ❌ Apify: {e}")

    # Email
    try:
        import smtplib
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
        print(f"  ✅ Email (Gmail SMTP): connected as {Config.SMTP_USER}")
    except Exception as e:
        print(f"  ❌ Email: {e}")

    # Twilio (optional)
    if Config.TWILIO_ACCOUNT_SID:
        try:
            from twilio.rest import Client
            client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)
            client.api.accounts(Config.TWILIO_ACCOUNT_SID).fetch()
            print(f"  ✅ Twilio SMS: connected")
        except Exception as e:
            print(f"  ❌ Twilio: {e}")
    else:
        print("  ⏭  Twilio: not configured (email-only mode)")

    print()


def main():
    parser = argparse.ArgumentParser(
        prog="meridian",
        description="Pro Meridian Lead Generation Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    subparsers = parser.add_subparsers(dest="command")

    # ── run ────────────────────────────────────────────────
    run_parser = subparsers.add_parser("run", help="Run the pipeline once now")
    run_parser.add_argument("--actor-input", type=str, help="Override actor input JSON")
    run_parser.add_argument("--dry-run", action="store_true", help="Don't write to sheet")
    run_parser.add_argument("--no-notify", action="store_true", help="Skip notifications")

    # ── schedule ───────────────────────────────────────────
    subparsers.add_parser("schedule", help="Start the scheduler")

    # ── test ───────────────────────────────────────────────
    subparsers.add_parser("test", help="Test all integrations")

    # ── dataset ────────────────────────────────────────────
    ds_parser = subparsers.add_parser("dataset", help="Pull existing Apify dataset")
    ds_parser.add_argument("dataset_id", type=str)
    ds_parser.add_argument("--dry-run", action="store_true")
    ds_parser.add_argument("--no-notify", action="store_true")

    args = parser.parse_args()

    if not args.command or args.command == "run":
        actor_input = None
        if hasattr(args, "actor_input") and args.actor_input:
            try:
                actor_input = json.loads(args.actor_input)
            except json.JSONDecodeError:
                logger.error("--actor-input must be valid JSON")
                sys.exit(1)

        run_pipeline(
            actor_input_override=actor_input,
            dry_run=getattr(args, "dry_run", False),
            notify=not getattr(args, "no_notify", False),
        )

    elif args.command == "schedule":
        from scheduler import start_scheduler
        logger.info("Starting Pro Meridian scheduler…")
        start_scheduler(run_pipeline)

    elif args.command == "test":
        test_connections()

    elif args.command == "dataset":
        run_pipeline(
            dataset_id=args.dataset_id,
            dry_run=getattr(args, "dry_run", False),
            notify=not getattr(args, "no_notify", False),
        )


if __name__ == "__main__":
    main()
