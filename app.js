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
const LOCATION_EMAILS = {
  "Bishops Corner": "bishopscorner@hartfordnoodles.com",
  Southington: "southington@hartfordnoodles.com",
  Manchester: "manchester@hartfordnoodles.com",
  Middletown: "middletown@hartfordnoodles.com"
};
const PHOTO_DB_NAME = "noodles-checkpoint-audit-photos";
const PHOTO_STORE_NAME = "photos";
const PHOTO_MAX_DIMENSION = 1400;
const PHOTO_QUALITY = 0.82;

const state = {
  checklist: [],
  checklistLabel: BUILT_IN_LABEL,
  responses: {},
  photoData: {},
  metadata: {
    auditDate: "",
    auditorName: "",
    locationName: "",
    shiftName: "",
    recipientEmail: ""
  }
};

const els = {
  checklistContainer: document.getElementById("checklist-container"),
  checklistTitle: document.getElementById("checklist-title"),
  auditDate: document.getElementById("audit-date"),
  auditorName: document.getElementById("auditor-name"),
  locationName: document.getElementById("location-name"),
  shiftName: document.getElementById("shift-name"),
  recipientEmail: document.getElementById("recipient-email"),
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
  managerScore: document.getElementById("manager-score"),
  managerGrade: document.getElementById("manager-grade"),
  managerOverview: document.getElementById("manager-overview"),
  strengthList: document.getElementById("strength-list"),
  focusList: document.getElementById("focus-list"),
  noteList: document.getElementById("note-list"),
  clearAuditButton: document.getElementById("clear-audit-button"),
  jumpButton: document.getElementById("jump-button"),
  installButton: document.getElementById("install-button"),
  primaryShareButton: document.getElementById("primary-share-button"),
  summaryButton: document.getElementById("summary-button"),
  emailButton: document.getElementById("email-button"),
  printButton: document.getElementById("print-button"),
  chatgptButton: document.getElementById("chatgpt-button"),
  openChatgptButton: document.getElementById("open-chatgpt-button"),
  sectionTemplate: document.getElementById("section-template"),
  itemTemplate: document.getElementById("item-template")
};

let deferredInstallPrompt = null;
let autosaveTimer = null;
let photoDbPromise = null;

initialize();

async function initialize() {
  hydrateState();
  await hydratePhotos();
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
    state.responses = normalizeResponses(draft.responses);
  }

  if (!state.metadata.auditDate) {
    state.metadata.auditDate = new Date().toISOString().slice(0, 10);
  }
}

async function hydratePhotos() {
  const referencedPhotoIds = getAllReferencedPhotoIds();
  if (!referencedPhotoIds.length) {
    state.photoData = {};
    return;
  }

  try {
    const photoRecords = await getPhotoRecords(referencedPhotoIds);
    const availablePhotoIds = new Set();
    state.photoData = {};

    photoRecords.forEach((record) => {
      if (record?.id && record?.dataUrl) {
        availablePhotoIds.add(record.id);
        state.photoData[record.id] = record.dataUrl;
      }
    });

    let didPruneMissing = false;
    Object.entries(state.responses).forEach(([itemId, response]) => {
      const photos = Array.isArray(response?.photos)
        ? response.photos.filter((photoId) => availablePhotoIds.has(photoId))
        : [];

      if ((response?.photos || []).length !== photos.length) {
        state.responses[itemId] = {
          ...getResponse(itemId),
          photos
        };
        didPruneMissing = true;
      }
    });

    if (didPruneMissing) {
      persistDraft(true);
    }
  } catch {
    state.photoData = {};
    updateAutosaveStatus("Photo cache unavailable");
  }
}

function bindEvents() {
  els.clearAuditButton.addEventListener("click", clearAuditData);
  els.jumpButton.addEventListener("click", jumpToNextIncomplete);
  els.installButton.addEventListener("click", promptInstall);
  els.primaryShareButton.addEventListener("click", shareReport);
  els.summaryButton.addEventListener("click", () => openSummaryWindow(false));
  els.emailButton.addEventListener("click", emailSummary);
  els.printButton.addEventListener("click", () => openSummaryWindow(true));
  els.chatgptButton.addEventListener("click", copyForChatGPT);
  els.openChatgptButton.addEventListener("click", openChatGPT);

  for (const [key, input] of Object.entries({
    auditDate: els.auditDate,
    auditorName: els.auditorName,
    locationName: els.locationName,
    shiftName: els.shiftName,
    recipientEmail: els.recipientEmail
  })) {
    const updateMetadata = (event) => {
      state.metadata[key] = event.target.value;
      if (key === "locationName") {
        const autoEmail = LOCATION_EMAILS[event.target.value] || "";
        state.metadata.recipientEmail = autoEmail;
        els.recipientEmail.value = autoEmail;
      }
      persistDraft();
      renderMetadata();
      renderManagerSummary();
    };
    input.addEventListener("input", updateMetadata);
    input.addEventListener("change", updateMetadata);
  }

  els.checklistContainer.addEventListener("click", handleChecklistClick);
  els.checklistContainer.addEventListener("input", handleChecklistInput);
  els.checklistContainer.addEventListener("change", handleChecklistChange);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.classList.remove("hidden");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistDraft(true);
    }
  });

  window.addEventListener("pagehide", () => {
    persistDraft(true);
  });
}

