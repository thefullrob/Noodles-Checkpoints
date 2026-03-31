const STORAGE_KEYS = {
  checklist: "noodles-checkpoint-checklist",
  checklistLabel: "noodles-checkpoint-checklist-label",
  draftPrefix: "noodles-checkpoint-draft-"
};

const DEFAULT_OPTIONS = ["Pass", "Fail", "N/A"];
const BUILT_IN_LABEL = "CheckPoints Version 4";
const BUILT_IN_CHECKLIST = Array.isArray(window.NOODLES_DEFAULT_CHECKLIST)
  ? window.NOODLES_DEFAULT_CHECKLIST
  : [];

const state = {
  checklist: [],
  checklistLabel: BUILT_IN_LABEL,
  responses: {},
  metadata: {
    auditName: "",
    auditDate: "",
    auditorName: "",
    locationName: "",
    shiftName: ""
  }
};

const els = {
  checklistContainer: document.getElementById("checklist-container"),
  checklistTitle: document.getElementById("checklist-title"),
  checklistBadge: document.getElementById("checklist-badge"),
  auditName: document.getElementById("audit-name"),
  auditDate: document.getElementById("audit-date"),
  auditorName: document.getElementById("auditor-name"),
  locationName: document.getElementById("location-name"),
  shiftName: document.getElementById("shift-name"),
  progressPercent: document.getElementById("progress-percent"),
  itemCount: document.getElementById("item-count"),
  answeredCount: document.getElementById("answered-count"),
  scoreCount: document.getElementById("score-count"),
  notesCount: document.getElementById("notes-count"),
  possibleCount: document.getElementById("possible-count"),
  remainingCount: document.getElementById("remaining-count"),
  stickyRemaining: document.getElementById("sticky-remaining"),
  answerBreakdown: document.getElementById("answer-breakdown"),
  autosaveStatus: document.getElementById("autosave-status"),
  fileInput: document.getElementById("file-input"),
  togglePasteButton: document.getElementById("toggle-paste-button"),
  pastePanel: document.getElementById("paste-panel"),
  pasteInput: document.getElementById("paste-input"),
  importPasteButton: document.getElementById("import-paste-button"),
  cancelPasteButton: document.getElementById("cancel-paste-button"),
  exportButton: document.getElementById("export-button"),
  stickyExportButton: document.getElementById("sticky-export-button"),
  downloadTemplateButton: document.getElementById("download-template-button"),
  resetDemoButton: document.getElementById("reset-demo-button"),
  jumpButton: document.getElementById("jump-button"),
  installButton: document.getElementById("install-button"),
  sectionTemplate: document.getElementById("section-template"),
  itemTemplate: document.getElementById("item-template")
};

let deferredInstallPrompt = null;
let autosaveTimer = null;

initialize();

function initialize() {
  hydrateState();
  bindEvents();
  renderAll();
  registerServiceWorker();
}

function hydrateState() {
  const storedChecklist = safeJsonParse(localStorage.getItem(STORAGE_KEYS.checklist));
  const storedChecklistLabel = localStorage.getItem(STORAGE_KEYS.checklistLabel);

  const shouldUseStoredChecklist =
    Array.isArray(storedChecklist) &&
    storedChecklist.length > 0 &&
    storedChecklistLabel !== "Demo checklist";

  if (shouldUseStoredChecklist) {
    state.checklist = sanitizeChecklist(storedChecklist);
    state.checklistLabel = storedChecklistLabel || "Imported checklist";
  } else {
    state.checklist = sanitizeChecklist(BUILT_IN_CHECKLIST);
    state.checklistLabel = BUILT_IN_LABEL;
  }

  const draft = safeJsonParse(localStorage.getItem(getDraftStorageKey()));
  if (draft?.metadata) {
    state.metadata = { ...state.metadata, ...draft.metadata };
  }
  if (draft?.responses) {
    state.responses = draft.responses;
  }

  if (!state.metadata.auditDate) {
    state.metadata.auditDate = new Date().toISOString().slice(0, 10);
  }
  if (!state.metadata.auditName) {
    state.metadata.auditName = state.checklistLabel;
  }
}

