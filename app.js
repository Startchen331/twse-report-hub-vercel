const form = document.querySelector("#searchForm");
const rowsEl = document.querySelector("#resultRows");
const notice = document.querySelector("#notice");
const resultTitle = document.querySelector("#resultTitle");
const tableFilter = document.querySelector("#tableFilter");
const exportCsv = document.querySelector("#exportCsv");
const themeToggle = document.querySelector("#themeToggle");
const historyList = document.querySelector("#historyList");
const clearHistory = document.querySelector("#clearHistory");
const LAST_STATE_KEY = "twseReportHub:lastState";
const HISTORY_KEY = "twseReportHub:history";
const MAX_HISTORY = 8;

let rows = [];
let visibleRows = [];

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function formValues() {
  return Object.fromEntries(new FormData(form));
}

function applyFormValues(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
}

function queryLabel(query, company = {}) {
  const code = query.companyCode || company.code || "-";
  const name = company.name || query.companyName || "";
  const typeMap = { all: "全部", quarterly: "季報", annual: "年報" };
  const type = typeMap[query.type] || "全部";
  const years = query.startYear || query.endYear ? `${query.startYear || "?"}-${query.endYear || "?"}` : "預設近10年";
  return `${code}${name ? ` ${name}` : ""} · ${type} · ${years}`;
}

function saveLastState(data, query) {
  localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ data, query, savedAt: new Date().toISOString() }));
}

function saveHistory(query, company = {}) {
  const nextItem = {
    id: `${query.companyCode || ""}-${query.type || "all"}-${query.startYear || ""}-${query.endYear || ""}`,
    query,
    company,
    label: queryLabel(query, company),
    time: new Date().toISOString(),
  };
  const existing = readJson(HISTORY_KEY, []);
  const deduped = existing.filter((item) => item.id !== nextItem.id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([nextItem, ...deduped].slice(0, MAX_HISTORY)));
  renderHistory();
}

function renderHistory() {
  const history = readJson(HISTORY_KEY, []);
  historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("span");
    empty.className = "history-empty";
    empty.textContent = "尚無查詢紀錄";
    historyList.append(empty);
    return;
  }
  for (const item of history) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-chip";
    button.textContent = item.label;
    button.title = new Date(item.time).toLocaleString("zh-TW");
    button.addEventListener("click", () => {
      applyFormValues(item.query);
      runSearch();
    });
    historyList.append(button);
  }
}

function restoreLastState() {
  const state = readJson(LAST_STATE_KEY, null);
  if (!state?.data) return;
  applyFormValues(state.query);
  rows = state.data.rows || [];
  resultTitle.textContent = `${state.data.company?.code || ""} ${state.data.company?.name || ""}`.trim() || "查詢結果";
  updateMetrics(state.data.summary);
  renderRows(rows);
  renderCompany(state.data);
  showNotice("");
}

themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
});

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark");
}

function setBusy(isBusy) {
  form.querySelector("button").disabled = isBusy;
  form.querySelector("button").textContent = isBusy ? "查詢中..." : "查詢文件";
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.toggle("hidden", !message);
}

function updateMetrics(summary = {}) {
  document.querySelector("#totalCount").textContent = summary.total || 0;
  document.querySelector("#quarterlyCount").textContent = summary.quarterly || 0;
  document.querySelector("#annualCount").textContent = summary.annual || 0;
  document.querySelector("#yearCount").textContent = summary.years || 0;
}

function setEmptyRow(message) {
  rowsEl.replaceChildren();
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 9;
  td.className = "empty";
  td.textContent = message;
  tr.append(td);
  rowsEl.append(tr);
}

function cell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text ?? "-";
  return td;
}

function labeledCell(label, text, className = "") {
  const td = cell(text, className);
  td.dataset.label = label;
  return td;
}

