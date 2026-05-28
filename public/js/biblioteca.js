// Biblioteca de Re(s)ets — lee la colección 'resets' de Firestore y la muestra
// como una grilla de tarjetas filtrable por eje y dimensión.

import { getResets } from "./firebase-client.js";

const EJE_TO_COLOR = {
  agua: "blue",
  alimento: "green",
  cobijo: "yellow",
  energia: "red",
  comunicacion: "orange",
};

const EJE_LABEL = {
  agua: "agua",
  alimento: "alimento",
  cobijo: "cobijo",
  energia: "energía",
  comunicacion: "comunicación",
};

const INITIAL_SAMPLE_SIZE = 6;
const PAGE_SIZE = 6;

const state = {
  resets: [],
  initialSample: [],
  eje: "all",
  dimension: "all",
  tactic: "all",
  date: null,
  page: 1,
  allTactics: [],
  searchQuery: "",
};

function sampleRandom(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function sanitizeGeminiHtml(raw) {
  const allowed = { ALLOWED_TAGS: ["h4", "p", "strong", "em", "br", "ul", "ol", "li"] };
  if (typeof DOMPurify !== "undefined") return DOMPurify.sanitize(raw || "", allowed);
  return (raw || "").replace(/<(?!\/?(?:h4|p|strong|em|br|ul|ol|li)\b)[^>]*>/gi, "");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" });
}

// Clave de día en hora local (YYYY-MM-DD), consistente con formatDate.
function localDayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function matchesFilters(reset) {
  const tactics = Array.isArray(reset.tactics) ? reset.tactics : [];
  const dimensions = Array.isArray(reset.dimensions) ? reset.dimensions : [];
  const ejeOk = state.eje === "all" || tactics.some((t) => t && t.eje === state.eje);
  const dimOk = state.dimension === "all" || dimensions.includes(state.dimension);
  const tacticOk = state.tactic === "all" || tactics.some((t) => t && t.title === state.tactic);
  const dateOk = !state.date || localDayKey(reset.createdAt) === state.date;

  const q = (state.searchQuery || "").trim().toLowerCase();
  if (!q) return ejeOk && dimOk && tacticOk && dateOk;

  const queryWords = q.split(/\s+/).filter(Boolean);
  const queryOk = queryWords.every((word) => {
    const escWord = escapeRegExp(word);
    const regex = new RegExp(`(?<=^|[^a-záéíóúüñ0-9])${escWord}(?=[^a-záéíóúüñ0-9]|$)`, "i");

    const textMatch = reset.text && regex.test(reset.text);
    const idMatch = reset.id && regex.test(reset.id);
    const tacticMatch = tactics.some((t) => t && t.title && regex.test(t.title));

    return textMatch || idMatch || tacticMatch;
  });

  return ejeOk && dimOk && tacticOk && dateOk && queryOk;
}

function buildCard(reset) {
  const tactics = Array.isArray(reset.tactics) ? reset.tactics : [];
  const dimensions = Array.isArray(reset.dimensions) ? reset.dimensions : [];

  const tacticsHtml = tactics
    .map((t) => {
      const color = (t && EJE_TO_COLOR[t.eje]) || "neutral";
      return `<span class="resetario-tactic-badge resetario-tactic-badge-${color}">${escapeHtml(t && t.title)}</span>`;
    })
    .join("");

  const dimsText = dimensions.length ? dimensions.map(escapeHtml).join(", ") : "—";

  return `
    <article class="biblioteca-card">
      <div class="biblioteca-card-header">
        <span class="biblioteca-card-id">Re(s)et (${escapeHtml(reset.id)})</span>
      </div>
      <div class="resetario-sections">
        <div class="resetario-section">
          <div class="resetario-section-label">Tácticas</div>
          <div class="resetario-section-content resetario-tactics-row">
            ${tacticsHtml || '<span class="resetario-section-empty">—</span>'}
          </div>
        </div>
        <div class="resetario-section">
          <div class="resetario-section-label">Re(s)et</div>
          <div class="resetario-section-content">
            <div class="resetario-output-text">${sanitizeGeminiHtml(reset.text)}</div>
          </div>
        </div>
        <div class="resetario-section">
          <div class="resetario-section-label">Dimensiones</div>
          <div class="resetario-section-content"><p>${dimsText}</p></div>
        </div>
      </div>
      <div class="biblioteca-card-footer">
        <span class="biblioteca-card-date">${escapeHtml(formatDate(reset.createdAt))}</span>
      </div>
    </article>
  `;
}

function renderPager(totalPages) {
  const pager = document.getElementById("biblioteca-pager");
  if (!pager) return;
  if (totalPages <= 1) {
    pager.innerHTML = "";
    return;
  }
  const buttons = [];
  buttons.push(
    `<button type="button" class="biblioteca-page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>`
  );
  for (let p = 1; p <= totalPages; p++) {
    buttons.push(
      `<button type="button" class="biblioteca-page-btn ${p === state.page ? "is-active" : ""}" data-page="${p}">${p}</button>`
    );
  }
  buttons.push(
    `<button type="button" class="biblioteca-page-btn" data-page="${state.page + 1}" ${state.page >= totalPages ? "disabled" : ""} aria-label="Página siguiente">›</button>`
  );
  pager.innerHTML = buttons.join("");
  pager.querySelectorAll(".biblioteca-page-btn[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.page);
      if (!Number.isNaN(p)) {
        state.page = p;
        render();
        document.getElementById("biblioteca-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function render() {
  const grid = document.getElementById("biblioteca-grid");
  const status = document.getElementById("biblioteca-status");
  if (!grid || !status) return;

  const hasFilter = state.eje !== "all" || state.dimension !== "all" || state.tactic !== "all" || !!state.date || !!state.searchQuery.trim();
  const filtered = hasFilter
    ? state.resets.filter(matchesFilters)
    : state.initialSample;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    renderPager(0);
    status.textContent = state.resets.length === 0
      ? "Todavía no hay Re(s)ets en la biblioteca."
      : "Ningún Re(s)et coincide con los filtros seleccionados.";
    return;
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const countText = hasFilter
    ? `${filtered.length} Re(s)et${filtered.length === 1 ? "" : "s"}`
    : `${filtered.length} Re(s)et${filtered.length === 1 ? "" : "s"} al azar de ${state.resets.length}`;
  status.textContent = totalPages > 1
    ? `${countText} · página ${state.page} de ${totalPages}`
    : countText;

  grid.innerHTML = pageItems.map(buildCard).join("");
  renderPager(totalPages);
}

const ACTIVITY_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function levelFor(count, max) {
  if (!count) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function renderActivity() {
  const container = document.getElementById("biblioteca-activity");
  if (!container) return;

  const counts = {};
  state.resets.forEach((r) => {
    const key = localDayKey(r.createdAt);
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  const keys = Object.keys(counts);
  if (keys.length === 0) {
    container.innerHTML = "";
    return;
  }
  const maxCount = Math.max(...Object.values(counts));

  // Rango: últimas 53 semanas (un año), terminando hoy — estilo GitHub.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // retroceder al domingo

  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= today) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      if (cursor <= today) {
        const key = dayKeyFromDate(cursor);
        week.push({ key, date: new Date(cursor), count: counts[key] || 0 });
      } else {
        week.push(null);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // Etiquetas de mes: una por columna que contiene el primer día del mes (1) o el inicio de los datos
  const monthLabels = weeks.map((week, wi) => {
    if (wi === 0) {
      const firstDay = week.find((d) => d);
      return firstDay ? ACTIVITY_MONTHS[firstDay.date.getMonth()] : "";
    }
    const hasFirstOfMonth = week.some((d) => d && d.date.getDate() === 1);
    if (hasFirstOfMonth) {
      const firstDayOfMonth = week.find((d) => d && d.date.getDate() === 1);
      return ACTIVITY_MONTHS[firstDayOfMonth.date.getMonth()];
    }
    return "";
  });

  const monthsHtml = monthLabels
    .map((m) => `<span class="activity-month">${m}</span>`)
    .join("");

  const cellsHtml = weeks
    .map((week) => {
      const cells = week
        .map((d) => {
          if (!d) return '<span class="activity-cell is-empty" aria-hidden="true"></span>';
          const lvl = levelFor(d.count, maxCount);
          const label = `${d.count} Re(s)et${d.count === 1 ? "" : "s"} · ${formatDate(d.date.toISOString())}`;
          const selected = state.date === d.key ? " is-selected" : "";
          return `<button type="button" class="activity-cell activity-l${lvl}${selected}" data-day="${d.key}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></button>`;
        })
        .join("");
      return `<div class="activity-week">${cells}</div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="activity-heatmap">
      <div class="activity-months">${monthsHtml}</div>
      <div class="activity-weeks">${cellsHtml}</div>
    </div>
    <div class="activity-legend">
      <span>menos</span>
      <span class="activity-cell activity-l0"></span>
      <span class="activity-cell activity-l1"></span>
      <span class="activity-cell activity-l2"></span>
      <span class="activity-cell activity-l3"></span>
      <span class="activity-cell activity-l4"></span>
      <span>más</span>
    </div>
  `;

  container.querySelectorAll(".activity-cell[data-day]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const day = cell.dataset.day;
      state.date = state.date === day ? null : day;
      state.page = 1;
      renderActivity();
      render();
    });
  });

  // Anclar el scroll a la semana actual (extremo derecho): a medida que
  // corren las semanas, la ventana visible sigue la actividad más reciente.
  container.scrollLeft = container.scrollWidth;
}

function wireFilters() {
  document.querySelectorAll(".biblioteca-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter;
      const value = chip.dataset.value;
      if (filter === "eje") {
        state.eje = value;
        state.tactic = "all";
        populateTacticOptions();
      }
      if (filter === "dimension") state.dimension = value;
      state.page = 1;

      const row = chip.closest(".biblioteca-chip-row");
      if (row) {
        row.querySelectorAll(".biblioteca-chip").forEach((c) => c.classList.remove("is-active"));
      }
      chip.classList.add("is-active");

      render();
    });
  });

  const tacticSelect = document.getElementById("filter-tacticas");
  if (tacticSelect) {
    tacticSelect.addEventListener("change", () => {
      state.tactic = tacticSelect.value;
      state.page = 1;
      render();
    });
  }

  const searchInput = document.getElementById("search-text");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      state.page = 1;
      render();
    });
  }
}