function renderAll() {
  renderMetadata();
  renderChecklist();
  renderSummary();
  renderManagerSummary();
}

function renderMetadata() {
  els.auditDate.value = state.metadata.auditDate;
  els.auditorName.value = state.metadata.auditorName;
  els.locationName.value = state.metadata.locationName;
  els.shiftName.value = state.metadata.shiftName;
  els.recipientEmail.value = state.metadata.recipientEmail;
  els.checklistTitle.textContent = state.checklistLabel;
}

function renderChecklist() {
  const grouped = groupBySection(state.checklist);
  els.checklistContainer.innerHTML = "";

  grouped.forEach((section) => {
    const sectionNode = els.sectionTemplate.content.firstElementChild.cloneNode(true);
    const metrics = getSectionMetrics(section.items);

    sectionNode.querySelector("h3").textContent = section.name;
    sectionNode.querySelector(".section-subtitle").textContent = `${metrics.answered} of ${section.items.length} answered`;
    sectionNode.querySelector(".section-pill").textContent = metrics.possible
      ? `${metrics.earned}/${metrics.possible} pts`
      : `${metrics.answered}/${section.items.length}`;

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
  const photoTrigger = node.querySelector(".photo-trigger");
  const photoInput = node.querySelector(".photo-input");
  const photoStrip = node.querySelector(".photo-strip");

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
  photoInput.setAttribute("aria-label", `Add photo for ${item.item}`);

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

  const photoIds = Array.isArray(response.photos) ? response.photos : [];
  photoTrigger.querySelector("span").textContent = photoIds.length ? "Add Another Photo" : "Add Photo";

  if (photoIds.length) {
    photoStrip.classList.remove("hidden");
    photoIds.forEach((photoId, index) => {
      const imageSrc = state.photoData[photoId];
      if (!imageSrc) {
        return;
      }

      const card = document.createElement("div");
      card.className = "photo-card";
      card.innerHTML = `
        <figure class="photo-thumb">
          <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(`${item.item} photo ${index + 1}`)}" loading="lazy">
        </figure>
        <div class="photo-meta">
          <div>
            <strong>Photo ${index + 1}</strong>
            <div>${escapeHtml(item.section)}</div>
          </div>
          <button class="remove-photo-button" type="button" data-photo-id="${escapeHtml(photoId)}">Remove</button>
        </div>
      `;
      photoStrip.appendChild(card);
    });

    if (!photoStrip.childElementCount) {
      photoStrip.classList.add("hidden");
    }
  }

  return node;
}

function renderSummary() {
  const metrics = getAuditMetrics();
  const completionPercent = metrics.totalItems ? Math.round((metrics.answeredItems / metrics.totalItems) * 100) : 0;

  els.itemCount.textContent = metrics.totalItems;
  els.answeredCount.textContent = metrics.answeredItems;
  els.scoreCount.textContent = `${metrics.earnedScore} / ${metrics.possibleScore}`;
  els.notesCount.textContent = metrics.notesCount;
  els.possibleCount.textContent = metrics.possibleScore;
  els.remainingCount.textContent = metrics.remainingItems;
  els.stickyRemaining.textContent = metrics.remainingItems;
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

function renderManagerSummary() {
  const report = buildManagerReportData();

  els.managerScore.textContent = `${report.metrics.earnedScore} / ${report.metrics.possibleScore}`;
  els.managerGrade.textContent = report.metrics.grade;
  els.managerOverview.textContent = report.overview;

  fillList(els.strengthList, report.strengths, "Add a few completed strengths to populate this section.");
  fillList(els.focusList, report.focusItems, "Items below full points will show up here.");
  fillList(els.noteList, report.notedItems, "Any detailed notes will show up here.");
}

function fillList(listElement, items, emptyMessage) {
  listElement.innerHTML = "";
  const source = items.length ? items : [emptyMessage];
  source.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listElement.appendChild(li);
  });
}

function handleChecklistClick(event) {
  const photoTrigger = event.target.closest(".photo-trigger");
  if (photoTrigger) {
    const itemNode = photoTrigger.closest(".audit-item");
    itemNode?.querySelector(".photo-input")?.click();
    return;
  }

  const removePhotoButton = event.target.closest(".remove-photo-button");
  if (removePhotoButton) {
    const itemId = removePhotoButton.closest(".audit-item")?.dataset.itemId;
    const photoId = removePhotoButton.dataset.photoId;
    if (!itemId || !photoId) {
      return;
    }

    void removeItemPhoto(itemId, photoId);
    return;
  }

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
  renderManagerSummary();
}

function handleChecklistChange(event) {
  const photoInput = event.target.closest(".photo-input");
  if (!photoInput) {
    return;
  }

  void saveItemPhoto(photoInput);
}

async function saveItemPhoto(photoInput) {
  const itemId = photoInput.closest(".audit-item")?.dataset.itemId;
  const file = photoInput.files?.[0];
  photoInput.value = "";

  if (!itemId || !file) {
    return;
  }

  updateAutosaveStatus("Saving photo...");

  try {
    const dataUrl = await compressImageFile(file);
    const photoId = createPhotoId(itemId);
    await savePhotoRecord({
      id: photoId,
      itemId,
      addedAt: Date.now(),
      dataUrl
    });

    state.photoData[photoId] = dataUrl;
    state.responses[itemId] = {
      ...getResponse(itemId),
      photos: [...getResponse(itemId).photos, photoId]
    };

    persistDraft(true);
    renderAll();
    updateAutosaveStatus("Photo saved");
  } catch (error) {
    updateAutosaveStatus("Photo save failed");
    alert(`That photo could not be saved. ${error.message || "Please try again."}`);
  }
}

async function removeItemPhoto(itemId, photoId) {
  const response = getResponse(itemId);
  if (!response.photos.includes(photoId)) {
    return;
  }

  updateAutosaveStatus("Removing photo...");

  try {
    await deletePhotoRecord(photoId);
    delete state.photoData[photoId];
    state.responses[itemId] = {
      ...response,
      photos: response.photos.filter((currentId) => currentId !== photoId)
    };
    persistDraft(true);
    renderAll();
    updateAutosaveStatus("Photo removed");
  } catch {
    updateAutosaveStatus("Photo remove failed");
    alert("That photo could not be removed right now. Please try again.");
  }
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

async function setChecklist(sourceRows, label) {
  const nextChecklist = sanitizeChecklist(sourceRows);
  if (!nextChecklist.length) {
    alert("No checklist items were found.");
    return;
  }

  await deleteReferencedPhotos(getAllReferencedPhotoIds());

  state.checklist = nextChecklist;
  state.checklistLabel = label;
  state.responses = {};
  state.photoData = {};
  state.metadata = {
    ...state.metadata,
    auditDate: state.metadata.auditDate || new Date().toISOString().slice(0, 10)
  };

  localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(state.checklist));
  localStorage.setItem(STORAGE_KEYS.checklistLabel, state.checklistLabel);
  persistDraft();
  renderAll();
}

async function clearAuditData() {
  const confirmed = window.confirm(
    "Are you sure you want to clear this audit? This will remove all scores, notes, photos, and audit details for the current checklist."
  );
  if (!confirmed) {
    return;
  }

  updateAutosaveStatus("Clearing audit...");
  await deleteReferencedPhotos(getAllReferencedPhotoIds());
  localStorage.removeItem(getDraftStorageKey());
  state.responses = {};
  state.photoData = {};
  state.metadata = {
    auditDate: new Date().toISOString().slice(0, 10),
    auditorName: "",
    locationName: "",
    shiftName: "",
    recipientEmail: ""
  };

  persistDraft(true);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
  alert("The audit was cleared and is ready for a new walkthrough.");
}

function persistDraft(silent = false) {
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

  updateAutosaveStatus(silent ? "Saved" : "Autosaved");
  autosaveTimer = setTimeout(() => {
    updateAutosaveStatus("Autosave ready");
  }, 1200);
}

function exportAudit() {
  const rows = state.checklist.map((item) => {
    const response = getResponse(item.id);
    return {
      audit_name: state.checklistLabel,
      audit_date: state.metadata.auditDate,
      auditor: state.metadata.auditorName,
      location: state.metadata.locationName,
      shift: state.metadata.shiftName,
      section: item.section,
      item: item.item,
      answer: response.answer || "",
      score: getScoreValue(item),
      max_points: getPossiblePointsForItem(item),
      notes: response.notes || ""
    };
  });

  const csv = toCsv(rows);
  const baseName = slugify(state.checklistLabel || "audit");
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

function normalizeResponses(responses) {
  return Object.entries(responses || {}).reduce((normalized, [itemId, response]) => {
    normalized[itemId] = {
      answer: typeof response?.answer === "string" ? response.answer : "",
      notes: typeof response?.notes === "string" ? response.notes : "",
      photos: Array.isArray(response?.photos)
        ? response.photos.filter((photoId) => typeof photoId === "string" && photoId.trim())
        : []
    };
    return normalized;
  }, {});
}

function getResponse(itemId) {
  return state.responses[itemId] || { answer: "", notes: "", photos: [] };
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

function getPossiblePointsForItem(item) {
  if (!Number.isFinite(item.maxPoints)) {
    return 0;
  }
  return getResponse(item.id).answer === "NA" ? 0 : item.maxPoints;
}

function getAuditMetrics() {
  const totalItems = state.checklist.length;
  const answeredItems = state.checklist.filter((item) => hasAnswer(item.id)).length;
  const notesCount = state.checklist.filter((item) => getResponse(item.id).notes?.trim()).length;
  const remainingItems = totalItems - answeredItems;
  const possibleScore = state.checklist.reduce((sum, item) => sum + getPossiblePointsForItem(item), 0);
  const earnedScore = state.checklist.reduce((sum, item) => sum + getScoreValue(item), 0);
  const percentage = possibleScore ? (earnedScore / possibleScore) * 100 : 0;
  const roundedPercentage = Math.round(percentage);
  const grade = getGrade(roundedPercentage);

  return {
    totalItems,
    answeredItems,
    notesCount,
    remainingItems,
    possibleScore,
    earnedScore,
    percentage,
    roundedPercentage,
    grade
  };
}

function getSectionMetrics(items) {
  const answered = items.filter((item) => hasAnswer(item.id)).length;
  const possible = items.reduce((sum, item) => sum + getPossiblePointsForItem(item), 0);
  const earned = items.reduce((sum, item) => sum + getScoreValue(item), 0);
  return { answered, possible, earned };
}

function getGrade(percent) {
  if (percent >= 90) {
    return "A";
  }
  if (percent >= 80) {
    return "B";
  }
  if (percent >= 70) {
    return "C";
  }
  if (percent >= 60) {
    return "D";
  }
  return "F";
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
  const withPhotos = state.checklist.filter((item) => getResponse(item.id).photos?.length).length;

  return [
    { label: "Full points", count: full },
    { label: "Partial", count: partial },
    { label: "Zero", count: zero },
    { label: "N/A", count: na },
    { label: "With notes", count: withNotes },
    { label: "With photos", count: withPhotos }
  ];
}

function buildManagerReportData() {
  const metrics = getAuditMetrics();
  const sections = groupBySection(state.checklist).map((section) => ({
    name: section.name,
    ...getSectionMetrics(section.items)
  }));
  const answeredItems = state.checklist.filter((item) => hasAnswer(item.id) && getResponse(item.id).answer !== "NA");
  const strengths = answeredItems
    .filter((item) => Number.isFinite(item.maxPoints) && getScoreValue(item) === item.maxPoints)
    .sort((left, right) => right.maxPoints - left.maxPoints || left.item.localeCompare(right.item))
    .slice(0, 5)
    .map((item) => formatItemSummary(item, "strength"));
  const focusItems = answeredItems
    .filter((item) => Number.isFinite(item.maxPoints) && getScoreValue(item) < item.maxPoints)
    .sort((left, right) => {
      const leftGap = left.maxPoints - getScoreValue(left);
      const rightGap = right.maxPoints - getScoreValue(right);
      return rightGap - leftGap || right.maxPoints - left.maxPoints;
    })
    .slice(0, 6)
    .map((item) => formatItemSummary(item, "focus"));
  const notedItems = state.checklist
    .filter((item) => getResponse(item.id).notes?.trim())
    .sort((left, right) => {
      const leftGap = (left.maxPoints || 0) - getScoreValue(left);
      const rightGap = (right.maxPoints || 0) - getScoreValue(right);
      return rightGap - leftGap || right.maxPoints - left.maxPoints;
    })
    .slice(0, 6)
    .map((item) => formatItemSummary(item, "note"));
  const photoItems = state.checklist
    .filter((item) => getResponse(item.id).photos?.length)
    .map((item) => ({
      section: item.section,
      item: item.item,
      note: getResponse(item.id).notes?.trim() || "",
      scoreLabel: getStatusLabel(item),
      photos: getResponse(item.id).photos
        .map((photoId, index) => ({
          id: photoId,
          index: index + 1,
          src: state.photoData[photoId] || ""
        }))
        .filter((photo) => photo.src)
    }))
    .filter((item) => item.photos.length);

  const overview = buildOverview(metrics, sections, focusItems.length, photoItems.length);

  return {
    metrics,
    sections,
    strengths,
    focusItems,
    notedItems,
    photoItems,
    overview
  };
}

function buildOverview(metrics, sections, focusCount, photoItemCount) {
  const strongestSection = sections
    .filter((section) => section.possible > 0)
    .sort((left, right) => (right.earned / right.possible) - (left.earned / left.possible))[0];
  const weakestSection = sections
    .filter((section) => section.possible > 0)
    .sort((left, right) => (left.earned / left.possible) - (right.earned / right.possible))[0];

  const strongestText = strongestSection
    ? `Best section: ${strongestSection.name} (${strongestSection.earned}/${strongestSection.possible}).`
    : "";
  const weakestText = weakestSection && weakestSection !== strongestSection
    ? `Main watch area: ${weakestSection.name} (${weakestSection.earned}/${weakestSection.possible}).`
    : "";

  const completionText = metrics.remainingItems
    ? `${metrics.remainingItems} item${metrics.remainingItems === 1 ? "" : "s"} still need a score.`
    : "The audit is fully scored and ready to share.";
  const photoText = photoItemCount
    ? `${photoItemCount} item${photoItemCount === 1 ? "" : "s"} include photo evidence.`
    : "";

  return `${state.metadata.locationName || "This location"} finished at ${metrics.earnedScore}/${metrics.possibleScore} (${metrics.roundedPercentage}%, grade ${metrics.grade}). ${focusCount} item${focusCount === 1 ? "" : "s"} fell below full points. ${completionText} ${photoText} ${strongestText} ${weakestText}`.trim();
}

function formatItemSummary(item, mode) {
  const response = getResponse(item.id);
  const note = response.notes?.trim();
  const prefix = Number.isFinite(item.maxPoints)
    ? `${item.section}: ${item.item} (${getScoreValue(item)}/${getPossiblePointsForItem(item) || item.maxPoints})`
    : `${item.section}: ${item.item}`;

  if (mode === "strength" && note) {
    return `${prefix}. Note: ${note}`;
  }
  if ((mode === "focus" || mode === "note") && note) {
    return `${prefix}. Note: ${note}`;
  }
  return prefix;
}

function buildEmailSubject(report) {
  const location = state.metadata.locationName || "Location";
  return `${location} audit summary - ${report.metrics.earnedScore}/${report.metrics.possibleScore} (${report.metrics.grade})`;
}

function buildManagerPlainText(report = buildManagerReportData()) {
  const lines = [
    `${state.checklistLabel}`,
    `Date: ${state.metadata.auditDate || "Not set"}`,
    `Location: ${state.metadata.locationName || "Not set"}`,
    `Auditor: ${state.metadata.auditorName || "Not set"}`,
    `Shift: ${state.metadata.shiftName || "Not set"}`,
    "",
    `Score: ${report.metrics.earnedScore}/${report.metrics.possibleScore}`,
    `Grade: ${report.metrics.grade} (${report.metrics.roundedPercentage}%)`,
    "",
    "Overview:",
    report.overview,
    "",
    "What went well:"
  ];

  report.strengths.slice(0, 4).forEach((item) => lines.push(`- ${item}`));

  lines.push("", "Needs attention:");
  report.focusItems.slice(0, 5).forEach((item) => lines.push(`- ${item}`));

  if (report.notedItems.length) {
    lines.push("", "Notes to mention:");
    report.notedItems.slice(0, 5).forEach((item) => lines.push(`- ${item}`));
  }

  if (report.photoItems.length) {
    lines.push("", "Photo evidence captured:");
    report.photoItems.forEach((item) => {
      lines.push(`- ${item.section}: ${item.item} (${item.scoreLabel}, ${item.photos.length} photo${item.photos.length === 1 ? "" : "s"})`);
    });
  }

  return lines.join("\n");
}

function buildGmailComposeUrl(subject, body, to) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    su: subject,
    body
  });

  if (to) {
    params.set("to", to);
  }

  return `https://mail.google.com/mail/?${params.toString()}`;
}

