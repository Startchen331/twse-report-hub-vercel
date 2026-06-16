import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { URL, URLSearchParams } from "node:url";

export const DOC_HOST = "doc.twse.com.tw";
export const DOC_PATH = "/server-java/t57sb01";
export const DOC_URL = `https://${DOC_HOST}${DOC_PATH}`;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36";
const htmlCache = new Map();
const rateBuckets = new Map();
const logs = [];
const MAX_YEAR_RANGE = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addLog(level, message, meta = {}) {
  const entry = {
    id: randomUUID(),
    time: new Date().toISOString(),
    level,
    message,
    meta,
  };
  logs.unshift(entry);
  logs.splice(120);
  return entry;
}

function rocYear(year) {
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1911 ? numeric - 1911 : numeric;
}

function textDecode(buffer, charset = "big5") {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function requestBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const requestOptions = {
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 25000,
    };
    if (target.hostname === DOC_HOST && globalThis.process?.env?.TWSE_STRICT_TLS !== "true") {
      requestOptions.rejectUnauthorized = false;
    }
    const req = client.request(target, requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

export function assertRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const error = new Error("查詢過於頻繁，請稍後再試");
    error.statusCode = 429;
    throw error;
  }
}

async function fetchTwseHtml(params, attempt = 1) {
  const query = new URLSearchParams(params);
  const url = `${DOC_URL}?${query}`;
  const cacheKey = query.toString();
  const cached = htmlCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) {
    return cached.html;
  }
  const response = await requestBuffer(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: DOC_URL,
    },
  });
  const html = textDecode(response.buffer, "big5");
  if (/查詢過量|稍後再查詢|SECURITY REASONS|無法呈現/i.test(html)) {
    if (attempt < 3) {
      addLog("warn", "TWSE 回應限制或非預期頁面，準備重試", { attempt, params });
      await sleep(1200 * attempt);
      return fetchTwseHtml(params, attempt + 1);
    }
    const reason = /查詢過量|稍後再查詢/.test(html)
      ? "TWSE 查詢過量，請稍後再查詢"
      : "TWSE 返回安全限制或非預期 HTML";
    throw new Error(reason);
  }
  htmlCache.set(cacheKey, { time: Date.now(), html });
  return html;
}

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCompanyName(html) {
  const match = html.match(/公司名稱：\s*([^<\r\n]+)/);
  return match ? stripTags(match[1]) : "";
}

function parsePeriod(periodText) {
  const yearMatch = periodText.match(/(\d{2,3})\s*年/);
  const roc = yearMatch ? Number(yearMatch[1]) : null;
  const quarterMap = {
    第一季: "Q1",
    第二季: "Q2",
    第三季: "Q3",
    第四季: "Q4",
  };
  const quarterLabel =
    Object.keys(quarterMap).find((label) => periodText.includes(label)) || "";
  return {
    rocYear: roc,
    year: roc ? roc + 1911 : null,
    quarter: quarterLabel ? quarterMap[quarterLabel] : "",
    periodLabel: quarterLabel || "年報",
  };
}

function normalizeDate(value) {
  const match = value.match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}:\d{2}:\d{2}))?/);
  if (!match) return value;
  const [, y, m, d, time = ""] = match;
  return `${Number(y) + 1911}-${m.padStart(2, "0")}-${d.padStart(2, "0")}${time ? ` ${time}` : ""}`;
}

function fileType(filename) {
  const ext = filename.split(".").pop();
  return ext ? ext.toUpperCase() : "UNKNOWN";
}

function inferVersion(row, duplicateIndex) {
  const hints = [row.detail, row.note, row.filename].filter(Boolean).join(" / ");
  if (/英文|English|AIA/i.test(hints)) return "英文版";
  if (/更|補|修正|amend/i.test(hints)) return "更補正版";
  if (duplicateIndex > 1) return `版本 ${duplicateIndex}`;
  return "原始紀錄";
}

