"""
Apify scraper module.

Supports two modes:
  1. Run a fresh actor and wait for results (default)
  2. Pull from an existing dataset by dataset ID
"""

import json
import logging
import time
from typing import Optional

import requests
from apify_client import ApifyClient

from config import Config

logger = logging.getLogger(__name__)


class ApifyScraper:
    def __init__(self):
        self.client = ApifyClient(Config.APIFY_TOKEN)

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def run_actor(self, actor_input: Optional[dict] = None, actor_id: Optional[str] = None) -> list[dict]:
        """Run the configured Apify actor and return all items."""
        input_data = actor_input or Config.APIFY_ACTOR_INPUT
        resolved_actor = actor_id or Config.APIFY_ACTOR_ID
        logger.info(f"Starting Apify actor: {resolved_actor}")
        logger.info(f"Input: {json.dumps(input_data, indent=2)}")

        run = self.client.actor(resolved_actor).call(run_input=input_data)

        # apify-client ≥1.7 returns a pydantic Run model; older returns a dict.
        # Handle both without crashing.
        if isinstance(run, dict):
            status     = run.get("status")
            dataset_id = run.get("defaultDatasetId")
            run_id     = run.get("id", "unknown")
        else:
            status     = getattr(run, "status", None)
            # pydantic model uses snake_case
            dataset_id = getattr(run, "default_dataset_id", None)
            run_id     = getattr(run, "id", "unknown")

        if status != "SUCCEEDED":
            raise RuntimeError(
                f"Apify actor run failed with status: {status}\n"
                f"Run ID: {run_id}"
            )

        logger.info(f"Actor finished. Dataset ID: {dataset_id}")
        return self._fetch_dataset(dataset_id)

    def fetch_dataset(self, dataset_id: str) -> list[dict]:
        """Pull results from an existing Apify dataset."""
        logger.info(f"Fetching existing dataset: {dataset_id}")
        return self._fetch_dataset(dataset_id)

    def run_via_http(self, actor_input: Optional[dict] = None) -> list[dict]:
        """
        Alternative: trigger actor via raw HTTP (use when you have a specific
        HTTP request from the Apify console). Polls until complete.
        """
        input_data = actor_input or Config.APIFY_ACTOR_INPUT
        actor_id_encoded = Config.APIFY_ACTOR_ID.replace("/", "~")

        url = f"https://api.apify.com/v2/acts/{actor_id_encoded}/runs"
        headers = {"Content-Type": "application/json"}
        params = {"token": Config.APIFY_TOKEN}

        logger.info(f"Triggering actor via HTTP: {url}")
        resp = requests.post(url, json=input_data, headers=headers, params=params, timeout=30)
        resp.raise_for_status()

        run_id = resp.json()["data"]["id"]
        logger.info(f"Actor run started. Run ID: {run_id}")

        return self._poll_and_fetch(run_id)

    # ──────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────

    def _fetch_dataset(self, dataset_id: str) -> list[dict]:
        items = []
        offset = 0
        limit = 1000

        while True:
            page = (
                self.client.dataset(dataset_id)
                .list_items(limit=limit, offset=offset)
                .items
            )
            if not page:
                break
            items.extend(page)
            logger.info(f"  Fetched {len(items)} items so far…")
            if len(page) < limit:
                break
            offset += limit

        logger.info(f"Total raw items scraped: {len(items)}")
        return items

    def _poll_and_fetch(self, run_id: str, timeout_seconds: int = 600) -> list[dict]:
        """Poll actor run until finished, then fetch dataset."""
        url = f"https://api.apify.com/v2/actor-runs/{run_id}"
        params = {"token": Config.APIFY_TOKEN}
        elapsed = 0
        poll_interval = 10

        while elapsed < timeout_seconds:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()["data"]
            status = data["status"]

            if status == "SUCCEEDED":
                dataset_id = data["defaultDatasetId"]
                logger.info(f"Run succeeded. Dataset: {dataset_id}")
                return self._fetch_dataset(dataset_id)

            if status in ("FAILED", "ABORTED", "TIMED-OUT"):
                raise RuntimeError(f"Apify run {run_id} ended with status: {status}")

            logger.info(f"  Run status: {status} — waiting {poll_interval}s…")
            time.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Apify run {run_id} did not complete within {timeout_seconds}s")
