(() => {
  const sourceSqlEl = document.getElementById("sourceSql");
  const redactedSqlEl = document.getElementById("redactedSql");
  const editedSqlEl = document.getElementById("editedSql");
  const restoredSqlEl = document.getElementById("restoredSql");
  const mappingSummaryEl = document.getElementById("mappingSummary");
  const redactedTokenBoxEl = document.getElementById("redactedTokenBox");
  const typoSummaryEl = document.getElementById("typoSummary");
  const importMapInputEl = document.getElementById("importMapInput");
  const scriptModeSelectEl = document.getElementById("scriptModeSelect");
  const demoToggleBtnEl = document.getElementById("demoToggleBtn");
  const darkModeBtnEl = document.getElementById("darkModeBtn");
  const expandButtons = [...document.querySelectorAll(".expand-btn")];
  const allTextareas = [...document.querySelectorAll("textarea:not(.hidden-storage)")];
  const editorPairs = [
    { textarea: sourceSqlEl, gutter: document.getElementById("sourceSqlLines") },
    { textarea: redactedSqlEl, gutter: document.getElementById("redactedSqlLines"), view: redactedTokenBoxEl },
    { textarea: editedSqlEl, gutter: document.getElementById("editedSqlLines") },
    { textarea: restoredSqlEl, gutter: document.getElementById("restoredSqlLines") }
  ];

  const redactBtn = document.getElementById("redactBtn");
  const autoFixBtn = document.getElementById("autoFixBtn");
  const clearBtn = document.getElementById("clearBtn");
  const copyRedactedBtn = document.getElementById("copyRedactedBtn");
  const restoreBtn = document.getElementById("restoreBtn");
  const copyRestoredBtn = document.getElementById("copyRestoredBtn");
  const exportMapBtn = document.getElementById("exportMapBtn");

  let currentMapping = {};
  let currentSqlTypoFindings = [];
  const STORAGE_KEY = "sqlRedactorState_v1";
  const DEFAULT_SCRIPT_MODE = "sql";
  const MAX_AUTO_ROWS = 36;
  const expandedEditors = new Set();
  let ui = {
    scriptMode: DEFAULT_SCRIPT_MODE,
    darkMode: false,
    demoMode: false
  };
  const SQL_DEMO_SCRIPT = `SELECT
  f.EpisodeOfCareId,
  f.ReportingPeriodStartDate,
  f.ReportingPeriodEndDate,
  DATEDIFF(DAY, f.ReportingPeriodStartDate, f.ReportingPeriodEndDate) AS DaysBetweenPeriods
FROM demo_catalog.demo_silver.fake_episodes AS f
LEFT JOIN demo_catalog.demo_reference.fake_commissioners AS b
  ON f.originatingccgname = b.SubICB_Code
WHERE f.ReportingPeriodStartDate >= '2025-01-01';`;
  const PYSPARK_DEMO_SCRIPT = `from pyspark.sql import functions as F

episodes = spark.read.table("demo_catalog.demo_silver.fake_episodes")
commissioners = spark.table("demo_catalog.demo_reference.fake_commissioners")

result_df = (
    episodes.alias("f")
    .join(commissioners.alias("b"), F.col("f.originatingccgname") == F.col("b.SubICB_Code"), "left")
    .withColumn("DaysBetweenPeriods", F.datediff(F.col("f.ReportingPeriodEndDate"), F.col("f.ReportingPeriodStartDate")))
)

result_df.write.mode("overwrite").saveAsTable("demo_catalog.demo_mart.fake_episode_summary")`;

  const KEYWORD_PATTERN = [
    "FROM",
    "JOIN",
    "UPDATE",
    "INTO",
    "MERGE\\s+INTO",
    "DELETE\\s+FROM",
    "TRUNCATE\\s+TABLE"
  ].join("|");

  const IDENTIFIER = "(?:\\[[^\\]]+\\]|\"[^\"]+\"|`[^`]+`|[A-Za-z_][A-Za-z0-9_$#]*)";
  const QUALIFIED = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER}){0,3}`;
  const TABLE_REF_REGEX = new RegExp(
    String.raw`\b(?:${KEYWORD_PATTERN})\b(\s+)(?:ONLY\s+)?(${QUALIFIED})`,
    "gi"
  );
  const SQL_TYPO_CHECKS = [
    { regex: /\bFROMM\b/gi, fix: "FROM" },
    { regex: /\bFRMO\b/gi, fix: "FROM" },
    { regex: /\bLEFFT\s+JOIN\b/gi, fix: "LEFT JOIN" },
    { regex: /\bLEFTJOIN\b/gi, fix: "LEFT JOIN" },
    { regex: /\bRIGTH\s+JOIN\b/gi, fix: "RIGHT JOIN" },
    { regex: /\bRIGHTJOIN\b/gi, fix: "RIGHT JOIN" },
    { regex: /\bINNNER\s+JOIN\b/gi, fix: "INNER JOIN" },
    { regex: /\bINNERJOIN\b/gi, fix: "INNER JOIN" },
    { regex: /\bFULLJOIN\b/gi, fix: "FULL JOIN" },
    { regex: /\bCROSSJOIN\b/gi, fix: "CROSS JOIN" },
    { regex: /\bOUTTER\s+JOIN\b/gi, fix: "OUTER JOIN" },
    { regex: /\bUPDTAE\b/gi, fix: "UPDATE" },
    { regex: /\bUPATE\b/gi, fix: "UPDATE" },
    { regex: /\bINTOO\b/gi, fix: "INTO" },
    { regex: /\bDELETEFROM\b/gi, fix: "DELETE FROM" },
    { regex: /\bDELET\s+FROM\b/gi, fix: "DELETE FROM" },
    { regex: /\bMERGEINTO\b/gi, fix: "MERGE INTO" },
    { regex: /\bTRUNCATETABLE\b/gi, fix: "TRUNCATE TABLE" },
    { regex: /\bTRUNCATE\s+TABL\b/gi, fix: "TRUNCATE TABLE" },
    { regex: /\bMERGE\s+INTOO\b/gi, fix: "MERGE INTO" }
  ];

  function canonicalTableRef(raw) {
    return raw.replace(/\s+/g, "").toLowerCase();
  }

  function isLikelyTableRef(ref) {
    const trimmed = ref.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("(")) return false;
    if (/^redacted\.Table_\d+$/i.test(trimmed)) return false;
    return true;
  }

  function isQualifiedOrQuotedTableRef(ref) {
    const trimmed = ref.trim();
    if (!trimmed) return false;
    if (trimmed.includes(".")) return true;
    return /^[`"\[]/.test(trimmed);
  }

  function startsWithSqlClause(text) {
    return /^(?:,|\)|;|WHERE\b|GROUP\s+BY\b|ORDER\s+BY\b|HAVING\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|FULL\b|CROSS\b|UNION\b|INTERSECT\b|EXCEPT\b|LIMIT\b|QUALIFY\b|WINDOW\b|SAMPLE\b|LATERAL\b|ON\b|USING\b|SET\b|VALUES\b)/i.test(
      text
    );
  }

  function hasLikelyAliasThenClause(text) {
    const aliasMatch = /^(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$#]*)\b/i.exec(text);
    if (!aliasMatch) return false;
    const afterAlias = text.slice(aliasMatch[0].length).trimStart();
    if (!afterAlias) return true;
    return startsWithSqlClause(afterAlias);
  }

  function shouldRedactSqlTableRef(tableRef, tail) {
    if (!isLikelyTableRef(tableRef)) return false;
    if (isQualifiedOrQuotedTableRef(tableRef)) return true;

    const trimmedTail = tail.trimStart();
    if (!trimmedTail) return true;
    if (startsWithSqlClause(trimmedTail)) return true;
    if (hasLikelyAliasThenClause(trimmedTail)) return true;
    return false;
  }

  function buildSqlProtectedMask(sql) {
    const mask = new Uint8Array(sql.length);
    let i = 0;
    let mode = "none";

    while (i < sql.length) {
      const ch = sql[i];
      const next = sql[i + 1];

      if (mode === "none") {
        if (ch === "-" && next === "-") {
          mask[i] = 1;
          i += 1;
          mask[i] = 1;
          mode = "lineComment";
        } else if (ch === "/" && next === "*") {
          mask[i] = 1;
          i += 1;
          mask[i] = 1;
          mode = "blockComment";
        } else if (ch === "'") {
          mask[i] = 1;
          mode = "singleQuote";
        } else if (ch === '"') {
          mask[i] = 1;
          mode = "doubleQuote";
        } else if (ch === "`") {
          mask[i] = 1;
          mode = "backtick";
        } else if (ch === "[") {
          mask[i] = 1;
          mode = "bracket";
        }
        i += 1;
        continue;
      }

      mask[i] = 1;

      if (mode === "lineComment") {
        if (ch === "\n") mode = "none";
      } else if (mode === "blockComment") {
        if (ch === "*" && next === "/") {
          i += 1;
          mask[i] = 1;
          mode = "none";
        }
      } else if (mode === "singleQuote") {
        if (ch === "'" && next === "'") {
          i += 1;
          mask[i] = 1;
        } else if (ch === "'") {
          mode = "none";
        }
      } else if (mode === "doubleQuote") {
        if (ch === '"' && next === '"') {
          i += 1;
          mask[i] = 1;
        } else if (ch === '"') {
          mode = "none";
        }
      } else if (mode === "backtick") {
        if (ch === "`") mode = "none";
      } else if (mode === "bracket") {
        if (ch === "]") mode = "none";
      }

      i += 1;
    }

    return mask;
  }

  function isLikelyPySparkTableRef(ref) {
    const trimmed = ref.trim();
    if (!trimmed) return false;
    if (/^redacted\.Table_\d+$/i.test(trimmed)) return false;
    if (!trimmed.includes(".")) return false;
    if (/\s/.test(trimmed)) return false;
    return true;
  }

  function nextPlaceholderFactory() {
    let counter = 1;
    return () => `redacted.Table_${counter++}`;
  }

  function redactSql(sql) {
    const byCanonical = {};
    const mapping = {};
    const nextPlaceholder = nextPlaceholderFactory();
    const protectedMask = buildSqlProtectedMask(sql);

    const redacted = sql.replace(TABLE_REF_REGEX, (fullMatch, ws, tableRef, offset, fullSource) => {
      if (protectedMask[offset]) {
        return fullMatch;
      }

      const tail = fullSource.slice(offset + fullMatch.length).trimStart();
      if (/^import\b/i.test(tail)) {
        return fullMatch;
      }

      if (!shouldRedactSqlTableRef(tableRef, tail)) {
        return fullMatch;
      }

      const key = canonicalTableRef(tableRef);
      let placeholder = byCanonical[key];

      if (!placeholder) {
        placeholder = nextPlaceholder();
        byCanonical[key] = placeholder;
        mapping[placeholder] = tableRef.trim();
      }

      return fullMatch.replace(tableRef, placeholder);
    });

    return { redacted, mapping };
  }

  function redactPySparkScript(script) {
    const byCanonical = {};
    const mapping = {};
    const nextPlaceholder = nextPlaceholderFactory();
    const TABLE_CALL_REGEX =
      /((?:\bspark\s*\.\s*table|\bspark\s*\.\s*read\s*\.\s*table|\.\s*saveAsTable|\.\s*insertInto)\s*\(\s*)(["'])([^"'\\\r\n]+)(\2)/gi;

    const redacted = script.replace(TABLE_CALL_REGEX, (fullMatch, prefix, quote, tableRef, closeQuote) => {
      if (!isLikelyPySparkTableRef(tableRef)) {
        return fullMatch;
      }

      const key = canonicalTableRef(tableRef);
      let placeholder = byCanonical[key];
      if (!placeholder) {
        placeholder = nextPlaceholder();
        byCanonical[key] = placeholder;
        mapping[placeholder] = tableRef.trim();
      }

      return `${prefix}${quote}${placeholder}${closeQuote}`;
    });

    return { redacted, mapping };
  }

  function detectScriptMode(source) {
    const pysparkHints =
      /\bspark\s*\.\s*read\s*\.\s*table\s*\(|\bspark\s*\.\s*table\s*\(|\.\s*write\s*\.\s*saveAsTable\s*\(|\.\s*write\s*\.\s*insertInto\s*\(/i;
    return pysparkHints.test(source) ? "pyspark" : "sql";
  }

  function redactByMode(source, mode) {
    if (mode === "pyspark") {
      return redactPySparkScript(source);
    }
    return redactSql(source);
  }

  function detectCommonSqlTypos(source) {
    function lineNumberForIndex(index) {
      let line = 1;
      for (let i = 0; i < index; i++) {
        if (source.charCodeAt(i) === 10) {
          line += 1;
        }
      }
      return line;
    }

    const findings = [];
    for (const check of SQL_TYPO_CHECKS) {
      let match;
      while ((match = check.regex.exec(source)) !== null) {
        findings.push({
          found: match[0],
          fix: check.fix,
          line: lineNumberForIndex(match.index)
        });
        if (findings.length >= 8) {
          return findings;
        }
      }
    }
    return findings;
  }

  function renderTypoSummary(findings) {
    if (!typoSummaryEl) return;
    if (!findings.length) {
      typoSummaryEl.textContent = "No SQL typo warnings.";
      typoSummaryEl.classList.remove("has-issues");
      return;
    }

    const lines = findings.map((f) => `line ${f.line}: ${f.found} -> ${f.fix}`);
    typoSummaryEl.textContent = `Potential SQL typos:\n- ${lines.join("\n- ")}`;
    typoSummaryEl.classList.add("has-issues");
  }

  function applyCommonSqlTypos(source) {
    let fixed = source;
    let replacements = 0;
    for (const check of SQL_TYPO_CHECKS) {
      fixed = fixed.replace(check.regex, () => {
        replacements += 1;
        return check.fix;
      });
    }
    return { fixed, replacements };
  }

  function restoreSql(sql, mapping) {
    let restored = sql;

    // Replace larger indices first to avoid accidental partial replacements.
    const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);
    for (const placeholder of placeholders) {
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "g");
      restored = restored.replace(pattern, mapping[placeholder]);
    }

    return restored;
  }

  function renderMappingSummary(mapping) {
    const entries = Object.entries(mapping);
    if (!entries.length) {
      mappingSummaryEl.textContent = "No mapping generated yet.";
      return;
    }

    const lines = entries.map(([placeholder, original]) => `${placeholder} -> ${original}`);
    mappingSummaryEl.textContent = lines.join("\n");
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderRedactedPreview() {
    if (!redactedTokenBoxEl) return;
    const text = redactedSqlEl.value || "";
    if (!text.trim()) {
      redactedTokenBoxEl.textContent = "";
      return;
    }

    const tokenPattern = /(redacted\.Table_\d+)/gi;
    const parts = text.split(tokenPattern);
    const htmlParts = parts.map((part) => {
      if (/^redacted\.Table_\d+$/i.test(part)) {
        const original = currentMapping[part] || currentMapping[part.toLowerCase()] || "No mapping found";
        const tooltip = `Original: ${original}`;
        return `<span class="redacted-token" data-original="${escapeHtml(tooltip)}">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    });
    redactedTokenBoxEl.innerHTML = htmlParts.join("");
    autoResizePreview();
    updateLineNumbers(redactedSqlEl);
  }

  function saveState() {
    const state = {
      sourceSql: sourceSqlEl.value,
      redactedSql: redactedSqlEl.value,
      editedSql: editedSqlEl.value,
      restoredSql: restoredSqlEl.value,
      mapping: currentMapping,
      ui
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      sourceSqlEl.value = state.sourceSql || "";
      redactedSqlEl.value = state.redactedSql || "";
      editedSqlEl.value = state.editedSql || "";
      restoredSqlEl.value = state.restoredSql || "";
      currentMapping = state.mapping && typeof state.mapping === "object" ? state.mapping : {};
      if (state.ui && typeof state.ui === "object") {
        ui = {
          scriptMode:
            state.ui.scriptMode === "pyspark" || state.ui.scriptMode === "sql"
              ? state.ui.scriptMode
              : DEFAULT_SCRIPT_MODE,
          darkMode: Boolean(state.ui.darkMode),
          demoMode: Boolean(state.ui.demoMode)
        };
      }
    } catch (err) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function autoResize(textarea) {
    textarea.style.height = "auto";
    if (expandedEditors.has(textarea.id)) {
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.style.overflow = "hidden";
      return;
    }

    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight) || 22;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    const maxHeight = Math.round(lineHeight * MAX_AUTO_ROWS + paddingTop + paddingBottom);

    if (textarea.scrollHeight > maxHeight) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflow = "auto";
    } else {
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.style.overflow = "hidden";
    }
  }

  function autoResizePreview() {
    if (!redactedTokenBoxEl) return;
    const sourceHeight = sourceSqlEl.clientHeight || 170;

    if (expandedEditors.has("redactedTokenBox")) {
      redactedTokenBoxEl.style.height = `${redactedTokenBoxEl.scrollHeight}px`;
      redactedTokenBoxEl.style.overflow = "hidden";
      return;
    }

    redactedTokenBoxEl.style.height = `${sourceHeight}px`;
    redactedTokenBoxEl.style.overflow = "auto";
  }

  function sourceTypoLineSet() {
    return new Set(currentSqlTypoFindings.map((f) => f.line));
  }

  function updateLineNumbers(textarea) {
    const pair = editorPairs.find((p) => p.textarea === textarea);
    if (!pair || !pair.gutter) return;
    const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
    const typoLines = textarea === sourceSqlEl ? sourceTypoLineSet() : new Set();
    const html = [];
    for (let i = 1; i <= lineCount; i++) {
      const cls = typoLines.has(i) ? "line-num typo" : "line-num";
      html.push(`<div class="${cls}">${i}</div>`);
    }
    pair.gutter.innerHTML = html.join("");
    const scrollSource = pair.view || textarea;
    const visibleHeight = `${scrollSource.clientHeight}px`;
    pair.gutter.style.height = visibleHeight;
    if (pair.gutter.parentElement) {
      pair.gutter.parentElement.style.height = visibleHeight;
    }
    pair.gutter.scrollTop = scrollSource.scrollTop;
  }

  function refreshAllLineNumbers() {
    editorPairs.forEach((pair) => updateLineNumbers(pair.textarea));
  }

  function resizeAllTextareas() {
    allTextareas.forEach(autoResize);
    autoResizePreview();
    refreshAllLineNumbers();
  }

  function updateExpandButtonLabel(textareaId) {
    const button = expandButtons.find((btn) => btn.dataset.target === textareaId);
    if (!button) return;
    button.textContent = expandedEditors.has(textareaId) ? "Collapse box" : "Expand box";
  }

  function applyUiTheme() {
    document.body.dataset.mode = ui.darkMode ? "dark" : "light";
    scriptModeSelectEl.value = ui.scriptMode || DEFAULT_SCRIPT_MODE;
    darkModeBtnEl.textContent = ui.darkMode ? "Light mode" : "Dark mode";
    demoToggleBtnEl.textContent = ui.demoMode ? "Demo data: On" : "Demo data: Off";
  }

  function updateSourcePlaceholder() {
    sourceSqlEl.placeholder =
      ui.scriptMode === "pyspark"
        ? "Paste your Databricks PySpark script here..."
        : "Paste your SQL script here...";
  }

  function activeDemoScript() {
    return ui.scriptMode === "pyspark" ? PYSPARK_DEMO_SCRIPT : SQL_DEMO_SCRIPT;
  }

  function applyDemoScript() {
    sourceSqlEl.value = activeDemoScript();
    redactedSqlEl.value = "";
    editedSqlEl.value = "";
    restoredSqlEl.value = "";
    currentMapping = {};
    currentSqlTypoFindings =
      ui.scriptMode === "sql" ? detectCommonSqlTypos(sourceSqlEl.value || "") : [];
    renderTypoSummary(currentSqlTypoFindings);
    renderMappingSummary(currentMapping);
    renderRedactedPreview();
    resizeAllTextareas();
    saveState();
  }

  async function copyText(value, label) {
    if (!value.trim()) return;

    try {
      await navigator.clipboard.writeText(value);
      alert(`${label} copied to clipboard.`);
    } catch (err) {
      alert(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  redactBtn.addEventListener("click", () => {
    const source = sourceSqlEl.value;
    if (!source.trim()) {
      alert("Paste a script into the first box before redacting.");
      return;
    }

    let activeMode = ui.scriptMode;
    if (ui.scriptMode === "sql") {
      const detectedMode = detectScriptMode(source);
      if (detectedMode === "pyspark") {
        activeMode = "pyspark";
        ui.scriptMode = "pyspark";
        scriptModeSelectEl.value = "pyspark";
      }
    }

    if (activeMode === "sql") {
      currentSqlTypoFindings = detectCommonSqlTypos(source);
      renderTypoSummary(currentSqlTypoFindings);
      updateLineNumbers(sourceSqlEl);
      if (currentSqlTypoFindings.length) {
        const typoLines = currentSqlTypoFindings.map(
          (f) => `line ${f.line}: ${f.found} -> ${f.fix}`
        );
        const shouldContinue = confirm(
          `Potential SQL typos found:\n- ${typoLines.join("\n- ")}\n\nContinue redaction anyway?`
        );
        if (!shouldContinue) {
          return;
        }
      }
    }

    const { redacted, mapping } = redactByMode(source, activeMode);
    currentMapping = mapping;
    redactedSqlEl.value = redacted;
    renderRedactedPreview();
    editedSqlEl.value = "";
    restoredSqlEl.value = "";
    renderMappingSummary(currentMapping);
    resizeAllTextareas();
    saveState();
  });

  restoreBtn.addEventListener("click", () => {
    const edited = editedSqlEl.value;
    if (!edited.trim()) {
      alert("Paste LLM-edited script into the third box before restoring.");
      return;
    }

    if (!Object.keys(currentMapping).length) {
      alert("No table mapping available. Generate or import a mapping first.");
      return;
    }

    restoredSqlEl.value = restoreSql(edited, currentMapping);
    autoResize(restoredSqlEl);
    updateLineNumbers(restoredSqlEl);
    saveState();
  });

  copyRedactedBtn.addEventListener("click", () => copyText(redactedSqlEl.value, "AI-safe script"));
  copyRestoredBtn.addEventListener("click", () => copyText(restoredSqlEl.value, "restored script"));

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all SQL, mappings, and local settings from this browser?")) {
      return;
    }

    sourceSqlEl.value = "";
    redactedSqlEl.value = "";
    renderRedactedPreview();
    editedSqlEl.value = "";
    restoredSqlEl.value = "";
    currentMapping = {};
    currentSqlTypoFindings = [];
    ui = {
      scriptMode: DEFAULT_SCRIPT_MODE,
      darkMode: false,
      demoMode: false
    };
    renderMappingSummary(currentMapping);
    renderTypoSummary(currentSqlTypoFindings);
    localStorage.removeItem(STORAGE_KEY);
    applyUiTheme();
    resizeAllTextareas();
  });

  exportMapBtn.addEventListener("click", () => {
    if (!Object.keys(currentMapping).length) {
      alert("No mapping to export yet.");
      return;
    }

    downloadJson("sql-table-mapping.json", currentMapping);
  });

  importMapInputEl.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid mapping format");
      }

      const cleaned = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!/^redacted\.Table_\d+$/i.test(k) || typeof v !== "string" || !v.trim()) {
          continue;
        }
        cleaned[k] = v;
      }

      if (!Object.keys(cleaned).length) {
        throw new Error("No valid mapping entries found");
      }

      currentMapping = cleaned;
      renderMappingSummary(currentMapping);
      renderRedactedPreview();
      saveState();
      alert("Mapping imported.");
    } catch (err) {
      alert("Failed to import mapping JSON.");
    } finally {
      importMapInputEl.value = "";
    }
  });

  scriptModeSelectEl.addEventListener("change", () => {
    ui.scriptMode = scriptModeSelectEl.value === "pyspark" ? "pyspark" : DEFAULT_SCRIPT_MODE;
    if (ui.scriptMode === "sql") {
      currentSqlTypoFindings = detectCommonSqlTypos(sourceSqlEl.value || "");
    } else {
      currentSqlTypoFindings = [];
    }
    renderTypoSummary(currentSqlTypoFindings);
    updateLineNumbers(sourceSqlEl);
    updateSourcePlaceholder();
    if (ui.demoMode) {
      applyDemoScript();
    }
    saveState();
  });

  demoToggleBtnEl.addEventListener("click", () => {
    ui.demoMode = !ui.demoMode;
    applyUiTheme();
    if (ui.demoMode) {
      applyDemoScript();
      return;
    }
    const demoSql = activeDemoScript();
    if ((sourceSqlEl.value || "").trim() === demoSql.trim()) {
      sourceSqlEl.value = "";
      currentSqlTypoFindings = [];
      renderTypoSummary(currentSqlTypoFindings);
      autoResize(sourceSqlEl);
      updateLineNumbers(sourceSqlEl);
    }
    saveState();
  });

  darkModeBtnEl.addEventListener("click", () => {
    ui.darkMode = !ui.darkMode;
    applyUiTheme();
    saveState();
  });

  allTextareas.forEach((el) => {
    el.addEventListener("input", () => {
      if (el === sourceSqlEl) {
        if (ui.scriptMode === "sql") {
          currentSqlTypoFindings = detectCommonSqlTypos(sourceSqlEl.value || "");
        } else {
          currentSqlTypoFindings = [];
        }
        renderTypoSummary(currentSqlTypoFindings);
      }
      autoResize(el);
      if (el === sourceSqlEl) {
        autoResizePreview();
        updateLineNumbers(redactedSqlEl);
      }
      updateLineNumbers(el);
      saveState();
    });
    el.addEventListener("scroll", () => updateLineNumbers(el));
  });

  redactedTokenBoxEl.addEventListener("scroll", () => updateLineNumbers(redactedSqlEl));

  expandButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      if (expandedEditors.has(targetId)) {
        expandedEditors.delete(targetId);
      } else {
        expandedEditors.add(targetId);
      }
      updateExpandButtonLabel(targetId);
      if (targetId === "redactedTokenBox") {
        autoResizePreview();
        updateLineNumbers(redactedSqlEl);
      } else {
        autoResize(targetEl);
        updateLineNumbers(targetEl);
      }
    });
  });

  autoFixBtn.addEventListener("click", () => {
    if (ui.scriptMode !== "sql") {
      alert("Auto-fix is available in SQL mode only.");
      return;
    }

    const { fixed, replacements } = applyCommonSqlTypos(sourceSqlEl.value || "");
    if (!replacements) {
      alert("No configured SQL typos were found.");
      return;
    }

    sourceSqlEl.value = fixed;
    currentSqlTypoFindings = detectCommonSqlTypos(sourceSqlEl.value || "");
    renderTypoSummary(currentSqlTypoFindings);
    autoResize(sourceSqlEl);
    updateLineNumbers(sourceSqlEl);
    saveState();
    alert(`Auto-fix applied ${replacements} replacement${replacements === 1 ? "" : "s"}.`);
  });

  loadState();
  if (ui.demoMode && !(sourceSqlEl.value || "").trim()) {
    sourceSqlEl.value = activeDemoScript();
  }
  currentSqlTypoFindings =
    ui.scriptMode === "sql" ? detectCommonSqlTypos(sourceSqlEl.value || "") : [];
  applyUiTheme();
  updateSourcePlaceholder();
  renderMappingSummary(currentMapping);
  renderRedactedPreview();
  renderTypoSummary(currentSqlTypoFindings);
  resizeAllTextareas();
  refreshAllLineNumbers();
  expandButtons.forEach((button) => updateExpandButtonLabel(button.dataset.target));
})();