function bindEvents() {
  els.fileInput.addEventListener("change", handleFileImport);
  els.togglePasteButton.addEventListener("click", () => {
    els.pastePanel.classList.toggle("hidden");
    if (!els.pastePanel.classList.contains("hidden")) {
      els.pasteInput.focus();
    }
  });
  els.importPasteButton.addEventListener("click", importPastedRows);
  els.cancelPasteButton.addEventListener("click", () => {
    els.pastePanel.classList.add("hidden");
    els.pasteInput.value = "";
  });
  els.exportButton.addEventListener("click", exportAudit);
  els.stickyExportButton.addEventListener("click", exportAudit);
  els.downloadTemplateButton.addEventListener("click", downloadTemplate);
  els.resetDemoButton.addEventListener("click", () => {
    setChecklist(BUILT_IN_CHECKLIST, BUILT_IN_LABEL);
  });
  els.jumpButton.addEventListener("click", jumpToNextIncomplete);
  els.installButton.addEventListener("click", promptInstall);

  for (const [key, input] of Object.entries({
    auditName: els.auditName,
    auditDate: els.auditDate,
    auditorName: els.auditorName,
    locationName: els.locationName,
    shiftName: els.shiftName
  })) {
    input.addEventListener("input", (event) => {
      state.metadata[key] = event.target.value;
      persistDraft();
    });
  }

  els.checklistContainer.addEventListener("click", handleChecklistClick);
  els.checklistContainer.addEventListener("input", handleChecklistInput);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.classList.remove("hidden");
  });
}

function renderAll() {
  renderMetadata();
  renderChecklist();
  renderSummary();
}

function renderMetadata() {
  els.auditName.value = state.metadata.auditName;
  els.auditDate.value = state.metadata.auditDate;
  els.auditorName.value = state.metadata.auditorName;
  els.locationName.value = state.metadata.locationName;
  els.shiftName.value = state.metadata.shiftName;
  els.checklistTitle.textContent = state.checklistLabel;
  els.checklistBadge.textContent = `${state.checklistLabel} (${state.checklist.length} items)`;
}

function renderChecklist() {
  const grouped = groupBySection(state.checklist);
  els.checklistContainer.innerHTML = "";

  grouped.forEach((section) => {
    const sectionNode = els.sectionTemplate.content.firstElementChild.cloneNode(true);
    const answered = section.items.filter((item) => hasAnswer(item.id)).length;
    const earned = section.items.reduce((sum, item) => sum + getScoreValue(item), 0);
    const possible = section.items.reduce((sum, item) => sum + (item.maxPoints || 0), 0);

    sectionNode.querySelector("h3").textContent = section.name;
    sectionNode.querySelector(".section-subtitle").textContent = `${answered} of ${section.items.length} answered`;
    sectionNode.querySelector(".section-pill").textContent = possible ? `${earned}/${possible} pts` : `${answered}/${section.items.length}`;

    const itemsContainer = sectionNode.querySelector(".section-items");
    section.items.forEach((item) => {
      itemsContainer.appendChild(renderItem(item));
    });

    els.checklistContainer.appendChild(sectionNode);
  });
}