function renderRows(data) {
  visibleRows = data;
  if (!data.length) {
    setEmptyRow("查無資料。可調整年度、資料類型，或稍後再試。");
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const row of data) {
    const tr = document.createElement("tr");
    tr.append(labeledCell("公司代號", row.companyCode));
    tr.append(labeledCell("公司名稱", row.companyName || "-"));
    tr.append(labeledCell("年度", row.year || "-"));

    const period = document.createElement("td");
    period.dataset.label = "季度 / 類型";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = row.quarter || row.periodLabel || "-";
    period.append(badge);
    tr.append(period);

    const filename = labeledCell("文件名稱", row.filename || "-");
    filename.title = row.detail || "";
    tr.append(filename);

    tr.append(labeledCell("公告日期", row.announcedAt || "-"));
    tr.append(labeledCell("格式", row.fileType || "-"));
    tr.append(labeledCell("版本", row.version || "-"));

    const linkCell = document.createElement("td");
    linkCell.dataset.label = "下載連結";
    const link = document.createElement("a");
    link.className = "download-link";
    link.href = row.sourcePostUrl || row.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "開啟連結";
    linkCell.append(link);
    tr.append(linkCell);
    fragment.append(tr);
  }
  rowsEl.replaceChildren(fragment);
}

function renderCompany(data) {
  const company = data.company || {};
  const allYears = rows.map((row) => row.year).filter(Boolean);
  const formats = [...new Set(rows.map((row) => row.fileType))].join(" / ") || "-";
  const latest = rows.map((row) => row.announcedAt).filter(Boolean).sort().at(-1) || "-";
  const versionCount = rows.filter((row) => row.duplicateIndex > 1 || row.version !== "原始紀錄").length;
  document.querySelector("#companyTitle").textContent = `${company.code || "-"} ${company.name || ""}`.trim();
  const items = [
    ["最近公告", latest],
    ["年度範圍", allYears.length ? `${Math.min(...allYears)} - ${Math.max(...allYears)}` : "-"],
    ["檔案格式", formats],
    ["版本提示", versionCount ? `${versionCount} 筆多版本或語系差異` : "未偵測到多版本"],
  ];
  const detail = document.querySelector("#companyDetail");
  detail.replaceChildren();
  for (const [label, value] of items) {
    const block = document.createElement("div");
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    span.textContent = label;
    strong.textContent = value;
    block.append(span, strong);
    detail.append(block);
  }
}

function applyFilter() {
  const keyword = tableFilter.value.trim().toLowerCase();
  if (!keyword) {
    renderRows(rows);
    return;
  }
  renderRows(
    rows.filter((row) =>
      [row.companyCode, row.companyName, row.year, row.quarter, row.periodLabel, row.filename, row.fileType, row.version, row.detail]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    ),
  );
}

async function runSearch() {
  setBusy(true);
  showNotice("");
  setEmptyRow("正在向 TWSE 查詢並整理文件...");
  try {
    const query = formValues();
    const params = new URLSearchParams(query);
    const response = await fetch(`/api/search?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "查詢失敗");
    rows = data.rows || [];
    resultTitle.textContent = `${data.company.code} ${data.company.name || ""}`.trim() || "查詢結果";
    updateMetrics(data.summary);
    renderRows(rows);
    renderCompany(data);
    saveLastState(data, query);
    saveHistory(query, data.company);
    const messages = [];
    if (data.company.nameMismatch) messages.push("公司名稱與代號查詢結果不一致，已以公司代號回傳資料為準。");
    if (data.errors?.length) messages.push(`${data.errors.length} 個年度或類型查詢失敗，請稍後再試或縮小查詢範圍。`);
    if (!rows.length) messages.push("本次條件未取得文件，可能該年度無資料或來源站暫時限制。");
    showNotice(messages.join(" "));
  } catch (error) {
    rows = [];
    updateMetrics();
    renderRows([]);
    resultTitle.textContent = "查詢失敗";
    showNotice(error.message);
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  runSearch();
});

tableFilter.addEventListener("input", applyFilter);

clearHistory.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

exportCsv.addEventListener("click", () => {
  const header = ["公司代號", "公司名稱", "年度", "季度/類型", "文件名稱", "公告日期", "格式", "版本", "下載連結"];
  const body = visibleRows.map((row) => [
    row.companyCode,
    row.companyName,
    row.year,
    row.quarter || row.periodLabel,
    row.filename,
    row.announcedAt,
    row.fileType,
    row.version,
    row.sourceUrl,
  ]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "twse-reports.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

renderHistory();
restoreLastState();
