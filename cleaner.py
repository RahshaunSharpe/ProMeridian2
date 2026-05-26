"""
Data cleaning & deduplication pipeline.

Steps:
  1. Normalize raw Apify fields → standard schema
  2. Filter records with no usable contact info
  3. Deduplicate within the batch (phone + fuzzy name)
  4. Deduplicate against existing Google Sheets leads
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher

import phonenumbers

logger = logging.getLogger(__name__)

# ── Standard lead schema ────────────────────────────────────────────────────
EMPTY_LEAD: dict = {
    "id": "",
    "business_name": "",
    "phone": "",
    "email": "",
    "website": "",
    "address": "",
    "city": "",
    "state": "",
    "zip_code": "",
    "country": "US",
    "category": "",
    "rating": None,
    "review_count": 0,
    "description": "",
    "social_facebook": "",
    "social_instagram": "",
    "social_twitter": "",
    "source": "",
    "source_url": "",
    "place_id": "",
    "scraped_at": "",
    # Filled by analyzer
    "score": None,
    "tier": "",
    "summary": "",
    "outreach_angle": "",
    "best_service": "",
    "key_pain_points": "",
    "analyzed_at": "",
    # Meta
    "notified": False,
    "added_at": "",
}


class LeadCleaner:
    def __init__(self, existing_leads: list[dict] | None = None):
        """
        existing_leads: rows already in Google Sheets (to skip re-processing).
        """
        self._existing_phones: set[str] = set()
        self._existing_names: list[str] = []

        if existing_leads:
            for lead in existing_leads:
                phone = str(lead.get("phone", "") or "")
                name = str(lead.get("business_name", "") or "")
                if phone:
                    self._existing_phones.add(self._normalize_phone(phone))
                if name:
                    self._existing_names.append(self._normalize_name(name))

        logger.info(
            f"Cleaner initialized with {len(self._existing_phones)} existing phone(s) "
            f"and {len(self._existing_names)} existing name(s)."
        )

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def clean(self, raw_items: list[dict], source: str = "apify") -> list[dict]:
        """Full cleaning pipeline. Returns deduplicated, standardized leads."""
        logger.info(f"Cleaning {len(raw_items)} raw items…")

        normalized = [self._normalize(item, source) for item in raw_items]
        filtered = [l for l in normalized if self._has_minimum_data(l)]
        logger.info(f"  After filter: {len(filtered)} (removed {len(normalized) - len(filtered)} empty)")

        deduped_batch = self._dedup_within_batch(filtered)
        logger.info(f"  After batch dedup: {len(deduped_batch)}")

        new_leads = self._dedup_against_existing(deduped_batch)
        logger.info(f"  After existing-sheet dedup: {len(new_leads)} new leads")

        return new_leads

    # ──────────────────────────────────────────────────────────
    # Normalization — maps any Apify actor output to standard schema
    # ──────────────────────────────────────────────────────────

    def _normalize(self, item: dict, source: str) -> dict:
        lead = EMPTY_LEAD.copy()
        lead["id"] = str(uuid.uuid4())
        lead["scraped_at"] = datetime.now(timezone.utc).isoformat()
        lead["added_at"] = datetime.now(timezone.utc).isoformat()
        lead["source"] = source

        # ── Business name ──
        lead["business_name"] = self._first_str(
            item, ["title", "name", "businessName", "companyName", "storeName"]
        )

        # ── Phone ──
        raw_phone = self._first_str(item, ["phone", "phoneNumber", "telephone", "phone1"])
        lead["phone"] = self._normalize_phone(raw_phone)

        # ── Email ──
        lead["email"] = self._first_str(
            item, ["email", "emailAddress", "contactEmail"]
        ).lower().strip()

        # ── Website ──
        website = self._first_str(item, ["website", "websiteUrl", "url", "web"])
        lead["website"] = self._clean_url(website)

        # ── Address ──
        # Some actors provide nested address objects
        addr_obj = item.get("address") or item.get("location") or {}
        if isinstance(addr_obj, dict):
            lead["address"] = addr_obj.get("street", "") or item.get("street", "")
            lead["city"] = addr_obj.get("city", "") or item.get("city", "")
            lead["state"] = addr_obj.get("state", "") or item.get("state", "")
            lead["zip_code"] = addr_obj.get("zip", "") or item.get("zip", "") or item.get("postalCode", "")
            lead["country"] = addr_obj.get("country", "US") or item.get("country", "US")
        else:
            # Flat address string
            full_addr = str(addr_obj) if addr_obj else ""
            lead["address"] = self._first_str(item, ["street", "streetAddress", "addr"]) or full_addr
            lead["city"] = self._first_str(item, ["city", "municipality"])
            lead["state"] = self._first_str(item, ["state", "stateCode", "region"])
            lead["zip_code"] = self._first_str(item, ["zip", "zipCode", "postalCode"])

        # Some actors give a single formatted address field
        if not lead["city"]:
            formatted = self._first_str(item, ["formattedAddress", "fullAddress"])
            lead["address"] = lead["address"] or formatted

        # ── Category ──
        cats = item.get("categories") or item.get("categoryName") or item.get("category") or ""
        if isinstance(cats, list):
            lead["category"] = ", ".join(str(c) for c in cats[:3])
        else:
            lead["category"] = str(cats).strip()

        # ── Ratings ──
        rating_raw = item.get("rating") or item.get("stars") or item.get("totalScore") or 0
        try:
            lead["rating"] = round(float(rating_raw), 1)
        except (ValueError, TypeError):
            lead["rating"] = None

        review_raw = (
            item.get("reviewCount")
            or item.get("reviewsCount")
            or item.get("userRatingsTotal")
            or item.get("numberOfReviews")
            or 0
        )
        try:
            lead["review_count"] = int(review_raw)
        except (ValueError, TypeError):
            lead["review_count"] = 0

        # ── Description ──
        lead["description"] = self._first_str(
            item, ["description", "about", "snippet", "shortDescription"]
        )[:500]

        # ── Social media ──
        socials = item.get("socialMedia") or item.get("social") or {}
        if isinstance(socials, dict):
            lead["social_facebook"] = socials.get("facebook", "")
            lead["social_instagram"] = socials.get("instagram", "")
            lead["social_twitter"] = socials.get("twitter", "")

        # ── Source URL / Place ID ──
        lead["source_url"] = self._first_str(item, ["url", "link", "placeUrl", "googleMapsUrl"])
        lead["place_id"] = self._first_str(item, ["placeId", "googlePlaceId", "id"])

        return lead

    # ──────────────────────────────────────────────────────────
    # Filters
    # ──────────────────────────────────────────────────────────

    def _has_minimum_data(self, lead: dict) -> bool:
        """Reject leads that have no business name and no contact info."""
        has_name = bool(lead.get("business_name", "").strip())
        has_contact = any([
            lead.get("phone"),
            lead.get("email"),
            lead.get("website"),
        ])
        return has_name and has_contact

    # ──────────────────────────────────────────────────────────
    # Deduplication
    # ──────────────────────────────────────────────────────────

    def _dedup_within_batch(self, leads: list[dict]) -> list[dict]:
        seen_phones: set[str] = set()
        seen_names: list[str] = []
        unique: list[dict] = []

        for lead in leads:
            phone = lead.get("phone", "")
            name = self._normalize_name(lead.get("business_name", ""))
            city = (lead.get("city", "") or "").lower().strip()

            # Exact phone match
            if phone and phone in seen_phones:
                logger.debug(f"  Dup (phone): {lead['business_name']}")
                continue

            # Fuzzy name + city match
            if name and self._is_fuzzy_duplicate(name, city, seen_names):
                logger.debug(f"  Dup (fuzzy name): {lead['business_name']}")
                continue

            if phone:
                seen_phones.add(phone)
            if name:
                seen_names.append(f"{name}|{city}")
            unique.append(lead)

        return unique

    def _dedup_against_existing(self, leads: list[dict]) -> list[dict]:
        new: list[dict] = []
        for lead in leads:
            phone = lead.get("phone", "")
            name = self._normalize_name(lead.get("business_name", ""))

            if phone and phone in self._existing_phones:
                logger.debug(f"  Already in sheet (phone): {lead['business_name']}")
                continue

            if name and any(
                self._similarity(name, ex.split("|")[0]) > 0.88
                for ex in self._existing_names
            ):
                logger.debug(f"  Already in sheet (fuzzy): {lead['business_name']}")
                continue

            new.append(lead)

        return new

    def _is_fuzzy_duplicate(self, name: str, city: str, seen: list[str]) -> bool:
        key = f"{name}|{city}"
        return any(self._similarity(key, s) > 0.88 for s in seen)

    # ──────────────────────────────────────────────────────────
    # Utilities
    # ──────────────────────────────────────────────────────────

    @staticmethod
    def _first_str(item: dict, keys: list[str]) -> str:
        for k in keys:
            val = item.get(k)
            if val and isinstance(val, str) and val.strip():
                return val.strip()
        return ""

    @staticmethod
    def _normalize_phone(raw) -> str:
        if not raw:
            return ""
        raw = str(raw)  # Sheets returns numbers as int
        try:
            parsed = phonenumbers.parse(raw, "US")
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except Exception:
            pass
        # Fallback: strip non-digits
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 10:
            return f"+1{digits}"
        if len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        return digits

    @staticmethod
    def _normalize_name(name) -> str:
        return re.sub(r"\s+", " ", str(name or "").lower().strip())

    @staticmethod
    def _clean_url(url: str) -> str:
        if not url:
            return ""
        url = url.strip()
        if url and not url.startswith(("http://", "https://")):
            url = "https://" + url
        return url

    @staticmethod
    def _similarity(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio()