function renderItem(item) {
  const node = els.itemTemplate.content.firstElementChild.cloneNode(true);
  const response = getResponse(item.id);
  const title = node.querySelector("h4");
  const details = node.querySelector(".item-details");
  const status = node.querySelector(".item-status");
  const choiceGroup = node.querySelector(".choice-group");
  const notes = node.querySelector("textarea");

  node.dataset.itemId = item.id;
  title.textContent = item.item;

  const detailParts = [];
  if (Number.isFinite(item.maxPoints)) {
    detailParts.push(`Max ${item.maxPoints} point${item.maxPoints === 1 ? "" : "s"}`);
  }
  if (item.details) {
    detailParts.push(item.details);
  }
  if (detailParts.length) {
    details.textContent = detailParts.join(" | ");
    details.classList.remove("hidden");
  }

  status.textContent = getStatusLabel(item);
  notes.value = response.notes || "";
  notes.placeholder = item.notesPlaceholder || "Add details if needed";

  node.classList.toggle("complete", hasAnswer(item.id));
  node.classList.toggle("pending", !hasAnswer(item.id));

  getChoicesForItem(item).forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice-button ${choice.kind}`;
    button.dataset.choice = choice.value;
    button.textContent = choice.label;
    button.classList.toggle("active", response.answer === choice.value);
    choiceGroup.appendChild(button);
  });

  return node;
}

function renderSummary() {
  const total = state.checklist.length;
  const answered = state.checklist.filter((item) => hasAnswer(item.id)).length;
  const notesCount = state.checklist.filter((item) => getResponse(item.id).notes?.trim()).length;
  const remaining = total - answered;
  const completionPercent = total ? Math.round((answered / total) * 100) : 0;
  const possibleScore = state.checklist.reduce((sum, item) => sum + (item.maxPoints || 0), 0);
  const earnedScore = state.checklist.reduce((sum, item) => sum + getScoreValue(item), 0);

  els.itemCount.textContent = total;
  els.answeredCount.textContent = answered;
  els.scoreCount.textContent = `${earnedScore} / ${possibleScore}`;
  els.notesCount.textContent = notesCount;
  els.possibleCount.textContent = possibleScore;
  els.remainingCount.textContent = remaining;
  els.stickyRemaining.textContent = remaining;
  els.progressPercent.textContent = `${completionPercent}%`;
  els.answerBreakdown.innerHTML = "";
  document.querySelector(".ring-shell").style.background =
    `conic-gradient(var(--accent) ${completionPercent * 3.6}deg, rgba(255, 255, 255, 0.7) 0deg)`;

  buildBreakdown().forEach((entry) => {
    const chip = document.createElement("div");
    chip.className = "breakdown-chip";
    chip.textContent = `${entry.label}: ${entry.count}`;
    els.answerBreakdown.appendChild(chip);
  });
}

function handleChecklistClick(event) {
  const button = event.target.closest(".choice-button");
  if (!button) {
    return;
  }

  const itemId = button.closest(".audit-item")?.dataset.itemId;
  if (!itemId) {
    return;
  }

  state.responses[itemId] = {
    ...getResponse(itemId),
    answer: button.dataset.choice
  };

  persistDraft();
  renderAll();
}

function handleChecklistInput(event) {
  const notesField = event.target.closest(".notes-field textarea");
  if (!notesField) {
    return;
  }

  const itemId = event.target.closest(".audit-item")?.dataset.itemId;
  if (!itemId) {
    return;
  }

  state.responses[itemId] = {
    ...getResponse(itemId),
    notes: notesField.value
  };

  persistDraft();
  updateAutosaveStatus("Autosaved notes");
  renderSummary();
}

function handleFileImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  file.text().then((text) => {
    const checklist = buildChecklistFromText(text);
    setChecklist(checklist, file.name.replace(/\.csv$/i, ""));
    event.target.value = "";
  }).catch((error) => {
    alert(`Could not read that file: ${error.message}`);
  });
}

function importPastedRows() {
  const raw = els.pasteInput.value.trim();
  if (!raw) {
    alert("Paste your rows first.");
    return;
  }

  try {
    const checklist = buildChecklistFromText(raw);
    setChecklist(checklist, "Pasted checklist");
    els.pasteInput.value = "";
    els.pastePanel.classList.add("hidden");
  } catch (error) {
    alert(error.message);
  }
}

function setChecklist(sourceRows, label) {
  const nextChecklist = sanitizeChecklist(sourceRows);
  if (!nextChecklist.length) {
    alert("No checklist items were found.");
    return;
  }

  state.checklist = nextChecklist;
  state.checklistLabel = label;
  state.responses = {};
  state.metadata = {
    ...state.metadata,
    auditName: label,
    auditDate: state.metadata.auditDate || new Date().toISOString().slice(0, 10)
  };

  localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(state.checklist));
  localStorage.setItem(STORAGE_KEYS.checklistLabel, state.checklistLabel);
  persistDraft();
  renderAll();
}

function persistDraft() {
  localStorage.setItem(
    getDraftStorageKey(),
    JSON.stringify({
      metadata: state.metadata,
      responses: state.responses
    })
  );

  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  updateAutosaveStatus("Autosaved");
  autosaveTimer = setTimeout(() => {
    updateAutosaveStatus("Autosave ready");
  }, 1200);
}

function exportAudit() {
  const rows = state.checklist.map((item) => {
    const response = getResponse(item.id);
    return {
      audit_name: state.metadata.auditName || state.checklistLabel,
      audit_date: state.metadata.auditDate,
      auditor: state.metadata.auditorName,
      location: state.metadata.locationName,
      shift: state.metadata.shiftName,
      section: item.section,
      item: item.item,
      answer: response.answer || "",
      score: getScoreValue(item),
      max_points: item.maxPoints || "",
      notes: response.notes || ""
    };
  });

  const csv = toCsv(rows);
  const baseName = slugify(state.metadata.auditName || state.checklistLabel || "audit");
  downloadTextFile(`${baseName || "audit"}-results.csv`, csv, "text/csv;charset=utf-8");
}

function downloadTemplate() {
  const templateRows = [
    {
      section: "Kitchen",
      item: "Hot holding temperatures are in range",
      points: 5,
      details: "Check the line and note any temperature misses.",
      "notes placeholder": "Record the pan, temp, and fix."
    },
    {
      section: "Dining Room",
      item: "Lobby music and lighting are set correctly",
      points: 2,
      details: "",
      "notes placeholder": "Add details only if something needs attention."
    }
  ];

  downloadTextFile("checklist-template.csv", toCsv(templateRows), "text/csv;charset=utf-8");
}

function jumpToNextIncomplete() {
  const nextItem = state.checklist.find((item) => !hasAnswer(item.id));
  if (!nextItem) {
    return;
  }

  const target = document.querySelector(`[data-item-id="${CSS.escape(nextItem.id)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function promptInstall() {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.finally(() => {
    deferredInstallPrompt = null;
    els.installButton.classList.add("hidden");
  });
}

