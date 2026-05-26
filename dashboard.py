"""
Pro Meridian Dashboard — FastAPI backend
Run: python meridian.py
Opens at: http://localhost:8000
"""

import csv
import io
import logging
import threading
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from analyzer import LeadAnalyzer
from cleaner import LeadCleaner
from coach import analyze_call, analyze_batch, get_all_reviews, get_weekly_summary, delete_review
from config import Config
from notifier import Notifier
from scraper import ApifyScraper
from sheets import SheetsDB

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Pro Meridian — Lead Intelligence")
app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Scraper state (in-memory, single-user local app) ──────────────────────
_state: dict = {
    "running": False,
    "status": "idle",
    "message": "Ready",
    "started_at": None,
    "completed_at": None,
    "leads_found": 0,
    "hot_count": 0,
}
_lock = threading.Lock()


def _set_state(**kwargs):
    with _lock:
        _state.update(kwargs)


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/api/leads")
async def get_leads(tier: str = "all", status: str = "all", search: str = ""):
    db = SheetsDB()
    leads = db.get_existing_leads()

    if tier != "all":
        leads = [l for l in leads if (l.get("tier") or "").upper() == tier.upper()]
    if status != "all":
        leads = [l for l in leads if (l.get("pipeline_status") or "NEW").upper() == status.upper()]
    if search:
        q = search.lower()
        leads = [
            l for l in leads
            if q in (l.get("business_name") or "").lower()
            or q in (l.get("category") or "").lower()
            or q in (l.get("city") or "").lower()
        ]

    return {"leads": leads, "total": len(leads)}


@app.patch("/api/leads/{lead_id}/status")
async def update_status(lead_id: str, body: dict):
    db = SheetsDB()
    ok = db.update_pipeline_status(lead_id, body.get("status", "NEW"))
    if not ok:
        raise HTTPException(404, "Lead not found")
    return {"success": True}


@app.get("/api/stats")
async def get_stats():
    db = SheetsDB()
    leads = db.get_existing_leads()

    tiers = {"HOT": 0, "WARM": 0, "COLD": 0}
    pipeline = {"NEW": 0, "CONTACTED": 0, "RESPONDED": 0, "PROPOSAL": 0, "WON": 0, "LOST": 0}

    for lead in leads:
        t = (lead.get("tier") or "COLD").upper()
        tiers[t] = tiers.get(t, 0) + 1
        s = (lead.get("pipeline_status") or "NEW").upper()
        pipeline[s] = pipeline.get(s, 0) + 1

    return {"total": len(leads), "tiers": tiers, "pipeline": pipeline}


@app.post("/api/scraper/run")
async def run_scraper(body: dict):
    with _lock:
        if _state["running"]:
            raise HTTPException(409, "Scraper already running")

    _set_state(
        running=True, status="starting", message="Initializing...",
        started_at=datetime.now().isoformat(), leads_found=0, hot_count=0
    )
    thread = threading.Thread(target=_pipeline_thread, args=(body,), daemon=True)
    thread.start()
    return {"started": True}


@app.get("/api/scraper/status")
async def scraper_status():
    with _lock:
        return dict(_state)


@app.post("/api/scraper/import-dataset")
async def import_dataset(body: dict):
    """Pull an existing Apify dataset by ID and run it through the full pipeline."""
    dataset_id = (body.get("dataset_id") or "").strip()
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required")

    with _lock:
        if _state["running"]:
            raise HTTPException(409, "Scraper already running")

    _set_state(
        running=True, status="starting",
        message=f"Fetching dataset {dataset_id}…",
        started_at=datetime.now().isoformat(), leads_found=0, hot_count=0,
    )
    thread = threading.Thread(
        target=_import_dataset_thread, args=(dataset_id,), daemon=True
    )
    thread.start()
    return {"started": True}


@app.post("/api/coach/analyze")
async def coach_analyze(body: dict):
    """Analyze a single call transcript. Body: {transcript, call_name}"""
    transcript = (body.get("transcript") or "").strip()
    call_name  = (body.get("call_name")  or "").strip()

    if not transcript:
        raise HTTPException(400, "transcript is required")
    if len(transcript) > 200_000:
        raise HTTPException(413, "Transcript too large (max 200k chars)")

    try:
        review = analyze_call(transcript=transcript, call_name=call_name)
        return {"success": True, "review": review}
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Coach analyze error: {e}", exc_info=True)
        raise HTTPException(500, f"Analysis failed: {e}")


@app.post("/api/coach/analyze-batch")
async def coach_analyze_batch(body: dict):
    """
    Analyze multiple transcripts at once.
    Body: {calls: [{name: str, transcript: str}, ...]}
    """
    calls = body.get("calls") or []
    if not calls:
        raise HTTPException(400, "calls array is required and must not be empty")
    if len(calls) > 20:
        raise HTTPException(400, "Maximum 20 calls per batch")

    for i, c in enumerate(calls):
        if not c.get("transcript", "").strip():
            raise HTTPException(400, f"Call {i+1} has an empty transcript")

    try:
        results = analyze_batch(calls)
        return {"success": True, "results": results, "count": len(results)}
    except Exception as e:
        logger.error(f"Coach batch error: {e}", exc_info=True)
        raise HTTPException(500, f"Batch analysis failed: {e}")