function parseRows(html, mtype, queryRocYear) {
  const companyName = parseCompanyName(html);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => match[1])
    .filter((row) => /readfile2?\(/.test(row));
  const parsed = [];

  for (const rowHtml of rows) {
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 10) continue;
    const linkMatch = rowHtml.match(/readfile2?\("([^"]+)","([^"]+)","([^"]+)"\)/);
    if (!linkMatch) continue;
    const [, kind, coid, filename] = linkMatch;
    const period = parsePeriod(stripTags(cells[1]));
    const detail = stripTags(cells[5]);
    const note = stripTags(cells[6]);
    const documentType = mtype === "A" ? "季報" : "年報";
    const sourceParams = new URLSearchParams({
      step: "1",
      colorchg: "1",
      co_id: coid,
      year: String(queryRocYear || period.rocYear || ""),
      seamon: "",
      mtype,
    });

    parsed.push({
      id: `${coid}-${period.year}-${documentType}-${filename}`,
      companyCode: coid,
      companyName,
      year: period.year,
      rocYear: period.rocYear,
      quarter: documentType === "季報" ? period.quarter : "",
      periodLabel: documentType === "季報" ? period.periodLabel : "年報",
      documentType,
      sourceType: stripTags(cells[2]),
      closeType: stripTags(cells[3]),
      nature: stripTags(cells[4]),
      detail,
      note,
      filename,
      fileType: fileType(filename),
      fileSize: stripTags(cells[8]),
      announcedAt: normalizeDate(stripTags(cells[9])),
      amendment: stripTags(cells[10] || ""),
      kind,
      downloadUrl: `/api/download?${new URLSearchParams({ kind, co_id: coid, filename })}`,
      sourcePostUrl: `/api/source?${new URLSearchParams({
        co_id: coid,
        year: String(queryRocYear || period.rocYear || ""),
        mtype,
      })}`,
      sourceUrl: `${DOC_URL}?${sourceParams}`,
      rawSourceUrl: `${DOC_URL}?${sourceParams}`,
    });
  }

  return parsed;
}

function markVersions(rows) {
  const counts = new Map();
  return rows.map((row) => {
    const key = `${row.companyCode}-${row.year}-${row.documentType}-${row.quarter || "AR"}-${row.sourceType}-${row.detail}`;
    const next = (counts.get(key) || 0) + 1;
    counts.set(key, next);
    return { ...row, version: inferVersion(row, next), duplicateGroup: key, duplicateIndex: next };
  });
}

export async function searchReports(query) {
  const nowYear = new Date().getFullYear();
  const code = String(query.companyCode || "").trim();
  const name = String(query.companyName || "").trim();
  const type = query.type || "all";
  const startYear = Number(query.startYear || nowYear - 9);
  const endYear = Number(query.endYear || nowYear);

  if (!/^\d{4,6}$/.test(code)) {
    throw new Error("請輸入有效公司代號");
  }
  if (!["all", "quarterly", "annual"].includes(type)) {
    throw new Error("資料類型不正確");
  }
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("請輸入有效年度");
  }
  if (startYear < 1990 || endYear > nowYear + 1 || startYear > endYear) {
    throw new Error("年度區間不正確");
  }
  if (endYear - startYear + 1 > MAX_YEAR_RANGE) {
    throw new Error(`一次最多查詢 ${MAX_YEAR_RANGE} 個年度`);
  }

  const mtypes = type === "quarterly" ? ["A"] : type === "annual" ? ["F"] : ["A", "F"];
  const years = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);

  addLog("info", "開始查詢 TWSE 電子資料", { code, type, startYear, endYear });
  const results = [];
  const errors = [];

  for (const y of years) {
    for (const mtype of mtypes) {
      const queryYear = mtype === "F" ? y + 1 : y;
      const params = {
        step: "1",
        colorchg: "1",
        co_id: code,
        year: String(rocYear(queryYear)),
        seamon: "",
        mtype,
      };
      try {
        const html = await fetchTwseHtml(params);
        const rows = parseRows(html, mtype, rocYear(queryYear)).filter((row) => {
          if (row.year !== y) return false;
          if (mtype !== "F") return true;
          return /股東會年報/.test(row.detail) && !/前十大|相互間關係/.test(row.detail);
        });
        results.push(...rows);
        addLog("success", `完成 ${code} ${y} ${mtype === "A" ? "財報" : "年報"} 查詢`, {
          count: rows.length,
        });
      } catch (error) {
        errors.push({ year: y, mtype, message: error.message });
        addLog("error", `查詢 ${code} ${y} ${mtype} 失敗`, { error: error.message });
      }
      await sleep(900);
    }
  }

  const marked = markVersions(
    results
      .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return String(a.periodLabel).localeCompare(String(b.periodLabel), "zh-Hant");
      }),
  );

  const foundName = marked.find((row) => row.companyName)?.companyName || "";
  const nameMismatch = Boolean(name && foundName && !foundName.includes(name) && !name.includes(foundName));

  return {
    query: { code, name, type, startYear, endYear },
    company: { code, name: foundName || name, nameMismatch },
    rows: marked,
    errors,
    summary: {
      total: marked.length,
      quarterly: marked.filter((row) => row.documentType === "季報").length,
      annual: marked.filter((row) => row.documentType === "年報").length,
      years: new Set(marked.map((row) => row.year)).size,
    },
  };
}

