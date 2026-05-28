// Cliente frontend para hablar con la Firebase Function `callGemini`
// sin exponer la API key de Gemini en el navegador.

import { saveReset, getAppCheckToken } from "./firebase-client.js";
import { printerService, ReceiptBuilder } from "./bluetooth-printer.js";

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
  const koIIStatusEl = document.getElementById("ko-ii-status");

  const BUSY_PATTERN = /^consultando/i;
  const setStatus = (text) => {
    if (!koIIStatusEl) return;
    const value = text == null ? "" : String(text);
    koIIStatusEl.textContent = value;
    koIIStatusEl.classList.toggle("is-busy", BUSY_PATTERN.test(value));
  };
  const deviceEl = document.getElementById("ko-ii-device");
  const answerSection = document.getElementById("resetario-ai-answer");
  const answerTextEl = document.getElementById("resetario-ai-answer-text");
  const responseTextEl = document.getElementById("resetario-ai-response-text");
  const answerTitleEl = document.getElementById("resetario-ai-answer-title");
  const tacticsPrevBtn = document.getElementById("resetario-ai-tactics-prev");
  const tacticsNextBtn = document.getElementById("resetario-ai-tactics-next");
  const tacticsCounterEl = document.getElementById(
    "resetario-ai-tactics-counter",
  );
  const ejeButtons = document.querySelectorAll(".tp7-eje-button");
  const submitButton = document.querySelector(".tp7-submit-button");
  const escButton = document.getElementById("resetario-ai-esc");
  // Pantalla del K.O. II y área de salida
  const koIIScreenDisplay = document.querySelector(".device-screen .screen-display");
  const koIIOutput = document.getElementById("ko-ii-output");
  const ioInput = document.getElementById("io-input");
  const ioOutput = document.getElementById("io-output");
  const deviceBtnSync = document.getElementById("device-btn-sync");
  const ioSyncPill = document.getElementById("io-sync");
  const ioPrintPill = document.getElementById("io-print");
  const deviceBtnPrint = document.getElementById("device-btn-print");

  if (deviceBtnSync) {
    deviceBtnSync.addEventListener("click", async () => {
      try {
        if (!printerService.isConnected()) {
          setStatus("Conectando impresora...");
          await printerService.connect();
          if (ioSyncPill) ioSyncPill.classList.add("is-on");
          setStatus("Impresora conectada");
        } else {
          printerService.disconnect();
          if (ioSyncPill) ioSyncPill.classList.remove("is-on");
          setStatus("Impresora desconectada");
        }
      } catch (err) {
        console.error("Error bluetooth:", err);
        setStatus("Error: " + err.message);
      }
    });

    window.addEventListener("printer-disconnected", () => {
      if (ioSyncPill) ioSyncPill.classList.remove("is-on");
    });
  }

  if (deviceBtnPrint) {
    deviceBtnPrint.addEventListener("click", async () => {
      if (!printerService.isConnected()) {
        setStatus("Impresora no conectada");
        return;
      }
      if (!state.lastPrintBuffer) {
        setStatus("No hay ninguna Re(s)eta para imprimir");
        return;
      }
      
      try {
        if (ioPrintPill) ioPrintPill.classList.add("is-on");
        await printerService.sendData(state.lastPrintBuffer);
        // Mantener el LED encendido un poco más para que coincida con el tiempo físico de impresión
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error("Error al reimprimir:", err);
      } finally {
        if (ioPrintPill) ioPrintPill.classList.remove("is-on");
      }
    });
  }

  // ========== Estado centralizado ==========
  const state = {
    currentEjeKey: null,
    currentGlyphIndex: null,
    selectedGlyphCards: [],
    currentTacticIndex: 0,
    currentDimensions: [],
    cardsData: null,
    colorMeanings: null,
    audioContext: null,
    isOutputMode: false,
    lastPrintBuffer: null,
  };

  function resetState() {
    state.selectedGlyphCards = [];
    state.currentGlyphIndex = null;
    state.currentEjeKey = null;
    state.currentTacticIndex = 0;
    state.currentDimensions = [];
    state.isOutputMode = false;
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
            <div class="resetario-output-text">${sanitizeGeminiHtml(text)}</div>
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
        <span class="resetario-output-peek-arrow" aria-hidden="true">▾</span>
      </div>`;

    const responseHtml = `
      <div class="resetario-output" aria-label="Respuesta del Re(s)etario">
        <div class="resetario-output-header">
          <div class="resetario-output-title">
            <div class="resetario-output-title-main">Re(s)etario</div>
            <div class="resetario-output-title-sub">v.0.3</div>
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

    const peekEl = responseTextEl.querySelector('.resetario-output-footer-peek');
    if (peekEl) {
      const parentOutput = peekEl.closest('.resetario-peek-only') || peekEl.closest('.resetario-output');
      if (parentOutput) parentOutput.remove();
    }

    responseTextEl.insertAdjacentHTML('afterbegin', responseHtml);

    if (!loading) {
      // Scroll suave que sigue la tarjeta durante la animación de salida (4s)
      const outputCard = responseTextEl.querySelector('.resetario-output');
      if (outputCard) {
        const animDuration = 7000; // coincide con la duración CSS
        const startTime = performance.now();
        const trackScroll = (now) => {
          const elapsed = now - startTime;
          const rect = outputCard.getBoundingClientRect();
          const bottomOffset = rect.bottom - window.innerHeight + 40;
          if (bottomOffset > 0) {
            window.scrollBy({ top: bottomOffset, behavior: 'auto' });
          }
          if (elapsed < animDuration) {
            requestAnimationFrame(trackScroll);
          }
        };
        requestAnimationFrame(trackScroll);
      }
    }

    return hash;
  }

  function renderInitialInfoCard() {
    if (!koIIScreenDisplay) return;

    // Ocultar área de salida solo si no estamos mostrando el peek
    if (koIIOutput) {
      const answerSection = document.getElementById("resetario-ai-answer");
      if (answerSection && answerSection.classList.contains("is-full")) {
        koIIOutput.hidden = false;
      } else {
        koIIOutput.hidden = true;
      }
    }
    if (answerTextEl) answerTextEl.innerHTML = "";

    koIIScreenDisplay.innerHTML = `
      <div class="reset-card resetario-ai-info-card active" aria-label="Información sobre el Re(s)etario" tabindex="0">
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
              <p>1. Escoja hasta tres t\u00e1cticas de <strong>Agua</strong>, <strong>Alimentación</strong>, <strong>Cobijo</strong>, <strong>Energía</strong> o <strong>Comunicación</strong>.</p>
              <p>2. Seleccione las dimensiones de <strong>Tiempo</strong>, <strong>Espacio</strong> o <strong>Información</strong>.</p>
              <p>3. Pulse <strong>Re(s)et</strong> para crear una Re(s)eta con las t\u00e1cticas seleccionadas.</p>

            </div>
          </div>
        </div>
      </div>
    `;

    const infoCard = koIIScreenDisplay.querySelector(".resetario-ai-info-card");
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
    if (!koIIScreenDisplay) return;

    // Las tarjetas de eje van DENTRO de la pantalla del K.O. II
    // Los controles de nav se muestran debajo del dispositivo
    if (!state.selectedGlyphCards.length) {
      koIIScreenDisplay.innerHTML = "";
      if (koIIOutput) koIIOutput.hidden = true;
      state.currentTacticIndex = 0;
      updateTacticNavButtons();
      return;
    }

    if (koIIOutput) koIIOutput.hidden = false;

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
      <div class="reset-card combination-card card-${cardColor} active" aria-label="Táctica seleccionada" tabindex="0">
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

    koIIScreenDisplay.innerHTML = cardHtml;

    // Limpiar answerTextEl para evitar duplicados
    if (answerTextEl) answerTextEl.innerHTML = "";

    const cardEl = koIIScreenDisplay.querySelector(".reset-card");
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
      const disableSubmit = busy || state.isOutputMode;
      submitButton.disabled = disableSubmit;
      submitButton.classList.toggle("tp7-submit-disabled", disableSubmit);
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

  // Desactivar env\u00edo hasta que se seleccione un eje de color
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.classList.add("tp7-submit-disabled");
  }

  // Mostrar tarjeta de informaci\u00f3n al cargar la p\u00e1gina
  renderInitialInfoCard();

  // Bot\u00f3n Esc: limpiar selecciones y volver al estado inicial
  const handleEscClick = () => {
    playEscSound();
    if (escButton) escButton.disabled = true;

    if (ioInput) ioInput.classList.add("is-on");
    if (ioOutput) ioOutput.classList.remove("is-on");

    resetState();

    if (ejeButtons && ejeButtons.length > 0) {
      ejeButtons.forEach((b) => {
        b.classList.remove("active");
        b.classList.remove("has-card");
      });
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
      const dimBtns = document.querySelectorAll('.tp7-dimension-button');
      if (dimBtns) dimBtns.forEach(b => b.classList.remove('active'));
    }

    setStatus("");
    if (responseTextEl) {

      const hasPrintedCards = responseTextEl.innerHTML.includes("resetario-output-hash");
      const hasPeek = responseTextEl.innerHTML.includes("resetario-output-footer-peek");

      if (!hasPrintedCards && !hasPeek) {
        if (answerSection) {
          answerSection.classList.remove("is-full");
        }
      } else {
        if (answerSection) {
          answerSection.classList.add("is-full");
          answerSection.hidden = false;
        }
      }
    }
    renderInitialInfoCard();

    if (escButton) escButton.disabled = false;
  };

  if (escButton) {
    escButton.addEventListener("click", handleEscClick);
  }
  
  const devicePadEsc = document.getElementById("device-pad-esc");
  if (devicePadEsc) {
    devicePadEsc.addEventListener("click", handleEscClick);
  }

  const devicePadRec = document.querySelector(".device-pads .pad-rec");
  if (devicePadRec && submitButton) {
    devicePadRec.addEventListener("click", () => {
      if (!submitButton.disabled) {
        submitButton.click();
      } else {
        // Optionally play a blocked sound or do nothing
        playEscSound(); // using as generic error sound if needed
      }
    });
  }

  // Botones de ejes de color (agua, alimento, cobijo, etc.)
  if (ejeButtons && ejeButtons.length > 0) {
    ejeButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (state.isOutputMode) return;
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
          setStatus("M\u00e1ximo hasta tres t\u00e1cticas");
          return;
        }

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

        const left = CONFIG.GLYPH_POS_MIN + Math.random() * CONFIG.GLYPH_POS_RANGE;
        const top = CONFIG.GLYPH_POS_MIN + Math.random() * CONFIG.GLYPH_POS_RANGE;
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
        state.currentGlyphIndex = chosen.id;
        btn.classList.add("has-card");

        if (state.selectedGlyphCards.length === 1 && answerSection) {
          const hasPrintedCards = responseTextEl && responseTextEl.innerHTML.includes("resetario-output-hash");
          if (!hasPrintedCards) answerSection.classList.remove("is-full");
          answerSection.hidden = false;
          if (responseTextEl && !responseTextEl.innerHTML.includes("resetario-output-footer-peek")) {
            responseTextEl.insertAdjacentHTML('afterbegin', `<div class="resetario-peek-only" style="width: 100%; max-width: 640px; margin: 0 auto;"><div class="resetario-output-footer resetario-output-footer-peek"><span class="resetario-output-peek-arrow" aria-hidden="true">▾</span></div></div>`);
          }
        }

        renderSelectedGlyphCards();
      });
    });
  }

  const dimensionButtons = document.querySelectorAll(".tp7-dimension-button");
  if (dimensionButtons && dimensionButtons.length > 0) {
    dimensionButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.isOutputMode) return;
        const dimensionValue = btn.dataset.dimension;
        const dimensionCheckboxes = form.querySelectorAll('input[name="dimension"]');
        const targetCheckbox = Array.from(dimensionCheckboxes).find(
          (cb) => cb.value === dimensionValue
        );
        if (targetCheckbox) {
          playDimensionSound(dimensionValue);
          targetCheckbox.checked = !targetCheckbox.checked;
          targetCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          btn.classList.toggle('active', targetCheckbox.checked);

          const hasAnyDimension = Array.from(dimensionCheckboxes).some(cb => cb.checked);
          if (hasAnyDimension && answerSection) {
            const hasPrintedCards = responseTextEl && responseTextEl.innerHTML.includes("resetario-output-hash");
            if (!hasPrintedCards) answerSection.classList.remove("is-full");
            answerSection.hidden = false;
            if (responseTextEl && !responseTextEl.innerHTML.includes("resetario-output-footer-peek")) {
              responseTextEl.insertAdjacentHTML('afterbegin', `<div class="resetario-peek-only" style="width: 100%; max-width: 640px; margin: 0 auto;"><div class="resetario-output-footer resetario-output-footer-peek"><span class="resetario-output-peek-arrow" aria-hidden="true">▾</span></div></div>`);
            }
          }
        }
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
      setStatus("Selecciona al menos una dimensi\u00f3n");
      return;
    }

    playSubmitSound();
    setFormBusy(true);
    state.currentDimensions = selectedDimensions;

    if (ioInput) ioInput.classList.remove("is-on");
    if (ioOutput) ioOutput.classList.add("is-on");

    state.isOutputMode = true;

    const prompt = buildPrompt(selectedDimensions, state.selectedGlyphCards);

    setStatus("Consultando ... espere");
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
      const hasPrintedCards = responseTextEl && responseTextEl.innerHTML.includes("resetario-output-hash");
      if (!hasPrintedCards) answerSection.classList.remove("is-full");
    }
    if (answerTitleEl) {
      answerTitleEl.hidden = false;
    }
    
    // Maintain peek arrow instead of clearing
    if (responseTextEl && !responseTextEl.innerHTML.includes("resetario-output-footer-peek")) {
      responseTextEl.insertAdjacentHTML('afterbegin', `<div class="resetario-peek-only" style="width: 100%; max-width: 640px; margin: 0 auto;"><div class="resetario-output-footer resetario-output-footer-peek"><span class="resetario-output-peek-arrow" aria-hidden="true">▾</span></div></div>`);
    }

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
        setStatus(message);
        setFormBusy(false);
        state.isOutputMode = false;
        return;
      }

      const data = await response.json();
      const text = (data && data.text) || "No he podido generar una respuesta \u00fatil.";

      setStatus("");
      await loadCardsData();
      const cardInfo = resolveCardInfo();

      if (answerSection) {
        answerSection.classList.add("is-full");
      }
      const hash = renderResetarioOutput({ text, cardInfo, loading: false });

      // Guardar reset en Firestore
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

      // Si la impresora está conectada, imprimir el resultado automáticamente
      if (printerService.isConnected()) {
        try {
          const now = new Date();
          const dateStr = now.toLocaleDateString();
          const timeStr = now.toLocaleTimeString();

          const builder = new ReceiptBuilder();
          builder.init()
            .alignCenter()
            .size(true)
            .text("APICCA").newline()
            .size(false)
            .bold(true).text("Re(s)etario v.0.3").bold(false).newline()
            .text(`${dateStr} ${timeStr}`).newline()
            .separator()
            .alignLeft()
            .bold(true).text("Tácticas:").bold(false).newline();

          const tactics = state.selectedGlyphCards.slice(0, CONFIG.MAX_TACTICS);
          tactics.forEach(c => {
            const ejeLabel = c.ejeKey ? EJE_LABELS[c.ejeKey] || c.ejeKey : "Táctica";
            builder.text(`[${ejeLabel}] ${c.title}`).newline();
          });
          
          builder.separator()
            .bold(true).text("El Re(s)et:").bold(false).newline();

          // Print text with specific phrases in bold
          const printRichText = (str) => {
            const regex = /(1\.\s*Preparar?a?\s+presentes\s+alternativos|2\.\s*Servir\s+la\s+mesa\s+común)/gi;
            const parts = str.split(regex);
            parts.forEach(part => {
              if (part.match(regex)) {
                builder.newline().bold(true).text(part).bold(false);
              } else if (part) {
                builder.text(part);
              }
            });
            builder.newline();
          };
          
          printRichText(text);

          builder.separator()
            .bold(true).text("Dimensiones:").bold(false).newline()
            .text(state.currentDimensions.join(", ")).newline()
            .separator()
            .alignCenter()
            .text(`ID: ${hash}`).newline()
            .newline()
            .text("apicca.com").newline()
            .feed(2)
            .cut();

          const buffer = builder.build();
          state.lastPrintBuffer = buffer;
          
          if (ioPrintPill) ioPrintPill.classList.add("is-on");
          try {
            await printerService.sendData(buffer);
            // Mantener el LED encendido un poco más para que coincida con el tiempo físico de impresión
            await new Promise(r => setTimeout(r, 2000));
          } finally {
            if (ioPrintPill) ioPrintPill.classList.remove("is-on");
          }
        } catch (e) {
          console.error("Error al imprimir:", e);
        }
      }

      if (answerSection) {
        answerSection.hidden = false;
      }
      setFormBusy(false);
    } catch (err) {
      console.error("Error llamando al asistente del Re(s)etario:", err);
      setStatus(getErrorMessage(err, null));
      setFormBusy(false);
      state.isOutputMode = false;
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
    "a": "Tiempo",
    "A": "Tiempo",
    "b": "Espacio",
    "B": "Espacio",
    "c": "Informaci\u00f3n",
    "C": "Informaci\u00f3n",
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
      if (state.isOutputMode) return;
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
      if (state.isOutputMode) return;
      const dimensionValue = keyToDimension[event.key];
      const dimensionCheckboxes = form.querySelectorAll('input[name="dimension"]');
      const targetCheckbox = Array.from(dimensionCheckboxes).find(
        (cb) => cb.value === dimensionValue
      );
      if (targetCheckbox) {
        playDimensionSound(dimensionValue);
        targetCheckbox.checked = !targetCheckbox.checked;
        targetCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        const btn = Array.from(document.querySelectorAll(".tp7-dimension-button")).find(
          b => b.dataset.dimension === dimensionValue
        );
        if (btn) btn.classList.toggle('active', targetCheckbox.checked);

        const hasAnyDimension = Array.from(dimensionCheckboxes).some(cb => cb.checked);
        if (hasAnyDimension && answerSection) {
          const hasPrintedCards = responseTextEl && responseTextEl.innerHTML.includes("resetario-output-hash");
          if (!hasPrintedCards) answerSection.classList.remove("is-full");
          answerSection.hidden = false;
          if (responseTextEl && !responseTextEl.innerHTML.includes("resetario-output-footer-peek")) {
            responseTextEl.insertAdjacentHTML('afterbegin', `<div class="resetario-peek-only" style="width: 100%; max-width: 640px; margin: 0 auto;"><div class="resetario-output-footer resetario-output-footer-peek"><span class="resetario-output-peek-arrow" aria-hidden="true">▾</span></div></div>`);
          }
        }
      }
    }
  });
});
