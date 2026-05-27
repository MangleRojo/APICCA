// Visualizacion isometrica Farm Game para la pagina API
// Renderiza Apices como cubos 3D en una grilla isometrica

import { getApices } from "./firebase-client.js";

// === Constantes de la grilla isometrica ===
const TILE_W = 64;
const TILE_H = 32;
const CUBE_HEIGHT = 40;
const GRID_COLS = 8;
const GRID_ROWS = 6;
const PADDING_TOP = 80;

const EJE_COLORS = {
  agua:          { top: "#6db8ff", left: "#4598ff", right: "#2d78d5" },
  alimento:      { top: "#33e8a0", left: "#00d084", right: "#00a869" },
  cobijo:        { top: "#ff7d4d", left: "#F05A24", right: "#c44a1c" },
  energia:       { top: "#ff4d4d", left: "#fd0202", right: "#c40000" },
  comunicacion:  { top: "#ff9560", left: "#ff6b35", right: "#d5551c" },
};

const STATE_OPACITY = {
  activo: 1.0,
  prototipo: 0.7,
  concepto: 0.35,
};

// === Utilidades isometricas ===
function toIso(gx, gy, originX, originY) {
  const sx = originX + (gx - gy) * (TILE_W / 2);
  const sy = originY + (gx + gy) * (TILE_H / 2);
  return { x: sx, y: sy };
}

function fromIso(sx, sy, originX, originY) {
  const dx = sx - originX;
  const dy = sy - originY;
  const gx = (dx / (TILE_W / 2) + dy / (TILE_H / 2)) / 2;
  const gy = (dy / (TILE_H / 2) - dx / (TILE_W / 2)) / 2;
  return { gx: Math.round(gx), gy: Math.round(gy) };
}

// === Dibujo de cubo isometrico ===
function drawCube(ctx, sx, sy, colors, alpha, label) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const ch = CUBE_HEIGHT;

  // Cara superior (rombo)
  ctx.beginPath();
  ctx.moveTo(sx, sy - ch);
  ctx.lineTo(sx + hw, sy + hh - ch);
  ctx.lineTo(sx, sy + TILE_H - ch);
  ctx.lineTo(sx - hw, sy + hh - ch);
  ctx.closePath();
  ctx.fillStyle = colors.top;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cara izquierda
  ctx.beginPath();
  ctx.moveTo(sx - hw, sy + hh - ch);
  ctx.lineTo(sx, sy + TILE_H - ch);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = colors.left;
  ctx.fill();
  ctx.stroke();

  // Cara derecha
  ctx.beginPath();
  ctx.moveTo(sx + hw, sy + hh - ch);
  ctx.lineTo(sx, sy + TILE_H - ch);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = colors.right;
  ctx.fill();
  ctx.stroke();

  // Label en la cara superior
  if (label) {
    ctx.globalAlpha = Math.min(alpha, 0.9);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = hw * 1.4;
    const displayLabel = label.length > 10 ? label.slice(0, 9) + "\u2026" : label;
    ctx.fillText(displayLabel, sx, sy + hh - ch, maxWidth);
  }

  ctx.restore();
}