function updateAutosaveStatus(text) {
  els.autosaveStatus.textContent = text;
}

function buildChecklistFromText(raw) {
  const parsed = parseDelimitedText(raw);
  if (!parsed.length) {
    throw new Error("That import did not contain any rows.");
  }

  const normalized = rowsToChecklist(parsed);
  if (!normalized.length) {
    throw new Error("The import worked, but I could not find an item column. Use the template if you need a starting point.");
  }

  return normalized;
}

function parseDelimitedText(raw) {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return [];
  }

  const delimiter = detectDelimiter(trimmed);
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    const next = trimmed[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function rowsToChecklist(rows) {
  const [headerRow, ...bodyRows] = rows;
  const headerMap = headerRow.reduce((accumulator, cell, index) => {
    const key = normalizeHeader(cell);
    if (key) {
      accumulator[key] = index;
    }
    return accumulator;
  }, {});

  const hasItemHeader = Number.isInteger(headerMap.item);
  const dataRows = hasItemHeader ? bodyRows : rows;

  return dataRows
    .map((row) => {
      const fallbackMode = !hasItemHeader;
      const section = fallbackMode
        ? (row.length > 1 ? row[0] : "Checklist")
        : readCell(row, headerMap.section, "Checklist");
      const item = fallbackMode
        ? (row.length > 1 ? row[1] : row[0])
        : readCell(row, headerMap.item, "");
      const pointsText = fallbackMode
        ? (row.length > 2 ? row[2] : "")
        : readCell(row, headerMap.points, "");
      const optionsText = fallbackMode
        ? ""
        : readCell(row, headerMap.options, "");
      const details = fallbackMode
        ? (row.length > 3 ? row[3] : "")
        : readCell(row, headerMap.details, "");
      const notesPlaceholder = fallbackMode
        ? (row.length > 4 ? row[4] : "")
        : readCell(row, headerMap.notesPlaceholder, "");

      return {
        section,
        item,
        maxPoints: parseInteger(pointsText),
        options: optionsText ? parseOptions(optionsText) : undefined,
        details,
        notesPlaceholder
      };
    })
    .filter((row) => row.item.trim());
}

function sanitizeChecklist(rows) {
  return rows.map((row, index) => {
    const section = (row.section || "Checklist").trim();
    const item = (row.item || "").trim();
    const maxPoints = Number.isFinite(parseInteger(row.maxPoints)) ? parseInteger(row.maxPoints) : null;
    const options = maxPoints == null
      ? parseOptions(Array.isArray(row.options) ? row.options.join("|") : row.options)
      : null;
    const details = (row.details || "").trim();
    const notesPlaceholder = (row.notesPlaceholder || row.notes_placeholder || "").trim();

    return {
      id: row.id || `${slugify(section) || "section"}-${slugify(item) || "item"}-${index + 1}`,
      section,
      item,
      maxPoints,
      options,
      details,
      notesPlaceholder
    };
  }).filter((row) => row.item);
}

function groupBySection(items) {
  const sections = [];
  const lookup = new Map();

  items.forEach((item) => {
    if (!lookup.has(item.section)) {
      const section = { name: item.section, items: [] };
      lookup.set(item.section, section);
      sections.push(section);
    }
    lookup.get(item.section).items.push(item);
  });

  return sections;
}

function getResponse(itemId) {
  return state.responses[itemId] || { answer: "", notes: "" };
}

function hasAnswer(itemId) {
  return Boolean(getResponse(itemId).answer);
}

function getChoicesForItem(item) {
  if (Number.isFinite(item.maxPoints)) {
    const choices = [];
    for (let score = item.maxPoints; score >= 0; score -= 1) {
      choices.push({
        value: String(score),
        label: String(score),
        kind: toneForScore(score, item.maxPoints)
      });
    }
    choices.push({
      value: "NA",
      label: "N/A",
      kind: "na"
    });
    return choices;
  }

  return (item.options || DEFAULT_OPTIONS).map((option) => ({
    value: option,
    label: option,
    kind: toneForOption(option)
  }));
}

function getStatusLabel(item) {
  const response = getResponse(item.id);
  if (!response.answer) {
    return "Pending";
  }
  if (response.answer === "NA") {
    return "N/A";
  }
  if (Number.isFinite(item.maxPoints)) {
    return `${response.answer}/${item.maxPoints} pts`;
  }
  return response.answer;
}

function getScoreValue(item) {
  const answer = getResponse(item.id).answer;
  if (!answer || answer === "NA" || !Number.isFinite(item.maxPoints)) {
    return 0;
  }
  return parseInteger(answer) || 0;
}

function buildBreakdown() {
  const full = state.checklist.filter((item) => {
    const answer = getResponse(item.id).answer;
    return Number.isFinite(item.maxPoints) && answer !== "NA" && parseInteger(answer) === item.maxPoints;
  }).length;
  const partial = state.checklist.filter((item) => {
    const answer = getResponse(item.id).answer;
    const score = parseInteger(answer);
    return Number.isFinite(item.maxPoints) && score > 0 && score < item.maxPoints;
  }).length;
  const zero = state.checklist.filter((item) => getResponse(item.id).answer === "0").length;
  const na = state.checklist.filter((item) => getResponse(item.id).answer === "NA").length;
  const withNotes = state.checklist.filter((item) => getResponse(item.id).notes?.trim()).length;

  return [
    { label: "Full points", count: full },
    { label: "Partial", count: partial },
    { label: "Zero", count: zero },
    { label: "N/A", count: na },
    { label: "With notes", count: withNotes }
  ];
}

function parseOptions(optionsText) {
  if (Array.isArray(optionsText)) {
    return optionsText.length ? optionsText : DEFAULT_OPTIONS;
  }

  const raw = String(optionsText || "")
    .split(/[|;/]/)
    .map((option) => option.trim())
    .filter(Boolean);

  return raw.length ? raw : DEFAULT_OPTIONS;
}

function normalizeHeader(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  const aliases = {
    section: ["section", "area", "category", "group"],
    item: ["item", "checkpoint", "line item", "question", "task"],
    points: ["points", "point", "max points", "possible points", "score max"],
    options: ["options", "choices", "responses", "answers"],
    details: ["details", "description", "instructions", "help"],
    notesPlaceholder: ["notes placeholder", "note placeholder", "notes prompt", "notes help"]
  };

  return Object.entries(aliases).find(([, words]) => words.includes(clean))?.[0] || "";
}

function readCell(row, index, fallback) {
  if (!Number.isInteger(index)) {
    return fallback;
  }
  return String(row[index] || fallback).trim();
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (firstLine.includes("\t")) {
    return "\t";
  }
  return ",";
}

function parseInteger(value) {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(number) ? number : null;
}

function toneForScore(score, maxScore) {
  if (score === maxScore) {
    return "good";
  }
  if (score === 0) {
    return "warn";
  }
  return "mid";
}

function toneForOption(option) {
  const normalized = option.toLowerCase();
  if (/(pass|yes|ok|good|complete)/.test(normalized)) {
    return "good";
  }
  if (/(n\/a|na|skip|not applicable)/.test(normalized)) {
    return "na";
  }
  return "warn";
}

function getDraftStorageKey() {
  return `${STORAGE_KEYS.draftPrefix}${hashString(JSON.stringify(state.checklist.map((item) => item.id)))}`;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  rows.forEach((row) => {
    const line = headers.map((header) => escapeCsv(row[header])).join(",");
    lines.push(line);
  });

  return lines.join("\r\n");
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadTextFile(fileName, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // App works fine without offline caching.
    });
  }
}
