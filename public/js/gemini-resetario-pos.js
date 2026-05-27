import { printer } from './printer-pos.js';

// Cliente frontend para hablar con la Firebase Function `callGemini`
// sin exponer la API key de Gemini en el navegador.

import { saveReset, getAppCheckToken } from "./firebase-client.js";

// ========== Constantes de configuración ==========
const CONFIG = {
  MAX_TACTICS: 3,
  HASH_LENGTH: 16,
  SCROLL_OFFSET_PX: 80,
  BAR_HEIGHT_MIN: 24,
  BAR_HEIGHT_RANGE: 56,
  GLYPH_POS_MIN: 15,
  GLYPH_POS_RANGE: 70,
  CIRCLE_CENTER: 50,
  CIRCLE_RADIUS: 35,
  MAX_PROMPT_LENGTH: 2000,
  AUDIO: {
    DEFAULT_DURATION: 0.08,
    ATTACK_TIME: 0.01,
    DECAY_TIME: 0.03,
    SUSTAIN_LEVEL: 0.1,
    PEAK_LEVEL: 0.15,
    RELEASE_OFFSET: 0.02,
    EJE_DURATION: 0.1,
    DIMENSION_DURATION: 0.06,
    SUBMIT_DELAY_1: 50,
    SUBMIT_DELAY_2: 100,
    SUBMIT_SHORT: 0.08,
    SUBMIT_LONG: 0.12,
    ESC_SHORT: 0.06,
    ESC_LONG: 0.08,
    ESC_DELAY: 40,
  },
};

const EJE_FREQUENCIES = {
  agua: 440,        // A4 - Azul
  alimento: 523,    // C5 - Verde
  cobijo: 587,      // D5 - Amarillo
  energia: 659,     // E5 - Rojo
  comunicacion: 784, // G5 - Naranja
};

const DIMENSION_FREQUENCIES = {
  Tiempo: 880,        // A5
  Espacio: 1047,      // C6
  "Información": 1175, // D6
};

const EJE_LABELS = {
  agua: "Agua",
  alimento: "Alimento",
  cobijo: "Cobijo",
  energia: "Energía",
  comunicacion: "Comunicación",
};

