# Pro Meridian — Lead Intelligence System

> Automatically scrapes Google Maps for local business leads, scores them with AI, and delivers your hottest prospects straight to a dashboard — all running on your own computer.

---

## What This Does

You tell it what type of businesses to look for and where. It scrapes Google Maps, scores every lead with AI, and shows you a dashboard of who to call first — with a custom outreach angle written for each one.

**No monthly SaaS fees. No spreadsheets. Runs from your laptop.**

---

## Before You Start — What You'll Need

You'll need accounts on 4 services. All have free tiers to get started.

| Service | What It Does | Cost |
|---|---|---|
| [Apify](https://apify.com) | Scrapes Google Maps for leads | $5 free credit |
| [Anthropic](https://console.anthropic.com) | AI that scores and analyzes leads | ~$0.01 per lead |
| [Google Cloud](https://console.cloud.google.com) | Stores leads in a Google Sheet | Free |
| Gmail | Sends you HOT lead email alerts | Free |

---

## Step 1 — Install Python

Pro Meridian runs on Python. If you don't have it:

1. Go to **[python.org/downloads](https://python.org/downloads)**
2. Click the big yellow **Download Python** button
3. Run the installer
4. **Important:** Check the box that says **"Add Python to PATH"** before clicking Install

To verify it worked, open **Command Prompt** (search "cmd" in your Windows start menu) and type:
```
python --version
```
You should see something like `Python 3.11.x`. If you do, you're good.

---

## Step 2 — Download This Project

If you received this as a ZIP file, extract it to a folder on your Desktop or Documents.

If you have Git installed, open **Command Prompt** and run:
```
git clone https://github.com/YOUR_USERNAME/jarvis-lead-gen.git
cd jarvis-lead-gen
```

---

## Step 3 — Get Your API Keys

You need 4 keys. Here's exactly where to find each one.

---

### Key 1 — Apify (the scraper)

1. Go to **[apify.com](https://apify.com)** and create a free account
2. After logging in, click your profile picture (top right) → **Settings**
3. Click **API & Integrations** in the left menu
4. You'll see your **Personal API token** — copy it

It looks like this: `apify_api_xxxxxxxxxxxxxxxxxxxx`

---

### Key 2 — Anthropic (the AI brain)

1. Go to **[console.anthropic.com](https://console.anthropic.com)** and create an account
2. Click **API Keys** in the left menu
3. Click **Create Key**, give it a name like "Pro Meridian"
4. Copy the key immediately — you won't be able to see it again

It looks like this: `sk-ant-api03-xxxxxxxxxxxxxxxxxxxx`

> **Add credits:** Go to **Billing** and add $5–10. Each lead costs about $0.01 to analyze so $5 gets you ~500 leads.

---

### Key 3 — Google Sheets (the database)

This takes a few more steps but you only do it once.

**Part A — Create a Google Sheet**

1. Go to **[sheets.google.com](https://sheets.google.com)** and create a new blank spreadsheet
2. Name it `Pro Meridian Leads`
3. Look at the URL — it looks like this:
   ```
   https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
   ```
4. Copy the long ID in the middle — that's your **Sheet ID**:
   ```
   1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```

**Part B — Create a Service Account**

This gives Pro Meridian permission to write to your sheet automatically.

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Click **Select a project** at the top → **New Project** → name it "Pro Meridian" → Create
3. In the search bar at the top, search for **"Google Sheets API"** → click it → click **Enable**
4. Search again for **"Google Drive API"** → click it → click **Enable**
5. In the left menu, click **IAM & Admin** → **Service Accounts**
6. Click **+ Create Service Account**
   - Name: `jarvis-bot`
   - Click **Create and Continue** → **Done**
7. Click on the service account you just created
8. Click the **Keys** tab → **Add Key** → **Create new key** → **JSON** → **Create**
9. A file downloads to your computer — **rename it to `credentials.json`** and move it into your `jarvis-lead-gen` folder

**Part C — Share the Sheet with the Service Account**

1. Open `credentials.json` in Notepad
2. Find the line that says `"client_email"` — copy the email address next to it
   (It looks like `jarvis-bot@jarvis-xxxxx.iam.gserviceaccount.com`)
3. Go back to your Google Sheet
4. Click **Share** (top right corner)
5. Paste that email address, set access to **Editor**, click **Send**

---

### Key 4 — Gmail App Password (for HOT lead alerts)

This lets Pro Meridian email you when it finds a HOT lead. You need a special "App Password" — your regular Gmail password won't work here.

1. Go to your **[Google Account settings](https://myaccount.google.com)**
2. Click **Security** in the left menu
3. Make sure **2-Step Verification** is turned ON (it must be on for this to work)
4. In the search bar at the top of the page, type **"App passwords"** and click it
5. Select **Mail** and your device type from the dropdowns
6. Click **Generate** — you'll get a 16-character password like `abcd efgh ijkl mnop`
7. Copy it (remove the spaces when you paste it into the settings file)

---

## Step 4 — Create Your Settings File

In your `jarvis-lead-gen` folder, create a new file called **`.env`**

**How to create it on Windows:**
1. Open Notepad
2. Paste the template below
3. Fill in your keys
4. Click File → Save As
5. Change "Save as type" to **All Files**
6. Name the file exactly **`.env`** (with the dot at the start, no .txt at the end)
7. Save it inside your `jarvis-lead-gen` folder

```
# ── Apify (Scraper) ──────────────────────────
APIFY_TOKEN=paste_your_apify_token_here
APIFY_ACTOR_ID=apify/google-maps-scraper

# ── Anthropic (AI Scoring) ───────────────────
ANTHROPIC_API_KEY=paste_your_anthropic_key_here

# ── Google Sheets (Database) ─────────────────
GOOGLE_SHEETS_CREDENTIALS=credentials.json
GOOGLE_SHEET_ID=paste_your_sheet_id_here
GOOGLE_SHEET_NAME=Leads

# ── Email Alerts ─────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail_address@gmail.com
SMTP_PASSWORD=your16charapppassword
NOTIFICATION_EMAIL=your_gmail_address@gmail.com

# ── What You're Looking For ───────────────────
TARGET_NICHES=contractors,plumbers,HVAC,electricians,roofers
TARGET_LOCATION=San Diego CA

# ── Your Services (used by AI when scoring leads) ──
YOUR_SERVICES=web design,SEO,Google Ads,social media management

# ── Scoring Threshold (leads at or above this score = HOT) ──
HOT_LEAD_THRESHOLD=8

# ── Auto-Run Schedule (what time to run daily) ──
SCHEDULE_TIME=09:00
```

Replace everything that says `paste_your_xxx_here` with your actual keys from Step 3.

---

## Step 5 — Install Dependencies

Open **Command Prompt**, navigate to your project folder, and run:

```
pip install -r requirements.txt
```

This downloads everything Pro Meridian needs to run. It takes 1–2 minutes.

> If you're not sure how to navigate to the folder in Command Prompt, type `cd ` (with a space after it) then drag your `jarvis-lead-gen` folder directly into the Command Prompt window and press Enter.

---

## Step 6 — Test Your Connections

Before running a real scrape, make sure everything is connected properly:

```
python main.py test
```

You should see green checkmarks:
```
✅ Config: all required values present
✅ Claude API: connected
✅ Google Sheets: connected (0 existing leads)
✅ Apify: connected (plan: FREE)
✅ Email (Gmail SMTP): connected
```

If anything shows ❌, double-check that key in your `.env` file and try again.

---

## Step 7 — Launch Pro Meridian

```
python meridian.py
```

Your browser will open automatically at `http://localhost:8000`

The dashboard is live. You're ready.

---

## How to Run a Scrape

1. Click the **Scraper** tab in the top navigation
2. The search queries are pre-filled from your `.env` settings — edit them if needed
3. Click **▶ Start Scrape**
4. The 3D sphere on the Home tab turns green and shows progress in real time
5. When finished, click **Leads** to see your scored results

HOT leads (score 8 or above) will be emailed to you automatically.

---

## Understanding Your Lead Scores

Every lead is scored 1–10 by the AI based on how likely they are to need your services.

| Score | Tier | What It Means |
|---|---|---|
| 8–10 | HOT | Contact today — high need, weak online presence, perfect fit for your services |
| 5–7 | WARM | Good prospect — follow up this week |
| 1–4 | COLD | Low priority — already established online or poor fit |

Each lead also includes:
- **Outreach Angle** — exactly what angle to take when you reach out
- **Best Service** — which of your services fits them most
- **Pain Points** — what problems they likely have right now

---

## Import a Previous Scrape

If you already ran Apify manually and have a Dataset ID, you don't need to scrape again:

1. Go to the **Scraper** tab
2. Scroll down to **Import Existing Dataset**
3. Paste the Dataset ID (find it in Apify → Storage → Datasets)
4. Click **Import Dataset**

It will run the full AI scoring and save everything to your sheet — no extra scraping cost.

---

## Changing Your Target Market

To scrape a different city or niche, edit these two lines in your `.env` file:

```
TARGET_NICHES=restaurants,auto repair,dental offices
TARGET_LOCATION=Austin TX
```

Save the file, restart Pro Meridian, and run a new scrape.

---

## Troubleshooting

**"python is not recognized"**
Reinstall Python from python.org — on the first install screen, make sure to check **"Add Python to PATH"** before clicking Install.

**"No module named xyz"**
Run `pip install -r requirements.txt` again from inside your project folder.

**Google Sheets: permission denied**
Make sure you shared the Google Sheet with the service account email from inside `credentials.json` and gave it Editor access.

**Scrape returned 0 leads**
You may be out of Apify credits. Check your balance at apify.com → Billing. $5 in credits is enough for several hundred leads.

**Email alerts not arriving**
Make sure 2-Step Verification is enabled on your Gmail account and that you used an App Password — not your regular Gmail password.

**Dashboard won't open**
Make sure you ran `python meridian.py` and wait a couple seconds for it to start. Then go to `http://localhost:8000` in your browser manually.

---

## What Each File Does

```
jarvis-lead-gen/
├── meridian.py        ← Start here — launches everything with one command
├── main.py            ← The pipeline (scrape → clean → score → save → notify)
├── scraper.py         ← Connects to Apify and pulls Google Maps data
├── analyzer.py        ← Sends leads to Claude AI for scoring
├── cleaner.py         ← Removes duplicates and bad data
├── sheets.py          ← Reads and writes to your Google Sheet
├── notifier.py        ← Sends HOT lead emails and optional SMS alerts
├── dashboard.py       ← Powers the web dashboard
├── scheduler.py       ← Runs the pipeline automatically every day
├── config.py          ← Loads all your settings from .env
├── static/            ← Dashboard visual files (don't edit these)
├── .env               ← YOUR API KEYS — never share this file
├── credentials.json   ← Google credentials — never share this file
└── requirements.txt   ← List of Python packages needed
```

---

## Security — Important

Your `.env` and `credentials.json` files contain private API keys that give access to paid services.

- Never share them with anyone
- Never upload them to GitHub (the `.gitignore` file already prevents this)
- Never paste them in a chat, email, or screenshot
- If you ever accidentally expose them, go to each service and generate new keys immediately

---

## Built With

- [Apify](https://apify.com) — Google Maps scraping
- [Anthropic Claude](https://anthropic.com) — AI lead scoring and analysis
- [Google Sheets API](https://developers.google.com/sheets) — Lead database
- [FastAPI](https://fastapi.tiangolo.com) — Dashboard backend
- [Three.js](https://threejs.org) — 3D animated sphere