@app.get("/api/coach/reviews")
async def coach_reviews(limit: int = 100):
    """Return all stored call reviews, newest first."""
    try:
        reviews = get_all_reviews(limit=limit)
        return {"reviews": reviews, "total": len(reviews)}
    except Exception as e:
        logger.error(f"Coach reviews fetch error: {e}", exc_info=True)
        raise HTTPException(500, str(e))


@app.delete("/api/coach/reviews/{review_id}")
async def coach_delete_review(review_id: str):
    """Delete a specific review by ID."""
    found = delete_review(review_id)
    if not found:
        raise HTTPException(404, "Review not found")
    return {"success": True}


@app.get("/api/coach/weekly")
async def coach_weekly(force: bool = False):
    """Return weekly training summary (cached 24h, force=true to regenerate)."""
    try:
        summary = get_weekly_summary(force=force)
        return {"success": True, "summary": summary}
    except Exception as e:
        logger.error(f"Coach weekly error: {e}", exc_info=True)
        raise HTTPException(500, f"Weekly summary failed: {e}")


@app.get("/api/export/csv")
async def export_csv():
    db = SheetsDB()
    leads = db.get_existing_leads()

    buf = io.StringIO()
    if leads:
        writer = csv.DictWriter(buf, fieldnames=list(leads[0].keys()))
        writer.writeheader()
        writer.writerows(leads)

    buf.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=pro-meridian-leads-{timestamp}.csv"},
    )


# ── Background pipeline ────────────────────────────────────────────────────

def _pipeline_thread(config: dict):
    try:
        _set_state(status="scraping", message="Scraping leads from Apify...")
        scraper = ApifyScraper()
        actor_id = config.pop("_actorId", None) if config else None
        actor_input = config if config else None
        raw_items = scraper.run_actor(actor_input=actor_input, actor_id=actor_id)

        _set_state(status="cleaning", message=f"Cleaning {len(raw_items)} raw results...")
        db = SheetsDB()
        existing = db.get_existing_leads()
        cleaner = LeadCleaner(existing_leads=existing)
        clean_leads = cleaner.clean(raw_items)

        if not clean_leads:
            _set_state(running=False, status="complete", message="No new leads found after dedup.",
                       completed_at=datetime.now().isoformat())
            return

        _set_state(status="analyzing", message=f"Scoring {len(clean_leads)} leads with Claude AI...")
        analyzer = LeadAnalyzer()
        analyzed = analyzer.analyze_batch(clean_leads)

        hot = [l for l in analyzed if (l.get("score") or 0) >= Config.HOT_LEAD_THRESHOLD]

        _set_state(status="saving", message=f"Writing {len(analyzed)} leads to Google Sheets...")
        db.append_leads(analyzed)

        if hot:
            _set_state(status="notifying", message=f"Notifying on {len(hot)} HOT lead(s)...")
            notifier = Notifier()
            notifier.notify_hot_leads(hot)
            db.mark_notified([l["id"] for l in hot])

        _set_state(
            running=False, status="complete",
            message=f"Done. {len(analyzed)} new leads added, {len(hot)} HOT.",
            completed_at=datetime.now().isoformat(),
            leads_found=len(analyzed),
            hot_count=len(hot),
        )

    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        _set_state(running=False, status="error", message=str(e),
                   completed_at=datetime.now().isoformat())


# ── Dataset import pipeline ───────────────────────────────────────────────

def _import_dataset_thread(dataset_id: str):
    try:
        _set_state(status="scraping", message=f"Fetching dataset {dataset_id} from Apify…")
        scraper = ApifyScraper()
        raw_items = scraper.fetch_dataset(dataset_id)

        _set_state(status="cleaning", message=f"Cleaning {len(raw_items)} raw results…")
        db = SheetsDB()
        existing = db.get_existing_leads()
        cleaner = LeadCleaner(existing_leads=existing)
        clean_leads = cleaner.clean(raw_items)

        if not clean_leads:
            _set_state(
                running=False, status="complete",
                message="No new leads found after dedup.",
                completed_at=datetime.now().isoformat(),
            )
            return

        _set_state(status="analyzing", message=f"Scoring {len(clean_leads)} leads with Claude AI…")
        analyzer = LeadAnalyzer()
        analyzed = analyzer.analyze_batch(clean_leads)

        hot = [l for l in analyzed if (l.get("score") or 0) >= Config.HOT_LEAD_THRESHOLD]

        _set_state(status="saving", message=f"Writing {len(analyzed)} leads to Google Sheets…")
        db.append_leads(analyzed)

        if hot:
            _set_state(status="notifying", message=f"Notifying on {len(hot)} HOT lead(s)…")
            notifier = Notifier()
            notifier.notify_hot_leads(hot)
            db.mark_notified([l["id"] for l in hot])

        _set_state(
            running=False, status="complete",
            message=f"Import done. {len(analyzed)} new leads added, {len(hot)} HOT.",
            completed_at=datetime.now().isoformat(),
            leads_found=len(analyzed),
            hot_count=len(hot),
        )

    except Exception as e:
        logger.error(f"Import pipeline error: {e}", exc_info=True)
        _set_state(
            running=False, status="error", message=str(e),
            completed_at=datetime.now().isoformat(),
        )


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  PRO MERIDIAN Dashboard")
    print("  http://localhost:8000")
    print("=" * 50 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
