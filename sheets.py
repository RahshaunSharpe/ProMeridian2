"""
Google Sheets integration — the lead database.

Sheet columns (in order):
  ID | Business Name | Phone | Email | Website | Address | City | State | Zip
  Category | Rating | Reviews | Description | Source | Source URL | Place ID
  Score | Tier | Summary | Outreach Angle | Best Service | Key Pain Points
  Notified | Added At | Analyzed At | Pipeline Status
"""

import logging
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

from config import Config

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

HEADERS = [
    "ID", "Business Name", "Phone", "Email", "Website",
    "Address", "City", "State", "Zip",
    "Category", "Rating", "Review Count", "Description",
    "Source", "Source URL", "Place ID",
    "Score", "Tier", "Summary", "Outreach Angle", "Best Service", "Key Pain Points",
    "Notified", "Added At", "Analyzed At", "Pipeline Status",
]

HEADER_TO_KEY = {
    "ID": "id",
    "Business Name": "business_name",
    "Phone": "phone",
    "Email": "email",
    "Website": "website",
    "Address": "address",
    "City": "city",
    "State": "state",
    "Zip": "zip_code",
    "Category": "category",
    "Rating": "rating",
    "Review Count": "review_count",
    "Description": "description",
    "Source": "source",
    "Source URL": "source_url",
    "Place ID": "place_id",
    "Score": "score",
    "Tier": "tier",
    "Summary": "summary",
    "Outreach Angle": "outreach_angle",
    "Best Service": "best_service",
    "Key Pain Points": "key_pain_points",
    "Notified": "notified",
    "Added At": "added_at",
    "Analyzed At": "analyzed_at",
    "Pipeline Status": "pipeline_status",
}


class SheetsDB:
    def __init__(self):
        creds = Credentials.from_service_account_file(
            Config.GOOGLE_SHEETS_CREDENTIALS, scopes=SCOPES
        )
        self.gc = gspread.authorize(creds)
        self._sheet = self._get_or_create_sheet()

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def get_existing_leads(self) -> list[dict]:
        """Load all existing leads from the sheet."""
        try:
            # Don't enforce expected_headers so existing sheets without
            # Pipeline Status column still load cleanly.
            records = self._sheet.get_all_records()
            leads = []
            for row in records:
                lead = {HEADER_TO_KEY.get(k, k.lower().replace(" ", "_")): v
                        for k, v in row.items()}
                # Default pipeline status for older rows
                if not lead.get("pipeline_status"):
                    lead["pipeline_status"] = "NEW"
                leads.append(lead)
            logger.info(f"Loaded {len(leads)} existing leads.")
            return leads
        except Exception as e:
            logger.error(f"Failed to read leads: {e}")
            return []

    def append_leads(self, leads: list[dict]) -> int:
        """Append new leads. Returns count written."""
        if not leads:
            return 0
        rows = [self._lead_to_row(lead) for lead in leads]
        self._sheet.append_rows(rows, value_input_option="USER_ENTERED")
        logger.info(f"Appended {len(rows)} leads.")
        return len(rows)

    def update_pipeline_status(self, lead_id: str, status: str) -> bool:
        """Update the Pipeline Status cell for a given lead ID."""
        all_values = self._sheet.get_all_values()
        if not all_values:
            return False

        headers = all_values[0]

        # Find or create Pipeline Status column
        if "Pipeline Status" in headers:
            status_col = headers.index("Pipeline Status") + 1
        else:
            status_col = len(headers) + 1
            self._sheet.update_cell(1, status_col, "Pipeline Status")
            # Refresh headers
            headers = self._sheet.row_values(1)

        if "ID" not in headers:
            return False
        id_col = headers.index("ID") + 1

        for row_idx, row in enumerate(all_values[1:], start=2):
            if len(row) >= id_col and row[id_col - 1] == lead_id:
                self._sheet.update_cell(row_idx, status_col, status.upper())
                logger.info(f"Updated pipeline status for {lead_id} → {status}")
                return True
        return False

    def mark_notified(self, lead_ids: list[str]):
        """Set Notified = TRUE for the given lead IDs."""
        if not lead_ids:
            return
        all_values = self._sheet.get_all_values()
        headers = all_values[0]
        if "ID" not in headers or "Notified" not in headers:
            return

        id_col = headers.index("ID") + 1
        notified_col = headers.index("Notified") + 1

        updates = []
        for row_idx, row in enumerate(all_values[1:], start=2):
            if len(row) >= id_col and row[id_col - 1] in lead_ids:
                updates.append({
                    "range": gspread.utils.rowcol_to_a1(row_idx, notified_col),
                    "values": [["TRUE"]],
                })
        if updates:
            self._sheet.batch_update(updates)
            logger.info(f"Marked {len(updates)} leads notified.")

    # ──────────────────────────────────────────────────────────
    # Internal
    # ──────────────────────────────────────────────────────────

    def _get_or_create_sheet(self):
        spreadsheet = self.gc.open_by_key(Config.GOOGLE_SHEET_ID)

        try:
            worksheet = spreadsheet.worksheet(Config.GOOGLE_SHEET_NAME)
            existing = worksheet.row_values(1)
            if not existing:
                worksheet.insert_row(HEADERS, index=1)
            elif "Pipeline Status" not in existing:
                # Existing sheet may not have enough columns — resize first
                next_col = len(existing) + 1
                spreadsheet.batch_update({"requests": [{
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": worksheet.id,
                            "gridProperties": {
                                "rowCount": max(worksheet.row_count, 2000),
                                "columnCount": max(worksheet.col_count, next_col),
                            },
                        },
                        "fields": "gridProperties.rowCount,gridProperties.columnCount",
                    }
                }]})
                worksheet.update_cell(1, next_col, "Pipeline Status")
                logger.info("Added 'Pipeline Status' column to existing sheet.")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(
                title=Config.GOOGLE_SHEET_NAME, rows=2000, cols=len(HEADERS)
            )
            worksheet.insert_row(HEADERS, index=1)
            logger.info(f"Created worksheet '{Config.GOOGLE_SHEET_NAME}'.")

        # Freeze header row
        spreadsheet.batch_update({"requests": [{
            "updateSheetProperties": {
                "properties": {
                    "sheetId": worksheet.id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        }]})

        return worksheet

    def _lead_to_row(self, lead: dict) -> list:
        return [
            str(lead.get("id", "")),
            str(lead.get("business_name", "")),
            str(lead.get("phone", "")),
            str(lead.get("email", "")),
            str(lead.get("website", "")),
            str(lead.get("address", "")),
            str(lead.get("city", "")),
            str(lead.get("state", "")),
            str(lead.get("zip_code", "")),
            str(lead.get("category", "")),
            str(lead.get("rating", "")),
            str(lead.get("review_count", 0)),
            str(lead.get("description", ""))[:500],
            str(lead.get("source", "")),
            str(lead.get("source_url", "")),
            str(lead.get("place_id", "")),
            str(lead.get("score", "")),
            str(lead.get("tier", "")),
            str(lead.get("summary", "")),
            str(lead.get("outreach_angle", "")),
            str(lead.get("best_service", "")),
            str(lead.get("key_pain_points", "")),
            "FALSE",
            str(lead.get("added_at", datetime.now(timezone.utc).isoformat())),
            str(lead.get("analyzed_at", "")),
            str(lead.get("pipeline_status", "NEW")),
        ]