function buildChatGPTPrompt(report = buildManagerReportData()) {
  const sectionLines = report.sections.map((section) => {
    const percent = section.possible ? Math.round((section.earned / section.possible) * 100) : 0;
    return `- ${section.name}: ${section.earned}/${section.possible} (${percent}%)`;
  }).join("\n");

  const focusLines = report.focusItems.length
    ? report.focusItems.map((item) => `- ${item}`).join("\n")
    : "- No below-standard items recorded.";
  const strengthLines = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join("\n")
    : "- No strengths captured yet.";
  const noteLines = report.notedItems.length
    ? report.notedItems.map((item) => `- ${item}`).join("\n")
    : "- No extra notes were added.";
  const photoLines = report.photoItems.length
    ? report.photoItems
      .map((item) => `- ${item.section}: ${item.item} (${item.scoreLabel}, ${item.photos.length} photo${item.photos.length === 1 ? "" : "s"})${item.note ? ` | Note: ${item.note}` : ""}`)
      .join("\n")
    : "- No photos were captured.";

  return [
    "Create a polished, manager-ready audit summary from the data below.",
    "Write it in a supportive but direct operations tone.",
    "The final deliverable should be a clean, professional PDF report.",
    "Format the response specifically so it can be exported directly as a PDF for leadership review.",
    "Do not invent facts, numbers, locations, names, action items, or explanations that are not supported by the audit data.",
    "If something is missing, say it was not provided rather than guessing.",
    "Keep the wording concise, operational, and consistent from report to report.",
    "Do not use emojis, marketing language, or overly dramatic phrasing.",
    "Use clean section headings and bullet points where appropriate so the formatting stays consistent in PDF form.",
    "Use this exact section order and these exact headings:",
    "Include these sections:",
    "1. Audit Overview",
    "2. Score and Grade",
    "3. Wins",
    "4. Focus Areas",
    "5. Recommended Next Steps",
    "6. Closing Note",
    "Under Audit Overview, write 2 short paragraphs maximum.",
    "Under Score and Grade, show the score, percent, grade, and section scores.",
    "Under Wins, list 3 to 5 bullets based only on strong items or positive notes.",
    "Under Focus Areas, list 3 to 5 bullets based only on below-standard items or caution notes.",
    "Under Recommended Next Steps, list 3 to 5 practical manager actions tied directly to the audit findings.",
    "Under Closing Note, write 1 short encouraging paragraph.",
    "When possible, mention the exact item name and score in parentheses like (3/5).",
    "If there are fewer than 3 items for Wins or Focus Areas, include only the available valid items and do not make extras up.",
    "Keep the full report tight enough to fit comfortably into a 1-page PDF when possible.",
    "",
    "AUDIT DATA",
    `Audit name: ${state.checklistLabel}`,
    `Date: ${state.metadata.auditDate || "Not set"}`,
    `Location: ${state.metadata.locationName || "Not set"}`,
    `Auditor: ${state.metadata.auditorName || "Not set"}`,
    `Shift: ${state.metadata.shiftName || "Not set"}`,
    `Score: ${report.metrics.earnedScore}/${report.metrics.possibleScore}`,
    `Percent: ${report.metrics.roundedPercentage}%`,
    `Grade: ${report.metrics.grade}`,
    "",
    "SECTION SCORES",
    sectionLines,
    "",
    "WHAT WENT WELL",
    strengthLines,
    "",
    "PRIORITY OPPORTUNITIES",
    focusLines,
    "",
    "DETAILED NOTES",
    noteLines,
    "",
    "PHOTO EVIDENCE CAPTURED",
    photoLines,
    "",
    "Important: If photo evidence is mentioned, the final PDF should include a short photo evidence section that references those items."
  ].join("\n");
}