const EJE_TO_COLOR = {
  agua: "blue",
  alimento: "green",
  cobijo: "yellow",
  energia: "red",
  comunicacion: "orange",
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resetario-ai-form");
  const statusEl = document.getElementById("resetario-ai-status");
  const deviceEl = document.querySelector(".resetario-ai-device");
  const answerSection = document.getElementById("resetario-ai-answer");
  const answerTextEl = document.getElementById("resetario-ai-answer-text");
  const responseTextEl = document.getElementById("resetario-ai-response-text");
  const answerTitleEl = document.getElementById("resetario-ai-answer-title");
  const tacticsPrevBtn = document.getElementById("resetario-ai-tactics-prev");
  const tacticsNextBtn = document.getElementById("resetario-ai-tactics-next");
  const tacticsCounterEl = document.getElementById(
    "resetario-ai-tactics-counter",
  );
  const themeToggle = document.getElementById("resetario-ai-theme-toggle");
  const resetarioSection = document.getElementById("resetario-ai");
  const ejeButtons = document.querySelectorAll(".tp7-eje-button");
  const glyphLayer = document.querySelector(".tp7-disk-glyph-layer");
  const submitButton = document.querySelector(".tp7-submit-button");
  const escButton = document.getElementById("resetario-ai-esc");

  // Botón y controles de impresión
  const connectPrinterBtn = document.getElementById("printer-connect-btn");
  const reprintBtn = document.getElementById("printer-reprint-btn");
  const printerStatusEl = document.getElementById("printer-status");
  const paperSizeSelect = document.getElementById("printer-paper-size");

  function updatePrinterButtons() {
    if (!connectPrinterBtn || !reprintBtn) return;
    
    if (printer.isConnected) {
      connectPrinterBtn.textContent = "Desconectar Impresora";
      printerStatusEl.textContent = "Conectada";
      printerStatusEl.className = "printer-status status-connected";
      reprintBtn.disabled = !state.lastPrintData;
    } else {
      connectPrinterBtn.textContent = "Conectar Impresora";
      printerStatusEl.textContent = "Desconectada";
      printerStatusEl.className = "printer-status status-disconnected";
      reprintBtn.disabled = true;
    }
  }

  if (connectPrinterBtn) {
    connectPrinterBtn.addEventListener("click", async () => {
      try {
        if (printer.isConnected) {
          await printer.disconnect();
        } else {
          connectPrinterBtn.disabled = true;
          connectPrinterBtn.textContent = "Buscando...";
          await printer.connect();
          connectPrinterBtn.disabled = false;
        }
        updatePrinterButtons();
      } catch (err) {
        console.error(err);
        alert("Error al conectar con la impresora. Aseg\u00farsate de que Bluetooth est\u00e1 activado y la impresora est\u00e1 en modo emparejamiento.");
        connectPrinterBtn.disabled = false;
        updatePrinterButtons();
        printerStatusEl.textContent = "Error";
        printerStatusEl.className = "printer-status status-error";
      }
    });
  }

  if (reprintBtn) {
    reprintBtn.addEventListener("click", async () => {
      if (state.lastPrintData && printer.isConnected) {
        try {
          reprintBtn.disabled = true;
          reprintBtn.textContent = "Imprimiendo...";
          await printer.printReset(state.lastPrintData);
        } catch (err) {
          console.error(err);
          alert("Error al volver a imprimir.");
        } finally {
          reprintBtn.disabled = false;
          reprintBtn.textContent = "Volver a imprimir";
        }
      }
    });
  }

  if (paperSizeSelect) {
    paperSizeSelect.addEventListener("change", (e) => {
      printer.setPaperSize(e.target.value);
    });
  }

  updatePrinterButtons();

  // ========== Estado centralizado ==========
  const state = {
    currentEjeKey: null,
    currentGlyphIndex: null,
    selectedGlyphCards: [],
    currentTacticIndex: 0,
    currentDimensions: [],
    lastPrintData: null,
    cardsData: null,
    colorMeanings: null,
    audioContext: null,
  };

  function resetState() {
    state.selectedGlyphCards = [];
    state.currentGlyphIndex = null;
    state.currentEjeKey = null;
    state.currentTacticIndex = 0;
    state.currentDimensions = [];
    updateTacticNavButtons();
  }

  // ========== Sistema de Audio (Web Audio API) ==========
  function getAudioContext() {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return state.audioContext;
  }

  function playTone(frequency, duration = CONFIG.AUDIO.DEFAULT_DURATION, type = 'sine') {
    try {
      const ctx = getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.value = frequency;

      const now = ctx.currentTime;
      const { PEAK_LEVEL, ATTACK_TIME, DECAY_TIME, SUSTAIN_LEVEL, RELEASE_OFFSET } = CONFIG.AUDIO;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(PEAK_LEVEL, now + ATTACK_TIME);
      gainNode.gain.linearRampToValueAtTime(SUSTAIN_LEVEL, now + DECAY_TIME);
      gainNode.gain.setValueAtTime(SUSTAIN_LEVEL, now + duration - RELEASE_OFFSET);
      gainNode.gain.linearRampToValueAtTime(0, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (e) {
      console.warn('Audio no disponible:', e);
    }
  }

  function playEjeSound(ejeKey) {
    const freq = EJE_FREQUENCIES[ejeKey] || 440;
    playTone(freq, CONFIG.AUDIO.EJE_DURATION, 'triangle');
  }

  function playDimensionSound(dimension) {
    const freq = DIMENSION_FREQUENCIES[dimension] || 880;
    playTone(freq, CONFIG.AUDIO.DIMENSION_DURATION, 'sine');
  }

  function playSubmitSound() {
    playTone(523, CONFIG.AUDIO.SUBMIT_SHORT, 'square');
    setTimeout(() => playTone(659, CONFIG.AUDIO.SUBMIT_SHORT, 'square'), CONFIG.AUDIO.SUBMIT_DELAY_1);
    setTimeout(() => playTone(784, CONFIG.AUDIO.SUBMIT_LONG, 'square'), CONFIG.AUDIO.SUBMIT_DELAY_2);
  }

  function playEscSound() {
    playTone(784, CONFIG.AUDIO.ESC_SHORT, 'sawtooth');
    setTimeout(() => playTone(523, CONFIG.AUDIO.ESC_LONG, 'sawtooth'), CONFIG.AUDIO.ESC_DELAY);
  }

  // ========== Utilidades ==========
  function generateHash() {
    const bytes = new Uint8Array(CONFIG.HASH_LENGTH / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function colorClassFor(colorKey) {
    const map = {
      red: "resetario-bar-red",
      blue: "resetario-bar-blue",
      green: "resetario-bar-green",
      yellow: "resetario-bar-yellow",
      orange: "resetario-bar-orange",
    };
    return map[colorKey] || "resetario-bar-neutral";
  }

  // ========== Carga de datos ==========
  async function loadCardsData() {
    if (state.cardsData) return state.cardsData;
    try {
      const resp = await fetch("data/resetario-cards.json");
      const json = await resp.json();
      state.cardsData = json.cards || [];
    } catch (e) {
      console.error("No se pudieron cargar los datos de resetario-cards.json", e);
      state.cardsData = [];
    }
    return state.cardsData;
  }

  async function loadGlyphDictionary() {
    if (state.colorMeanings) return state.colorMeanings;
    try {
      const resp = await fetch("data/glyph-dictionary.json");
      const json = await resp.json();
      state.colorMeanings = (json && json.colorMeanings) || null;
    } catch (e) {
      console.error("No se pudo cargar glyph-dictionary.json", e);
      state.colorMeanings = null;
    }
    return state.colorMeanings;
  }

  // ========== Renderizado ==========
  function getBarCardsForOutput(cardInfo) {
    if (state.selectedGlyphCards.length > 0) {
      return state.selectedGlyphCards.slice(0, CONFIG.MAX_TACTICS);
    }
    if (cardInfo) {
      return [
        {
          color: cardInfo.color || "standard",
          ejeKey: state.currentEjeKey || null,
          proximity: 0.5,
        },
      ];
    }
    return [];
  }

  function sanitizeGeminiHtml(raw) {
    const allowed = { ALLOWED_TAGS: ['h4', 'p', 'strong', 'em', 'br', 'ul', 'ol', 'li'] };
    if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(raw, allowed);
    return raw.replace(/<(?!\/?(?:h4|p|strong|em|br|ul|ol|li)\b)[^>]*>/gi, '');
  }

  function renderResetarioOutput({ text, cardInfo, loading, forcedHash }) {
    if (!responseTextEl) return "";

    const barCards = getBarCardsForOutput(cardInfo);

    const barsHtml = barCards
      .map((c) => {
        const prox =
          typeof c.proximity === "number" && !Number.isNaN(c.proximity)
            ? c.proximity
            : 0.5;
        const height = CONFIG.BAR_HEIGHT_MIN + Math.round(prox * CONFIG.BAR_HEIGHT_RANGE);
        const barClass = colorClassFor(c.color);
        return `<div class="resetario-bar ${barClass}" style="height:${height}px"></div>`;
      })
      .join("");

    const hash = !loading ? (forcedHash || generateHash()) : "";

    const dimsText = state.currentDimensions.length
      ? state.currentDimensions.join(", ")
      : "\u2014";

    const tacticsLines = state.selectedGlyphCards.slice(0, CONFIG.MAX_TACTICS).map((card) => {
      const colorKey =
        card.color || (card.ejeKey && EJE_TO_COLOR[card.ejeKey]) || "neutral";
      const badgeClasses = `resetario-tactic-badge resetario-tactic-badge-${colorKey}`;
      return `<span class="${badgeClasses}">${card.title}</span>`;
    });

    const tacticsHtml =
      tacticsLines.length > 0 ?
        tacticsLines.join("") :
        '<p class="resetario-section-empty">Selecciona uno o m\u00e1s glyphs para ver t\u00e1cticas.</p>';

    const resetHtml = loading
      ? `<div class="resetario-section-content resetario-output-text-loading">
            <div class="resetario-ai-loading">
              <div class="loading-spinner"></div>
            </div>
          </div>`
      : `<div class="resetario-section-content">
            <p class="resetario-output-text">${sanitizeGeminiHtml(text)}</p>
          </div>`;

    const bodyHtml = `
      <div class="resetario-sections">
        <div class="resetario-section">
          <div class="resetario-section-label">T\u00e1cticas</div>
          <div class="resetario-section-content resetario-tactics-row">
            ${tacticsHtml}
          </div>
        </div>
        <div class="resetario-section">
          <div class="resetario-section-label">Re(s)et</div>
          ${resetHtml}
        </div>
        <div class="resetario-section">
          <div class="resetario-section-label">Dimensiones</div>
          <div class="resetario-section-content">
            <p>${dimsText}</p>
          </div>
        </div>
      </div>
    `;

    const footerHtml = `<div class="resetario-output-footer">
        ${hash ? `<span class="resetario-output-hash">${hash}</span>` : ""}
      </div>`;

    const responseHtml = `
      <div class="resetario-output" aria-label="Respuesta del Re(s)etario">
        <div class="resetario-output-header">
          <div class="resetario-output-title">
            <div class="resetario-output-title-main">Re(s)etario</div>
            <div class="resetario-output-title-sub">v.0.2</div>
          </div>
          <div class="resetario-output-bars">
            ${barsHtml}
          </div>
        </div>
        <div class="resetario-output-body">
          ${bodyHtml}
        </div>
        ${footerHtml}
      </div>
    `;

    responseTextEl.innerHTML = responseHtml;

    if (!loading) {
      responseTextEl.scrollIntoView({ behavior: "smooth", block: "start" });
      
      // DISPARAR IMPRESIÓN AUTOMÁTICA SI ESTÁ CONECTADO
      const printData = {
        text: text,
        tactics: state.selectedGlyphCards.map(c => ({
          eje: EJE_LABELS[c.ejeKey] || c.ejeKey,
          title: c.title
        })),
        dimensions: state.currentDimensions,
        hash: hash
      };
      
      state.lastPrintData = printData;
      updatePrinterButtons();

      if (printer.isConnected) {
        printer.printReset(printData).catch(err => {
          console.error("Error al imprimir:", err);
          statusEl.textContent = "Error al imprimir. Revisa la conexi\u00f3n.";
        });
      }
    }
    return hash;
  }

  function renderInitialInfoCard() {
    if (!answerSection || !answerTextEl) return;

    answerSection.hidden = false;
    if (answerTitleEl) {
      answerTitleEl.hidden = true;
    }
    answerTextEl.classList.add("info-mode");
    answerTextEl.innerHTML = `
      <div class="reset-card resetario-ai-info-card active" aria-label="Informaci\u00f3n sobre el Re(s)etario" tabindex="0">
        <div class="card-inner">
          <div class="card-front">
            <div class="resetario-ai-info-front">
              <div class="resetario-ai-info-icon">
                <span>i</span>
              </div>
              <div class="resetario-ai-info-label">Info</div>
            </div>
          </div>
          <div class="card-back">
            <div class="card-back-content">
              <h4>Instrucciones</h4>
              <p>1. Escoja hasta tres t\u00e1cticas de <strong>Agua</strong>, <strong>Alimentaci\u00f3n</strong>, <strong>Cobijo</strong>, <strong>Energ\u00eda</strong> o <strong>Comunicaci\u00f3n</strong>.</p>
              <p>2. Seleccione las dimensiones de <strong>Tiempo</strong>, <strong>Espacio</strong> o <strong>Informaci\u00f3n</strong>.</p>
              <p>3. Pulse <strong>Re(s)et</strong> para crear una Re(s)eta con las t\u00e1cticas seleccionadas.</p>
              <p>Para m\u00e1s detalle metodol\u00f3gico consulta la <a href="/resetario/documentacion">Documentaci\u00f3n</a>.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const infoCard = answerTextEl.querySelector(".resetario-ai-info-card");
    if (infoCard) {
      const toggleFlip = () => {
        infoCard.classList.toggle("flipped");
      };
      infoCard.addEventListener("click", toggleFlip);
      infoCard.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggleFlip();
        }
      });
    }
  }

  function updateTacticNavButtons() {
    if (!tacticsPrevBtn || !tacticsNextBtn || !tacticsCounterEl) return;
    const total = state.selectedGlyphCards.length;
    if (!total) {
      tacticsPrevBtn.disabled = true;
      tacticsNextBtn.disabled = true;
      tacticsCounterEl.textContent = "0 / 0";
      return;
    }
    tacticsPrevBtn.disabled = state.currentTacticIndex <= 0;
    tacticsNextBtn.disabled = state.currentTacticIndex >= total - 1;
    tacticsCounterEl.textContent = `${state.currentTacticIndex + 1} / ${total}`;
  }

  function renderSelectedGlyphCards() {
    if (!answerSection || !answerTextEl) return;

    answerSection.hidden = false;
    if (answerTitleEl) {
      answerTitleEl.hidden = false;
    }

    if (!state.selectedGlyphCards.length) {
      answerTextEl.innerHTML = "";
      state.currentTacticIndex = 0;
      updateTacticNavButtons();
      return;
    }

    answerTextEl.classList.remove("info-mode");

    if (state.currentTacticIndex >= state.selectedGlyphCards.length) {
      state.currentTacticIndex = state.selectedGlyphCards.length - 1;
    }

    const card = state.selectedGlyphCards[state.currentTacticIndex];
    const glyphSrc =
      card.glyph ||
      `img/glyph/glyph_${card.id.toString().padStart(2, "0")}.png`;
    const glyphNumber = card.number || "\u2014";
    const cardColor = card.color || "standard";

    const cardHtml = `
      <div class="reset-card combination-card card-${cardColor} active" aria-label="T\u00e1ctica seleccionada" tabindex="0">
        <div class="card-inner">
          <div class="card-front">
            <div class="card-top">
              <img src="${glyphSrc}" alt="APICCA Glyph ${glyphNumber}" class="card-glyph">
            </div>
            <div class="card-bottom">
              <span class="card-number">${glyphNumber}</span>
            </div>
          </div>
          <div class="card-back">
            <div class="card-back-content">
              <h3>${card.title}</h3>
              <p>${card.description}</p>
            </div>
          </div>
        </div>
      </div>
    `;

    answerTextEl.innerHTML = cardHtml;

    const cardEl = answerTextEl.querySelector(".reset-card");
    if (cardEl) {
      const toggleFlip = () => {
        cardEl.classList.toggle("flipped");
      };
      cardEl.addEventListener("click", toggleFlip);
      cardEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggleFlip();
        }
      });
    }

    updateTacticNavButtons();
  }

  if (!form) return;

  // ========== Funciones auxiliares del formulario ==========
  function getSelectedDimensions() {
    const checkboxes = form.querySelectorAll('input[name="dimension"]');
    return Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }

  function buildPrompt(dimensions, glyphCards) {
    const userText = `Dimensiones seleccionadas: ${dimensions.join(", ")}.`;
    const tacticsText =
      glyphCards && glyphCards.length
        ? glyphCards
          .slice(0, CONFIG.MAX_TACTICS)
          .map((card) => {
            const ejeLabelForCard =
              card.ejeKey && EJE_LABELS[card.ejeKey]
                ? `[${EJE_LABELS[card.ejeKey]}] `
                : "";
            return `${ejeLabelForCard}${card.title} | ${card.description}`;
          })
          .join("\n")
        : "";
    return tacticsText
      ? `${userText}\n\nTacticas:\n\n${tacticsText}`
      : userText;
  }

  function setFormBusy(busy) {
    if (submitButton) {
      submitButton.disabled = busy;
      submitButton.classList.toggle("tp7-submit-disabled", busy);
    }
    if (escButton) {
      escButton.disabled = busy;
    }
  }

  function resolveCardInfo() {
    if (state.currentGlyphIndex === null) {
      if (state.currentEjeKey) {
        const desiredColor = EJE_TO_COLOR[state.currentEjeKey];
        const candidates = Array.isArray(state.cardsData)
          ? state.cardsData.filter((c) => c.color === desiredColor)
          : [];
        if (candidates.length) {
          const cardInfo = candidates[Math.floor(Math.random() * candidates.length)];
          state.currentGlyphIndex = cardInfo.id;
          return cardInfo;
        }
      }
      if (Array.isArray(state.cardsData) && state.cardsData.length) {
        const any = state.cardsData[Math.floor(Math.random() * state.cardsData.length)];
        state.currentGlyphIndex = any.id;
        return any;
      }
      return null;
    }
    return Array.isArray(state.cardsData) && state.cardsData.length > state.currentGlyphIndex
      ? state.cardsData[state.currentGlyphIndex]
      : null;
  }

  function getErrorMessage(err, response) {
    if (response) {
      const status = response.status;
      if (status === 429) return "Demasiadas solicitudes. Int\u00e9ntalo de nuevo en un momento.";
      if (status === 502) return "El servicio de IA no est\u00e1 disponible temporalmente.";
      if (status === 400) return "Solicitud inv\u00e1lida. Verifica tus selecciones.";
      return `Error al llamar al asistente (c\u00f3digo ${status}).`;
    }
    if (err instanceof TypeError) {
      return "Error de conexi\u00f3n. Revisa tu conexi\u00f3n a internet e int\u00e9ntalo de nuevo.";
    }
    return "Hubo un problema de conexi\u00f3n con el asistente. Revisa tu conexi\u00f3n o int\u00e9ntalo de nuevo.";
  }

  // ========== Event Listeners ==========

  // Toggle de modo claro/oscuro del aparato
  if (themeToggle && resetarioSection) {
    themeToggle.addEventListener("change", () => {
      if (themeToggle.checked) {
        resetarioSection.classList.add("resetario-ai-light");
      } else {
        resetarioSection.classList.remove("resetario-ai-light");
      }
    });
  }

  // Desactivar env\u00edo hasta que se seleccione un eje de color
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.classList.add("tp7-submit-disabled");
  }

  // Mostrar tarjeta de informaci\u00f3n al cargar la p\u00e1gina
  renderInitialInfoCard();

  // Bot\u00f3n Esc: limpiar selecciones y volver al estado inicial
  if (escButton) {
    escButton.addEventListener("click", () => {
      playEscSound();
      escButton.disabled = true;

      if (glyphLayer) {
        while (glyphLayer.firstChild) {
          glyphLayer.removeChild(glyphLayer.firstChild);
        }
      }

      resetState();

      if (ejeButtons && ejeButtons.length > 0) {
        ejeButtons.forEach((b) => b.classList.remove("active"));
      }

      setFormBusy(true);
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add("tp7-submit-disabled");
      }

      if (form) {
        const dimensionCheckboxes =
          form.querySelectorAll('input[name="dimension"]');
        dimensionCheckboxes.forEach((cb) => {
          cb.checked = false;
        });
      }

      if (statusEl) {
        statusEl.textContent = "";
      }
      if (responseTextEl) {
        responseTextEl.innerHTML = "";
      }
      renderInitialInfoCard();

      escButton.disabled = false;
    });
  }

  // Botones de ejes de color (agua, alimento, cobijo, etc.)
  if (ejeButtons && ejeButtons.length > 0) {
    ejeButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ejeKey = btn.dataset.eje;

        playEjeSound(ejeKey);

        ejeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        state.currentEjeKey = ejeKey;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove("tp7-submit-disabled");
        }

        if (state.selectedGlyphCards.length >= CONFIG.MAX_TACTICS) {
          if (statusEl) {
            statusEl.textContent =
              "Ya seleccionaste tres t\u00e1cticas. Puedes hacer Re(s)et o recargar para elegir de nuevo.";
          }
          return;
        }

        if (glyphLayer) {
          const allCards = await loadCardsData();
          const colorKey = EJE_TO_COLOR[ejeKey];
          const usedIds = new Set(state.selectedGlyphCards.map((c) => c.id));
          let candidates = Array.isArray(allCards)
            ? allCards.filter(
              (c) => c.color === colorKey && !usedIds.has(c.id),
            )
            : [];

          if (!candidates.length && Array.isArray(allCards)) {
            candidates = allCards.filter((c) => c.color === colorKey);
          }

          if (!candidates.length) {
            return;
          }

          const chosen =
            candidates[Math.floor(Math.random() * candidates.length)];

          const top = CONFIG.GLYPH_POS_MIN + Math.random() * CONFIG.GLYPH_POS_RANGE;
          const left = CONFIG.GLYPH_POS_MIN + Math.random() * CONFIG.GLYPH_POS_RANGE;

          const dx = left - CONFIG.CIRCLE_CENTER;
          const dy = top - CONFIG.CIRCLE_CENTER;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(CONFIG.CIRCLE_RADIUS * CONFIG.CIRCLE_RADIUS * 2);
          const proximity = 1 - Math.min(dist / maxDist, 1);

          state.selectedGlyphCards.push({
            ...chosen,
            ejeKey,
            proximity,
          });
          state.currentTacticIndex = state.selectedGlyphCards.length - 1;

          const wrapper = document.createElement("div");
          wrapper.className = `tp7-disk-glyph tp7-disk-glyph-${ejeKey}`;

          const img = document.createElement("img");
          state.currentGlyphIndex = chosen.id;
          const padded = chosen.id.toString().padStart(2, "0");
          img.src = chosen.glyph || `img/glyph/glyph_${padded}.png`;
          img.alt = `Glyph ${padded}`;

          wrapper.style.top = `${top}%`;
          wrapper.style.left = `${left}%`;

          wrapper.appendChild(img);
          glyphLayer.appendChild(wrapper);
        }

        renderSelectedGlyphCards();
      });
    });
  }

  // Navegaci\u00f3n de t\u00e1cticas estilo mazo
  if (tacticsPrevBtn) {
    tacticsPrevBtn.addEventListener("click", () => {
      if (state.currentTacticIndex > 0) {
        state.currentTacticIndex -= 1;
        renderSelectedGlyphCards();
      }
    });
  }

  if (tacticsNextBtn) {
    tacticsNextBtn.addEventListener("click", () => {
      if (state.currentTacticIndex < state.selectedGlyphCards.length - 1) {
        state.currentTacticIndex += 1;
        renderSelectedGlyphCards();
      }
    });
  }

  // ========== Submit handler ==========
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const selectedDimensions = getSelectedDimensions();
    if (selectedDimensions.length === 0) {
      statusEl.textContent = "Selecciona al menos una dimensi\u00f3n: Tiempo, Espacio o Conocimiento.";
      return;
    }

    playSubmitSound();
    setFormBusy(true);
    state.currentDimensions = selectedDimensions;

    const prompt = buildPrompt(selectedDimensions, state.selectedGlyphCards);

    statusEl.textContent = "Consultando...";
    if (deviceEl) {
      const rect = deviceEl.getBoundingClientRect();
      const targetY = window.scrollY + rect.top - CONFIG.SCROLL_OFFSET_PX;
      window.scrollTo({
        top: targetY < 0 ? 0 : targetY,
        behavior: "smooth",
      });
    }
    if (answerSection) {
      answerSection.hidden = false;
    }
    if (answerTitleEl) {
      answerTitleEl.hidden = false;
    }
    renderResetarioOutput({ text: "", cardInfo: null, loading: true });

    let response;
    try {
      const FUNCTION_URL = "/callGemini";
      const appCheckToken = await getAppCheckToken();
      const fetchHeaders = { "Content-Type": "application/json" };
      if (appCheckToken) fetchHeaders["X-Firebase-AppCheck"] = appCheckToken;
      response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: fetchHeaders,
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        let message = getErrorMessage(null, response);
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            message += ` ${errData.error}`;
          }
        } catch (_e) {
          // ignorar errores de parseo de JSON
        }
        statusEl.textContent = message;
        setFormBusy(false);
        return;
      }

      const data = await response.json();
      const text = (data && data.text) || "No he podido generar una respuesta \u00fatil.";

      statusEl.textContent = "";
      await loadCardsData();
      const cardInfo = resolveCardInfo();

      const hash = renderResetarioOutput({ text, cardInfo, loading: false });

      // Guardar reset en Firestore (versión original sin modificaciones para POS)
      saveReset({
        hash: hash,
        text: text,
        tactics: state.selectedGlyphCards.slice(0, CONFIG.MAX_TACTICS).map(c => ({
          title: c.title,
          description: c.description,
          eje: c.ejeKey
        })),
        dimensions: state.currentDimensions
      });

      if (answerSection) {
        answerSection.hidden = false;
      }
      setFormBusy(false);
    } catch (err) {
      console.error("Error llamando al asistente del Re(s)etario:", err);
      statusEl.textContent = getErrorMessage(err, null);
      setFormBusy(false);
    }
  });

  // ========== Navegaci\u00f3n por teclado ==========
  const keyToEje = {
    "1": "agua",
    "2": "alimento",
    "3": "cobijo",
    "4": "energia",
    "5": "comunicacion",
  };

  const keyToDimension = {
    "t": "Tiempo",
    "T": "Tiempo",
    "e": "Espacio",
    "E": "Espacio",
    "i": "Informaci\u00f3n",
    "I": "Informaci\u00f3n",
  };

  document.addEventListener("keydown", (event) => {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable)
    ) {
      return;
    }

    if (event.key === "Escape" && escButton) {
      event.preventDefault();
      escButton.click();
      return;
    }

    if (event.key === "Enter" && submitButton && !submitButton.disabled) {
      event.preventDefault();
      submitButton.click();
      return;
    }

    if (keyToEje[event.key] && ejeButtons && ejeButtons.length > 0) {
      event.preventDefault();
      const targetEje = keyToEje[event.key];
      const targetButton = Array.from(ejeButtons).find(
        (btn) => btn.dataset.eje === targetEje
      );
      if (targetButton) {
        playEjeSound(targetEje);
        targetButton.click();
      }
      return;
    }

    if (keyToDimension[event.key]) {
      event.preventDefault();
      const dimensionValue = keyToDimension[event.key];
      const dimensionCheckboxes = form.querySelectorAll('input[name="dimension"]');
      const targetCheckbox = Array.from(dimensionCheckboxes).find(
        (cb) => cb.value === dimensionValue
      );
      if (targetCheckbox) {
        playDimensionSound(dimensionValue);
        targetCheckbox.checked = !targetCheckbox.checked;
        targetCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
});
