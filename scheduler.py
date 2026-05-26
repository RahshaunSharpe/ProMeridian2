"""
APScheduler-based trigger system — no N8N needed.

Two modes:
  • Daily at a fixed time  (SCHEDULE_TIME=09:00)
  • Every N hours          (SCHEDULE_INTERVAL_HOURS=24)

The scheduler lives in-process, so keep the script running with:
    python main.py schedule
"""

import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from config import Config

logger = logging.getLogger(__name__)


def start_scheduler(pipeline_fn):
    """
    Start the blocking scheduler.

    pipeline_fn: callable that runs the full lead gen pipeline.
                 Called with no arguments.
    """
    scheduler = BlockingScheduler(timezone="America/New_York")

    # Parse the time string from config (e.g. "09:00")
    try:
        hour, minute = Config.SCHEDULE_TIME.split(":")
        trigger = CronTrigger(hour=int(hour), minute=int(minute))
        mode_label = f"daily at {Config.SCHEDULE_TIME}"
    except Exception:
        # Fallback to interval mode
        trigger = IntervalTrigger(hours=Config.SCHEDULE_INTERVAL_HOURS)
        mode_label = f"every {Config.SCHEDULE_INTERVAL_HOURS} hour(s)"

    scheduler.add_job(
        func=pipeline_fn,
        trigger=trigger,
        id="meridian_pipeline",
        name="Pro Meridian Lead Gen Pipeline",
        misfire_grace_time=3600,  # Run if missed by up to 1 hour
        coalesce=True,            # Don't stack up missed runs
    )

    logger.info(f"Scheduler started — will run {mode_label}.")
    logger.info("Press Ctrl+C to stop.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped.")