async function emailSummary() {
  const report = buildManagerReportData();
  const subject = buildEmailSubject(report);
  const body = buildManagerPlainText(report);
  const recipient = state.metadata.recipientEmail.trim();
  const clipboardPayload = `To: ${recipient || "[add GM email]"}\nSubject: ${subject}\n\n${body}`;
  const copied = await copyText(clipboardPayload);
  const photoNote = report.photoItems.length
    ? " Photo details were included in the message, but the inline images stay in the PDF preview/print version."
    : "";

  const gmailWindow = window.open(buildGmailComposeUrl(subject, body, recipient), "_blank");
  if (gmailWindow) {
    gmailWindow.focus();
    if (copied) {
      alert(`Opened Gmail compose and copied the email subject/body to your clipboard as a backup.${photoNote}`);
    } else {
      downloadTextFile("audit-email.txt", clipboardPayload, "text/plain;charset=utf-8");
      alert(`Opened Gmail compose. I also downloaded the email text because clipboard access was blocked.${photoNote}`);
    }
    return;
  }

  const subjectParam = encodeURIComponent(subject);
  const bodyParam = encodeURIComponent(body);
  const toParam = encodeURIComponent(recipient);
  window.location.href = `mailto:${toParam}?subject=${subjectParam}&body=${bodyParam}`;

  if (copied) {
    alert(`I copied the email subject/body to your clipboard in case your desktop mail app does not open cleanly.${photoNote}`);
  } else {
    downloadTextFile("audit-email.txt", clipboardPayload, "text/plain;charset=utf-8");
    alert(`Your browser blocked the web compose window, so I tried your desktop mail app and downloaded the email text as a backup.${photoNote}`);
  }
}

