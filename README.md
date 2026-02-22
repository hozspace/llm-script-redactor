# LLM Script Redactor

Offline table-name redaction for SQL and Databricks PySpark before sending code to an LLM.

## Why this exists

Analysts often use LLMs for SQL/PySpark debugging and optimisation, but it is not advisable to share real table names and locations.
This tool replaces table references with placeholders (for example `redacted.Table_1`) and maps them back after LLM edits.
Databricks built-in AI can do similar tasks, but this tool is useful if you prefer a different LLM or work in UDAL SSMS. 
Unofficial note from the author (James H): the latest Databricks AI update stinks. 

## Run locally

This is a static app. Open `index.html` directly in a browser.

## Core features

- Local-only web app (no backend)
- Redacts table names to deterministic placeholders per script
- Restores placeholders to original table names while preserving LLM edits
- SQL mode and Databricks PySpark mode
- Visual highlighted tokens in AI-safe output with hover-to-view original mapping
- Line numbers in editor boxes
- Lightweight typo checks focused on redaction-critical SQL keywords (for example `FROMM -> FROM` and `LEFFT JOIN -> LEFT JOIN`)
- Optional one-click auto-fix for those typo checks
- Mapping export/import as JSON
- Browser persistence via `localStorage`

## Privacy and data handling

- No server calls are required for redaction/restore
- Script content and mapping are stored only in your local browser `localStorage`
- Use **Clear Local Data** to remove saved local state

## Supported patterns

### SQL mode

Table redaction is designed around common reference locations such as:

- `FROM ...`
- `JOIN ...`
- `UPDATE ...`
- `INTO ...`
- `DELETE FROM ...`
- `MERGE INTO ...`
- `TRUNCATE TABLE ...`

### Databricks PySpark mode

Table redaction targets common DataFrame access/write calls:

- `spark.table("...")`
- `spark.read.table("...")`
- `.saveAsTable("...")`
- `.insertInto("...")`

## Typical workflow

1. Paste your script into **1. Original Script**
2. Click **Generate AI-safe Script**
3. Copy from **2. AI-safe Script** and send to your LLM for edits
4. Paste LLM output into **3. LLM-edited Script**
5. Click **Restore original table names**
6. Copy final output from **4. Restored Script**

## Scope limits (intentional)

- This is a redaction helper, not a full SQL/PySpark parser
- Column names are not redacted in this MVP
- If an LLM removes or rewrites placeholders, restore can be partial
- Very unusual syntax patterns may not be captured by MVP regex rules

## Troubleshooting

- If UI styles look stale, hard refresh (`Cmd+Shift+R` on macOS)
- If restore fails, check mapping exists in **Table Mapping**
- If placeholders were changed by the LLM, re-run redaction and retry
- If you move browsers/devices, import mapping JSON to restore continuity

## Files

- `index.html` - structure and controls
- `styles.css` - themes and layout
- `app.js` - redaction/restore logic and UI behaviour
