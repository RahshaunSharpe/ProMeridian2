"""
coach.py — AI Sales Coach powered by Claude

Reviews call transcripts using Alex Hormozi frameworks and lead gen agency SOPs.
Persona: Marcus — a $100k/month agency owner giving brutally honest, actionable coaching.

Storage: coach_reviews.json (local file, not Google Sheets)
Weekly summary: coach_weekly_cache.json (24-hour cache)
"""

import json
import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import anthropic

from config import Config
from sales_knowledge import SALES_KNOWLEDGE_BASE

logger = logging.getLogger(__name__)

REVIEWS_FILE = Path("coach_reviews.json")
WEEKLY_CACHE_FILE = Path("coach_weekly_cache.json")

# ── Marcus system prompt ────────────────────────────────────────────────────

MARCUS_SYSTEM_PROMPT = f"""You are Marcus — a lead generation agency owner doing $100k/month in recurring revenue. You have personally closed hundreds of deals with local service businesses: contractors, HVAC, plumbers, roofers, dentists, med spas, auto shops, and more.

You are reviewing a sales call made by your rep. Your job is to be brutally honest, specific, and actionable. You don't sugarcoat. You care about results, not feelings. But you're not cruel — you genuinely want them to improve and win.

Your entire coaching framework is built on the following knowledge base:

{SALES_KNOWLEDGE_BASE}

When you review a call you look for:
1. Did they identify the prospect's DREAM OUTCOME before anything else?
2. Did they AMPLIFY PAIN before presenting price? (Cost of inaction > cost of service)
3. Did they build a VALUE STACK instead of pitching a single service?
4. Did they ANCHOR PRICE high before revealing their number?
5. Did they isolate and handle EVERY OBJECTION — or cave at the first sign of friction?
6. Did they attempt to CLOSE, or just schedule a vague "follow up"?
7. What is the EXACT NEXT MOVE to save or advance this deal?

Red flags you always catch:
- "I'll send you a proposal and you can review it" = buried deal, $10k mistake
- "Sure, take your time!" after "I need to think about it" = hidden objection ignored
- Cutting price without reframing to ROI = training the market to wait you out
- Asking "does that make sense?" = seeking approval, not leading the sale
- Ending without a committed next step = not a pipeline, it's a wish list

Your tone: direct, specific, confident, like a mentor who has seen it all and won't let you keep making the same mistakes.

CRITICAL: You MUST respond with ONLY a valid JSON object matching the exact schema below. No markdown fences, no preamble, no text outside the JSON object. Your entire response is the JSON.

Required output schema:
{{
  "overall_score": <integer 1-10>,
  "prospect": {{
    "business_name": "<extracted business name or 'Unknown'>",
    "niche": "<business category e.g. HVAC, Roofing, Dental>",
    "pain_points": ["<pain 1>", "<pain 2>"],
    "dream_outcome": "<what the prospect wants to achieve>",
    "urgency": "<low|medium|high>",
    "buying_signals": ["<signal from the call>"]
  }},
  "score_breakdown": {{
    "opening_rapport": <0|1|2>,
    "discovery": <0|1|2>,
    "value_presentation": <0|1|2>,
    "objection_handling": <0|1|2>,
    "next_steps": <0|1|2>
  }},
  "hormozi_audit": {{
    "dream_outcome_identified": <true|false>,
    "pain_amplified": <true|false>,
    "value_stack_presented": <true|false>,
    "price_anchored": <true|false>,
    "close_attempted": <true|false>
  }},
  "critical_mistake": "<the single most damaging thing that happened on this call>",
  "what_went_well": ["<specific positive 1>", "<specific positive 2>"],
  "what_went_wrong": [
    {{
      "mistake": "<what the rep did>",
      "exact_line": "<the exact line or paraphrase from the transcript>",
      "better_response": "<exactly what they should have said instead — word for word>"
    }}
  ],
  "next_move": {{
    "action_type": "<call|email|in-person|text>",
    "timing": "<specific timing e.g. Tomorrow 10-11am>",
    "opening_line": "<exact first sentence to say or write>",
    "key_point": "<the main value point to hammer home>",
    "close_to_use": "<the exact closing line to use>",
    "materials_to_send": ["<e.g. ROI calculator>", "<e.g. case study PDF>"]
  }},
  "objection_playbook": [
    {{
      "objection": "<what the prospect said>",
      "rep_response": "<what the rep actually said>",
      "why_it_hurt": "<why this response killed momentum>",
      "hormozi_reframe": "<the correct Hormozi-style response — word for word>"
    }}
  ],
  "weekly_priority": {{
    "skill": "<the one sales skill to drill this week>",
    "drill": "<specific 10-minute daily practice exercise>",
    "why_it_matters": "<what mastering this is worth in revenue>"
  }},
  "if_i_were_on_this_call": "<Marcus writes 3-5 sentences: what he would have done differently at the most critical moment, and why it would have changed the outcome>"
}}"""


