"""
Claude AI lead analyzer.

Each lead gets scored 1-10 across 5 dimensions:
  • Website quality
  • Online presence
  • Business size / revenue potential
  • Review count & rating
  • Service fit for your niches

Returns enriched lead dict with score, tier, summary, outreach angle.
"""

import json
import logging
import time
from datetime import datetime, timezone

import anthropic

from config import Config

logger = logging.getLogger(__name__)

# ── Scoring prompt ──────────────────────────────────────────────────────────
ANALYSIS_PROMPT = """\
You are the Pro Meridian analyzer — a sharp lead evaluator for a digital agency that sells {services}.

Your target niches are: {niches}

Evaluate this business lead and score it honestly. Don't inflate scores.

## Business Data
```json
{lead_json}
```

## Scoring Rubric (each dimension 0-2 pts, total = sum × 1, max = 10)

1. **Website Quality** (0-2)
   - 0: No website
   - 1: Has a website but it looks outdated, slow, or unprofessional
   - 2: Has a modern, professional website (use URL as signal)

2. **Online Presence** (0-2)
   - 0: No reviews, no social, hard to find
   - 1: Some reviews or social presence, but thin
   - 2: Strong reviews (50+), active socials, visible online

3. **Business Size / Revenue Potential** (0-2)
   - 0: Solo operator, no revenue signals
   - 1: Small team (2-10 people), established but modest
   - 2: Clear signs of a mid-size operation (multiple locations, staff, steady volume)

4. **Review Count & Rating** (0-2)
   - 0: Fewer than 10 reviews or rating below 3.5
   - 1: 10-49 reviews and decent rating (3.5-4.2)
   - 2: 50+ reviews and strong rating (4.3+)

5. **Service Fit** (0-2)
   - 0: Not in target niche or clearly not a good fit
   - 1: In niche but already has good digital presence
   - 2: In niche AND has obvious gaps we can fill (bad website, few reviews, no SEO, etc.)

## Classification
- **HOT** = 8-10: High-value target, reach out this week
- **WARM** = 5-7: Worth pursuing, add to outreach sequence
- **COLD** = 1-4: Poor fit or insufficient data

## Instructions
- Be blunt. If data is missing, score conservatively.
- The outreach_angle should be 1-2 sentences: specific, relevant, not generic.
- key_pain_points: list 2-3 specific weaknesses you can help fix.

Respond with ONLY valid JSON — no markdown, no commentary:

{{
  "score": <integer 1-10>,
  "tier": "<HOT|WARM|COLD>",
  "website_score": <0|1|2>,
  "presence_score": <0|1|2>,
  "size_score": <0|1|2>,
  "review_score": <0|1|2>,
  "fit_score": <0|1|2>,
  "summary": "<2-3 sentence explanation of the score and why>",
  "outreach_angle": "<specific opening line or angle for first contact>",
  "best_service": "<single most relevant service from your offerings>",
  "key_pain_points": ["<pain point 1>", "<pain point 2>", "<pain point 3>"]
}}
"""


class LeadAnalyzer:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        self._niches_str = ", ".join(Config.TARGET_NICHES)
        self._services_str = ", ".join(Config.YOUR_SERVICES)

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def analyze_batch(self, leads: list[dict]) -> list[dict]:
        """Analyze a list of leads. Returns enriched leads sorted score desc."""
        results = []
        total = len(leads)

        for i, lead in enumerate(leads, 1):
            logger.info(f"  Analyzing lead {i}/{total}: {lead.get('business_name', 'Unknown')}")
            enriched = self._analyze_one(lead)
            results.append(enriched)
            # Respect API rate limits
            if i < total:
                time.sleep(0.5)

        results.sort(key=lambda x: x.get("score") or 0, reverse=True)
        return results

    def analyze_one(self, lead: dict) -> dict:
        return self._analyze_one(lead)

    # ──────────────────────────────────────────────────────────
    # Internal
    # ──────────────────────────────────────────────────────────

    def _analyze_one(self, lead: dict) -> dict:
        lead_copy = lead.copy()

        # Build a trimmed view for the prompt (skip raw/noisy fields)
        prompt_data = {
            "business_name": lead.get("business_name"),
            "category": lead.get("category"),
            "website": lead.get("website"),
            "phone": lead.get("phone"),
            "email": lead.get("email"),
            "city": lead.get("city"),
            "state": lead.get("state"),
            "rating": lead.get("rating"),
            "review_count": lead.get("review_count"),
            "description": lead.get("description"),
            "social_facebook": lead.get("social_facebook"),
            "social_instagram": lead.get("social_instagram"),
            "source_url": lead.get("source_url"),
        }

        prompt = ANALYSIS_PROMPT.format(
            services=self._services_str,
            niches=self._niches_str,
            lead_json=json.dumps(prompt_data, indent=2),
        )

        try:
            response = self.client.messages.create(
                model=Config.CLAUDE_MODEL,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = response.content[0].text.strip()

            # Strip accidental markdown fences
            if raw_text.startswith("```"):
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]

            analysis = json.loads(raw_text)

            lead_copy["score"] = int(analysis.get("score", 0))
            lead_copy["tier"] = analysis.get("tier", "COLD")
            lead_copy["summary"] = analysis.get("summary", "")
            lead_copy["outreach_angle"] = analysis.get("outreach_angle", "")
            lead_copy["best_service"] = analysis.get("best_service", "")
            lead_copy["key_pain_points"] = "; ".join(analysis.get("key_pain_points", []))
            lead_copy["analyzed_at"] = datetime.now(timezone.utc).isoformat()

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response for {lead.get('business_name')}: {e}")
            lead_copy["score"] = 0
            lead_copy["tier"] = "ERROR"
            lead_copy["summary"] = "Analysis failed — JSON parse error"
            lead_copy["analyzed_at"] = datetime.now(timezone.utc).isoformat()

        except anthropic.RateLimitError:
            logger.warning("Rate limited — sleeping 60s…")
            time.sleep(60)
            return self._analyze_one(lead)

        except Exception as e:
            logger.error(f"Analysis error for {lead.get('business_name')}: {e}")
            lead_copy["score"] = 0
            lead_copy["tier"] = "ERROR"
            lead_copy["summary"] = f"Analysis failed: {e}"
            lead_copy["analyzed_at"] = datetime.now(timezone.utc).isoformat()

        return lead_copy
