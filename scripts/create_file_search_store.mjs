// scripts/create_file_search_store.mjs
// Crea un File Search Store en Gemini y sube un documento del Re(s)etario.
//
// Uso:
//   1) Exporta tu API key de Gemini:
//        export GEMINI_API_KEY="TU_API_KEY_DE_GEMINI"
//   2) Ejecuta:
//        node scripts/create_file_search_store.mjs
//
// Al final verás en consola el nombre interno del File Search Store
// (fileSearchStores/XXXXXXXX) para usarlo en FILE_SEARCH_STORE_NAME.

import process from "node:process";
import fs from "node:fs/promises";

const FILE_PATH = "docs/Resetario-manual.md"; // ajusta si quieres otro documento
const MIME_TYPE = "text/markdown";

async function crearStore(apiKey) {
  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/fileSearchStores" +
      `?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Re(s)etario APICCA",
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Error creando store (${resp.status}): ${text}`);
  }

  const json = await resp.json();
  return json;
}

async function uploadDocumento(apiKey, storeName, filePath) {
  const stat = await fs.stat(filePath);
  const numBytes = stat.size;
  const displayName = "Re(s)etario Propuesta Base";

  // Iniciar carga resumible
  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore` +
      `?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": MIME_TYPE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName,
      }),
    },
  );

  if (!startResp.ok) {
    const text = await startResp.text();
    throw new Error(`Error iniciando subida (${startResp.status}): ${text}`);
  }

  const uploadUrl = startResp.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("No se recibió x-goog-upload-url en la respuesta.");
  }

  // Subir bytes reales
  const fileBuffer = await fs.readFile(filePath);

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileBuffer,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Error subiendo archivo (${uploadResp.status}): ${text}`);
  }

  const json = await uploadResp.json();
  return json;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Falta GEMINI_API_KEY en el entorno.");
    process.exit(1);
  }

  // 1) Crear el File Search Store
  const fileSearchStore = await crearStore(apiKey);

  console.log("Store creado con nombre interno:");
  console.log(fileSearchStore.name); // ej: fileSearchStores/1234567890abcdef

  // 2) Subir un archivo al store (ajusta la ruta y nombre si quieres)
  console.log("Subiendo documento al store...");
  await uploadDocumento(apiKey, fileSearchStore.name, FILE_PATH);

  console.log("Documento indexado correctamente.");
  console.log("Usa este nombre en FILE_SEARCH_STORE_NAME:");
  console.log(fileSearchStore.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