# ── Storage helpers ─────────────────────────────────────────────────────────

def _load_reviews() -> list:
    if not REVIEWS_FILE.exists():
        return []
    try:
        return json.loads(REVIEWS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to load reviews: {e}")
        return []


def _save_reviews(reviews: list):
    REVIEWS_FILE.write_text(
        json.dumps(reviews, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def _strip_fences(raw: str) -> str:
    """Remove markdown code fences if Claude wraps output in them."""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        # Remove opening fence line
        lines = lines[1:]
        # Remove closing fence if present
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    return raw


# ── Core analysis ───────────────────────────────────────────────────────────

def analyze_call(transcript: str, call_name: str = "") -> dict:
    """
    Send a single call transcript to Claude for coaching review.
    Returns structured review dict and persists it to coach_reviews.json.
    """
    if not transcript or not transcript.strip():
        raise ValueError("Transcript is empty.")

    client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)

    call_label = call_name.strip() if call_name.strip() else "Unnamed Call"

    user_message = f"""Call name: {call_label}

--- TRANSCRIPT START ---
{transcript.strip()}
--- TRANSCRIPT END ---

Review this call as Marcus and return your structured JSON analysis. Be specific — reference actual lines from the transcript."""

    logger.info(f"Coach: analyzing '{call_label}' ({len(transcript):,} chars)")

    message = client.messages.create(
        model=Config.CLAUDE_MODEL,
        max_tokens=4096,
        system=MARCUS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = _strip_fences(message.content[0].text)

    try:
        review = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error in coach response: {e}\nRaw: {raw[:500]}")
        raise ValueError(f"Claude returned non-JSON response: {e}")

    # Attach metadata
    review["review_id"] = str(uuid.uuid4())
    review["call_name"] = call_label
    review["analyzed_at"] = datetime.now().isoformat()
    review["transcript_length"] = len(transcript)

    # Persist — newest first
    reviews = _load_reviews()
    reviews.insert(0, review)
    _save_reviews(reviews)

    logger.info(
        f"Coach: review saved [{review['review_id'][:8]}] "
        f"score={review.get('overall_score', '?')}/10 — {call_label}"
    )
    return review


def analyze_batch(calls: list) -> list:
    """
    Analyze multiple calls.
    calls: list of dicts with keys 'name' (str) and 'transcript' (str)
    Returns list of review dicts (with errors inline for failed calls).
    """
    results = []
    total = len(calls)

    for i, call in enumerate(calls, 1):
        name = call.get("name", f"Call {i}")
        transcript = call.get("transcript", "")
        logger.info(f"Coach batch: {i}/{total} — {name}")
        try:
            result = analyze_call(transcript=transcript, call_name=name)
            results.append(result)
        except Exception as e:
            logger.error(f"Coach batch error on call {i} ({name}): {e}")
            results.append({
                "review_id": str(uuid.uuid4()),
                "call_name": name,
                "analyzed_at": datetime.now().isoformat(),
                "error": str(e),
                "overall_score": None,
            })

    return results


# ── Review retrieval ────────────────────────────────────────────────────────

def get_all_reviews(limit: int = 100) -> list:
    """Return all stored reviews, newest first."""
    return _load_reviews()[:limit]


def delete_review(review_id: str) -> bool:
    """Delete a review by ID. Returns True if found and deleted."""
    reviews = _load_reviews()
    original_len = len(reviews)
    reviews = [r for r in reviews if r.get("review_id") != review_id]
    if len(reviews) < original_len:
        _save_reviews(reviews)
        return True
    return False


# ── Weekly training summary ─────────────────────────────────────────────────

def get_weekly_summary(force: bool = False) -> dict:
    """
    Generate (or return cached) weekly training report from reviews in the last 7 days.
    Cache is valid for 24 hours unless force=True.
    """
    # Check cache
    if not force and WEEKLY_CACHE_FILE.exists():
        try:
            cached = json.loads(WEEKLY_CACHE_FILE.read_text(encoding="utf-8"))
            cached_at = datetime.fromisoformat(cached.get("generated_at", "2000-01-01"))
            if datetime.now() - cached_at < timedelta(hours=24):
                logger.info("Coach: returning cached weekly summary")
                return cached
        except Exception:
            pass

    reviews = _load_reviews()
    cutoff = datetime.now() - timedelta(days=7)

    recent = []
    for r in reviews:
        try:
            ts = datetime.fromisoformat(r.get("analyzed_at", "2000-01-01"))
            if ts > cutoff:
                recent.append(r)
        except Exception:
            continue

    if not recent:
        result = {
            "generated_at": datetime.now().isoformat(),
            "calls_reviewed": 0,
            "avg_score": None,
            "pattern_recognition": "No calls reviewed in the last 7 days. Upload your call transcripts to get personalized weekly training.",
            "skill_gap": "N/A",
            "weekly_drill": "Record yourself doing a mock cold call — even 5 minutes. You can't improve what you haven't heard.",
            "objection_of_the_week": {
                "objection": "I need to think about it.",
                "script": "Of course — what specifically do you need to think about? Is it the investment, the results, or something else? [Isolate the real objection. Don't move until you have it.]"
            },
            "hormozi_principle": "The Value Equation: Value = (Dream Outcome × Likelihood) / (Time Delay × Effort). Every tweak to your pitch should move one of these four levers.",
            "win_rate_insight": "Upload calls to track win rate trends over time.",
            "the_one_thing": "Before your next call, write down the prospect's dream outcome in one sentence. Read it before you dial.",
        }
        _weekly_cache_write(result)
        return result

    # Summarize review data for the prompt
    scores = [r.get("overall_score") for r in recent if r.get("overall_score") is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    context_data = [{
        "call_name": r.get("call_name"),
        "overall_score": r.get("overall_score"),
        "critical_mistake": r.get("critical_mistake"),
        "what_went_well": r.get("what_went_well", []),
        "what_went_wrong": r.get("what_went_wrong", []),
        "hormozi_audit": r.get("hormozi_audit", {}),
        "weekly_priority": r.get("weekly_priority", {}),
        "if_i_were_on_this_call": r.get("if_i_were_on_this_call"),
    } for r in recent]

    client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)

    weekly_prompt = f"""You are Marcus — $100k/month agency owner. You've reviewed {len(recent)} sales call(s) from your rep this week.

Here are the reviews:
{json.dumps(context_data, indent=2)}

Write a weekly training report using the WEEKLY_TRAINING_FORMAT framework. Respond with ONLY valid JSON:

{{
  "pattern_recognition": "<what's showing up consistently — be specific, quote actual mistakes>",
  "skill_gap": "<the single technique that, if improved, would have the most revenue impact>",
  "weekly_drill": "<specific 10-minute daily practice exercise — exact steps>",
  "objection_of_the_week": {{
    "objection": "<most common objection this week>",
    "script": "<exact Hormozi-style script to handle it — word for word>"
  }},
  "hormozi_principle": "<one Hormozi principle that directly applies to what you saw this week — and HOW to apply it>",
  "win_rate_insight": "<honest assessment: are you improving? what does the data say?>",
  "the_one_thing": "<if you could only change one thing about this rep's approach this week, what is it — and exactly how>"
}}"""

    logger.info(f"Coach: generating weekly summary for {len(recent)} reviews")

    message = client.messages.create(
        model=Config.CLAUDE_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": weekly_prompt}],
    )

    raw = _strip_fences(message.content[0].text)

    try:
        summary = json.loads(raw)
    except json.JSONDecodeError:
        summary = {"raw_summary": raw}

    summary["generated_at"] = datetime.now().isoformat()
    summary["calls_reviewed"] = len(recent)
    summary["avg_score"] = avg_score

    _weekly_cache_write(summary)
    logger.info(f"Coach: weekly summary generated — {len(recent)} calls, avg score {avg_score}")
    return summary


def _weekly_cache_write(data: dict):
    try:
        WEEKLY_CACHE_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
    except Exception as e:
        logger.error(f"Failed to write weekly cache: {e}")