async function shareReport() {
  const report = buildManagerReportData();
  if (report.photoItems.length) {
    const shared = await shareRichReport(report);
    if (!shared) {
      openSummaryWindow(false);
      alert("Photo evidence is included in the PDF preview. Use Preview PDF or Print / PDF to share the full report with photos.");
    }
    return;
  }

  if (navigator.share) {
    await shareSummary(report);
    return;
  }

  await emailSummary();
}

async function shareSummary(report = buildManagerReportData()) {
  try {
    await navigator.share({
      title: buildEmailSubject(report),
      text: buildManagerPlainText(report)
    });
  } catch {
    // User cancelled or share target failed.
  }
}

async function shareRichReport(report) {
  if (!navigator.share || typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    const file = buildReportHtmlFile(report);
    if (!navigator.canShare({ files: [file] })) {
      return false;
    }

    await navigator.share({
      title: buildEmailSubject(report),
      text: "Attached is the full audit report with photo evidence.",
      files: [file]
    });
    return true;
  } catch {
    return false;
  }
}

async function copyForChatGPT() {
  const prompt = buildChatGPTPrompt();
  const copied = await copyText(prompt);

  if (copied) {
    els.openChatgptButton.classList.remove("hidden");
    alert("The ChatGPT brief was copied to your clipboard. Tap Open ChatGPT if you want to paste it there now.");
    return;
  }

  els.openChatgptButton.classList.add("hidden");
  downloadTextFile("chatgpt-audit-brief.txt", prompt, "text/plain;charset=utf-8");
  alert("Clipboard access was blocked, so I downloaded the ChatGPT brief instead.");
}