export async function getDownloadResponse(params) {
  const kind = params.get("kind") || "";
  const coId = params.get("co_id") || "";
  const filename = params.get("filename") || "";

  if (!["A", "F"].includes(kind) || !/^\d{4,6}$/.test(coId) || !/^[\w.-]+\.(pdf|zip|doc|docx|xls|xlsx)$/i.test(filename)) {
    const error = new Error("下載參數不正確");
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams({
    colorchg: "1",
    step: "9",
    kind,
    co_id: coId,
    filename,
    DEBUG: "",
  }).toString();

  let response = await requestBuffer(DOC_URL, {
    method: "POST",
    body,
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      Referer: DOC_URL,
    },
  });

  let contentType = response.headers["content-type"] || "application/octet-stream";
  if (/text\/html/i.test(contentType)) {
    const html = textDecode(response.buffer, "big5");
    const hrefs = [...html.matchAll(/href=['"]([^'"]+)['"]/gi)].map((match) => match[1]);
    const href =
      hrefs.find((item) => /^\/pdf\//i.test(item)) ||
      hrefs.find((item) => /\.(pdf|zip|doc|docx|xls|xlsx)(?:$|\?)/i.test(item));
    if (href) {
      response = await requestBuffer(new URL(href, DOC_URL).toString(), {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: DOC_URL,
        },
      });
      contentType = response.headers["content-type"] || "application/octet-stream";
    } else if (/SECURITY REASONS|無法呈現|查詢過量|稍後再查詢/.test(html)) {
      throw new Error("來源站暫時限制下載，請稍後再試");
    }
  }

  return {
    status: response.status || 200,
    contentType,
    filename,
    buffer: response.buffer,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getSourceRedirectHtml(params) {
  const coId = params.get("co_id") || "";
  const year = params.get("year") || "";
  const mtype = params.get("mtype") || "";

  if (!/^\d{4,6}$/.test(coId) || !/^\d{2,3}$/.test(year) || !["A", "F"].includes(mtype)) {
    const error = new Error("來源連結參數不正確");
    error.statusCode = 400;
    throw error;
  }

  const fields = {
    step: "1",
    colorchg: "1",
    co_id: coId,
    year,
    seamon: "",
    mtype,
  };

  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <title>開啟公開資訊觀測站文件頁</title>
  </head>
  <body>
    <form id="sourceForm" method="post" action="${DOC_URL}">
      ${inputs}
      <noscript>
        <p>請按下方按鈕開啟公開資訊觀測站文件頁。</p>
        <button type="submit">開啟連結</button>
      </noscript>
    </form>
    <script>document.getElementById("sourceForm").submit();</script>
  </body>
</html>`;
}

export function statusPayload() {
  return {
    ok: true,
    source: DOC_URL,
    time: new Date().toISOString(),
  };
}