async function populateTacticOptions() {
  const select = document.getElementById("filter-tacticas");
  if (!select) return;
  if (state.allTactics.length === 0) {
    try {
      const resp = await fetch("data/resetario-cards.json");
      const json = await resp.json();
      state.allTactics = json.cards || [];
    } catch (e) {
      console.error("No se pudieron cargar las tácticas predefinidas:", e);
    }
  }

  // Filtrar tácticas por eje activo
  let filteredTactics = state.allTactics;
  if (state.eje !== "all") {
    const targetColor = EJE_TO_COLOR[state.eje];
    filteredTactics = state.allTactics.filter((c) => c.color === targetColor);
  }

  const options = ['<option value="all">todas</option>']
    .concat(filteredTactics.map((t) => `<option value="${escapeHtml(t.title)}">${escapeHtml(t.title)}</option>`));
  select.innerHTML = options.join("");
  select.value = state.tactic;
}

async function init() {
  wireFilters();
  const status = document.getElementById("biblioteca-status");
  try {
    state.resets = await getResets();
    state.initialSample = sampleRandom(state.resets, INITIAL_SAMPLE_SIZE);
    populateTacticOptions();
    renderActivity();
    render();
  } catch (e) {
    console.error("Error al cargar la biblioteca de Re(s)ets:", e);
    if (status) status.textContent = "No se pudo cargar la biblioteca. Intenta de nuevo más tarde.";
  }
}

document.addEventListener("DOMContentLoaded", init);