function openChatGPT() {
  window.open("https://chatgpt.com/", "_blank", "noopener");
}

function openSummaryWindow(autoPrint) {
  const report = buildManagerReportData();
  const summaryWindow = window.open("", "_blank");
  if (!summaryWindow) {
    alert("Your browser blocked the summary window. Allow pop-ups for this site and try again.");
    return;
  }

  summaryWindow.document.write(buildManagerHtmlDocument(report));
  summaryWindow.document.close();
  summaryWindow.focus();

  if (autoPrint) {
    summaryWindow.setTimeout(() => {
      summaryWindow.print();
    }, report.photoItems.length ? 600 : 250);
  }
}

function buildManagerHtmlDocument(report) {
  const logoSrc = new URL("noodles-official-logo.png", window.location.href).href;
  const sectionCards = report.sections.map((section) => {
    const percent = section.possible ? Math.round((section.earned / section.possible) * 100) : 0;
    return `
      <div class="section-card">
        <strong>${escapeHtml(section.name)}</strong>
        <span>${section.earned}/${section.possible}</span>
        <small>${percent}%</small>
      </div>
    `;
  }).join("");

  const strengths = renderHtmlList(report.strengths);
  const focusItems = renderHtmlList(report.focusItems);
  const noteItems = renderHtmlList(report.notedItems);
  const photoSection = report.photoItems.length
    ? `
    <section class="photo-section">
      <p class="eyebrow">Photo Evidence</p>
      <div class="photo-grid">
        ${report.photoItems.map((item) => `
          <article class="photo-panel">
            <div class="photo-copy">
              <h3>${escapeHtml(item.item)}</h3>
              <p><strong>${escapeHtml(item.section)}</strong> &middot; ${escapeHtml(item.scoreLabel)}</p>
              ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
            </div>
            <div class="photo-panel-grid">
              ${item.photos.map((photo) => `
                <figure class="photo-figure">
                  <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(`${item.item} photo ${photo.index}`)}">
                  <figcaption>Photo ${photo.index}</figcaption>
                </figure>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(state.checklistLabel)} Summary</title>
    <style>
      :root {
        --ink: #2f1a0d;
        --muted: #72513b;
        --accent: #c54127;
        --accent-dark: #8b2c1a;
        --surface: #fffaf4;
        --line: rgba(114, 44, 22, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Aptos, "Trebuchet MS", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(255,255,255,0.82), transparent 24%),
          linear-gradient(180deg, #fff2df, #fffdf9);
      }
      main {
        width: min(980px, calc(100vw - 32px));
        margin: 24px auto;
        padding: 28px;
      border-radius: 28px;
      background: var(--surface);
      border: 1px solid var(--line);
    }
    .top {
      display: grid;
      gap: 18px;
      grid-template-columns: 1.1fr 0.9fr;
      align-items: start;
    }
      .eyebrow {
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.75rem;
        color: var(--muted);
        font-weight: 800;
      }
      .brand-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .brand-row img {
        height: 48px;
        width: auto;
      }
      .brand-tag {
        display: inline-flex;
        align-items: center;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(197, 65, 39, 0.08);
        border: 1px solid rgba(197, 65, 39, 0.14);
        color: var(--accent-dark);
        font-size: 0.8rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1, h2, h3, p { margin-top: 0; }
      h1 { margin-bottom: 10px; font-size: 2.4rem; line-height: 1; }
      .lede { color: var(--muted); line-height: 1.6; }
      .score-card {
        padding: 22px;
      border-radius: 24px;
      background: #fff;
      border: 1px solid var(--line);
    }
    .score-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      align-items: start;
    }
    .score {
      font-size: 3rem;
      line-height: 1;
      font-weight: 800;
    }
      .grade {
        min-width: 96px;
        padding: 16px 18px;
        border-radius: 20px;
        background: rgba(197, 65, 39, 0.12);
        text-align: center;
        font-size: 2rem;
        font-weight: 800;
        color: var(--accent-dark);
      }
    .meta {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 18px;
    }
    .meta div {
      padding: 12px 14px;
      border-radius: 16px;
      background: #fff;
      border: 1px solid var(--line);
    }
    .meta span {
      display: block;
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 700;
    }
    .section-grid,
    .list-grid {
      display: grid;
      gap: 16px;
      margin-top: 22px;
    }
    .section-grid {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .section-card,
    .list-card {
      padding: 16px 18px;
      border-radius: 18px;
      background: #fff;
      border: 1px solid var(--line);
    }
    .section-card span {
      display: block;
      margin-top: 8px;
      font-size: 1.4rem;
      font-weight: 800;
    }
    .section-card small {
      color: var(--muted);
      font-size: 0.9rem;
    }
    .list-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .photo-section {
      margin-top: 22px;
    }
    .photo-grid {
      display: grid;
      gap: 16px;
    }
    .photo-panel {
      padding: 18px;
      border-radius: 18px;
      background: #fff;
      border: 1px solid var(--line);
    }
    .photo-copy p {
      color: var(--muted);
      line-height: 1.5;
    }
    .photo-panel-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      margin-top: 14px;
    }
    .photo-figure {
      margin: 0;
    }
    .photo-figure img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: #f6ecdf;
    }
    .photo-figure figcaption {
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 700;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      line-height: 1.6;
    }
    .footer-note {
      margin-top: 24px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    @media print {
      body { background: #fff; }
      main {
        width: 100%;
        margin: 0;
        padding: 0;
        border: none;
      }
    }
    @media (max-width: 760px) {
      .top,
      .list-grid,
      .meta {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <section>
        <div class="brand-row">
          <img src="${escapeHtml(logoSrc)}" alt="Noodles & Company">
          <span class="brand-tag">Hartford Ops Audit</span>
        </div>
        <p class="eyebrow">Manager Summary</p>
        <h1>${escapeHtml(state.checklistLabel)}</h1>
        <p class="lede">${escapeHtml(report.overview)}</p>
      </section>
      <section class="score-card">
        <div class="score-grid">
          <div>
            <p class="eyebrow">Final Score</p>
            <div class="score">${report.metrics.earnedScore}/${report.metrics.possibleScore}</div>
            <p class="lede">${report.metrics.roundedPercentage}% overall</p>
          </div>
          <div class="grade">${report.metrics.grade}</div>
        </div>
        <div class="meta">
          <div><span>Date</span>${escapeHtml(state.metadata.auditDate || "Not set")}</div>
          <div><span>Location</span>${escapeHtml(state.metadata.locationName || "Not set")}</div>
          <div><span>Auditor</span>${escapeHtml(state.metadata.auditorName || "Not set")}</div>
          <div><span>Shift</span>${escapeHtml(state.metadata.shiftName || "Not set")}</div>
        </div>
      </section>
    </div>

    <section>
      <p class="eyebrow">Section Performance</p>
      <div class="section-grid">${sectionCards}</div>
    </section>

    <section class="list-grid">
      <article class="list-card">
        <p class="eyebrow">What Went Well</p>
        ${strengths}
      </article>
      <article class="list-card">
        <p class="eyebrow">Needs Attention</p>
        ${focusItems}
      </article>
      <article class="list-card">
        <p class="eyebrow">Notes to Mention</p>
        ${noteItems}
      </article>
    </section>

    ${photoSection}

    <p class="footer-note">Generated from the Noodles Checkpoint Audit app.</p>
  </main>
</body>
</html>`;
}

function renderHtmlList(items) {
  const safeItems = items.length ? items : ["No items in this section."];
  return `<ul>${safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildReportHtmlFile(report) {
  const html = buildManagerHtmlDocument(report);
  const fileName = `${slugify(state.metadata.locationName || state.checklistLabel || "audit") || "audit"}-summary.html`;
  return new File([html], fileName, { type: "text/html" });
}

function getAllReferencedPhotoIds() {
  return Object.values(state.responses).flatMap((response) => Array.isArray(response?.photos) ? response.photos : []);
}

function createPhotoId(itemId) {
  return `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function compressImageFile(file) {
  const image = await loadImageElement(file);
  const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image processing is not available in this browser.");
  }

  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected image could not be processed."));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getPhotoDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support temporary photo storage."));
  }

  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(PHOTO_DB_NAME, 1);

      request.onerror = () => reject(request.error || new Error("The photo database could not be opened."));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PHOTO_STORE_NAME)) {
          database.createObjectStore(PHOTO_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  return photoDbPromise;
}

async function savePhotoRecord(record) {
  const database = await getPhotoDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("The photo could not be saved."));
    transaction.objectStore(PHOTO_STORE_NAME).put(record);
  });
}

async function getPhotoRecords(photoIds) {
  const uniqueIds = [...new Set(photoIds)];
  if (!uniqueIds.length) {
    return [];
  }

  const database = await getPhotoDb();
  return Promise.all(uniqueIds.map((photoId) => new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE_NAME, "readonly");
    const request = transaction.objectStore(PHOTO_STORE_NAME).get(photoId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("A saved photo could not be loaded."));
  })));
}

async function deletePhotoRecord(photoId) {
  const database = await getPhotoDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("The photo could not be removed."));
    transaction.objectStore(PHOTO_STORE_NAME).delete(photoId);
  });
}

async function deleteReferencedPhotos(photoIds) {
  const uniqueIds = [...new Set(photoIds)];
  if (!uniqueIds.length) {
    return;
  }

  try {
    await Promise.all(uniqueIds.map((photoId) => deletePhotoRecord(photoId)));
  } catch {
    // If photo cleanup fails, keep the audit reset moving.
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "absolute";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  }
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