// === Dibujar grilla base ===
function drawGrid(ctx, originX, originY) {
  ctx.save();
  ctx.strokeStyle = "rgba(26, 67, 50, 0.12)";
  ctx.lineWidth = 1;

  for (let gx = 0; gx < GRID_COLS; gx++) {
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      const { x: sx, y: sy } = toIso(gx, gy, originX, originY);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.lineTo(sx, sy + TILE_H);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// === Datos de fallback (cuando Firestore no tiene datos o no esta configurado) ===
const FALLBACK_APICES = [
  { id: "demo-1", nombre: "Filtro Comunitario", eje: "agua", estado: "activo", posX: 1, posY: 1, glyphId: 1 },
  { id: "demo-2", nombre: "Huerta Vertical", eje: "alimento", estado: "activo", posX: 3, posY: 1, glyphId: 2 },
  { id: "demo-3", nombre: "Techo Solar", eje: "cobijo", estado: "prototipo", posX: 2, posY: 3, glyphId: 3 },
  { id: "demo-4", nombre: "Panel Vecinal", eje: "energia", estado: "prototipo", posX: 5, posY: 2, glyphId: 10 },
  { id: "demo-5", nombre: "Radio Barrial", eje: "comunicacion", estado: "concepto", posX: 4, posY: 4, glyphId: 4 },
  { id: "demo-6", nombre: "Cisterna Lluvia", eje: "agua", estado: "concepto", posX: 6, posY: 1, glyphId: 22 },
  { id: "demo-7", nombre: "Compostera", eje: "alimento", estado: "activo", posX: 0, posY: 3, glyphId: 25 },
  { id: "demo-8", nombre: "Antena Mesh", eje: "comunicacion", estado: "activo", posX: 5, posY: 4, glyphId: 23 },
];

// === App principal ===
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("api-farm-canvas");
  const detailPanel = document.getElementById("api-detail");
  const detailContent = document.getElementById("api-detail-content");
  const detailClose = document.getElementById("api-detail-close");
  const filtersContainer = document.getElementById("api-filters");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let apices = [];
  let filteredApices = [];
  let currentFilter = "all";
  let hoveredApice = null;
  let animFrame = null;
  let pulseTime = 0;

  function getOrigin() {
    return {
      x: canvas.width / (2 * (window.devicePixelRatio || 1)),
      y: PADDING_TOP,
    };
  }

  function resizeCanvas() {
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    pulseTime += 0.02;
    const { width, height } = canvas;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, width / dpr, height / dpr);

    const origin = getOrigin();
    drawGrid(ctx, origin.x, origin.y);

    // Ordenar para pintar de atras hacia adelante (painters algorithm)
    const sorted = [...filteredApices].sort((a, b) => {
      const sa = (a.posX || 0) + (a.posY || 0);
      const sb = (b.posX || 0) + (b.posY || 0);
      return sa - sb;
    });

    for (const apice of sorted) {
      const gx = apice.posX || 0;
      const gy = apice.posY || 0;
      const { x: sx, y: sy } = toIso(gx, gy, origin.x, origin.y);

      const colors = EJE_COLORS[apice.eje] || EJE_COLORS.agua;
      let alpha = STATE_OPACITY[apice.estado] || 0.5;

      // Pulso sutil para apices activos
      if (apice.estado === "activo") {
        alpha = alpha - 0.05 * Math.sin(pulseTime + gx + gy);
      }

      // Highlight hover
      const isHovered = hoveredApice && hoveredApice.id === apice.id;
      if (isHovered) {
        alpha = Math.min(1, alpha + 0.2);
      }

      drawCube(ctx, sx, sy, colors, alpha, apice.nombre);

      // Hover outline
      if (isHovered) {
        ctx.save();
        ctx.strokeStyle = "#F05A24";
        ctx.lineWidth = 2;
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - CUBE_HEIGHT);
        ctx.lineTo(sx + hw, sy + hh - CUBE_HEIGHT);
        ctx.lineTo(sx + hw, sy + hh);
        ctx.lineTo(sx, sy + TILE_H);
        ctx.lineTo(sx - hw, sy + hh);
        ctx.lineTo(sx - hw, sy + hh - CUBE_HEIGHT);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }

    animFrame = requestAnimationFrame(render);
  }

  function hitTest(mouseX, mouseY) {
    const origin = getOrigin();
    let closest = null;
    let closestDist = Infinity;

    for (const apice of filteredApices) {
      const gx = apice.posX || 0;
      const gy = apice.posY || 0;
      const { x: sx, y: sy } = toIso(gx, gy, origin.x, origin.y);
      const centerY = sy + TILE_H / 2 - CUBE_HEIGHT / 2;
      const dx = mouseX - sx;
      const dy = mouseY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < TILE_W / 2 && dist < closestDist) {
        closest = apice;
        closestDist = dist;
      }
    }
    return closest;
  }

  function showDetail(apice) {
    const ejeLabel = {
      agua: "Agua", alimento: "Alimento", cobijo: "Cobijo",
      energia: "Energia", comunicacion: "Comunicacion",
    };
    const estadoLabel = {
      activo: "Activo", prototipo: "Prototipo", concepto: "Concepto",
    };

    detailContent.innerHTML = `
      <h3 class="detail-title">${apice.nombre}</h3>
      <div class="detail-badges">
        <span class="eje-badge eje-badge-${apice.eje}">${ejeLabel[apice.eje] || apice.eje}</span>
        <span class="estado-badge estado-${apice.estado}">${estadoLabel[apice.estado] || apice.estado}</span>
      </div>
      <p class="detail-desc">${apice.descripcion || "Sin descripcion disponible."}</p>
      ${apice.fechaCreacion ? `<p class="detail-date">Creado: ${apice.fechaCreacion}</p>` : ""}
    `;
    detailPanel.hidden = false;
  }

  // === Event listeners ===
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoveredApice = hitTest(mx, my);
    canvas.style.cursor = hoveredApice ? "pointer" : "default";
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const apice = hitTest(mx, my);
    if (apice) {
      showDetail(apice);
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredApice = null;
  });

  if (detailClose) {
    detailClose.addEventListener("click", () => {
      detailPanel.hidden = true;
    });
  }

  // Filtros
  if (filtersContainer) {
    filtersContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;

      filtersContainer.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      currentFilter = btn.dataset.filter;
      filteredApices = currentFilter === "all"
        ? [...apices]
        : apices.filter((a) => a.eje === currentFilter);
    });
  }

  window.addEventListener("resize", resizeCanvas);

  // === Init ===
  async function init() {
    resizeCanvas();

    try {
      const data = await getApices();
      apices = data.length ? data : FALLBACK_APICES;
    } catch (err) {
      console.warn("Firestore no disponible, usando datos de ejemplo:", err.message);
      apices = FALLBACK_APICES;
    }

    filteredApices = [...apices];
    render();
  }

  init();
});
