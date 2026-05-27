/**
 * Deploy update: 2026-04-08 (v2)
 */
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Inicializar Admin SDK una sola vez (necesario para verificar tokens de App Check).
if (!admin.apps.length) admin.initializeApp();

// Secrets gestionados por Firebase (en producción se leen desde Secret Manager;
// en el emulador se cargan automáticamente desde .env).
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const fileSearchStoreName = defineSecret("FILE_SEARCH_STORE_NAME");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container,
// so this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

/**
 * Función HTTP que actúa como proxy seguro hacia la API de Google Gemini.
 *
 * Lee la API key desde process.env.GEMINI_API_KEY (configurada vía dotenv /
 * Firebase), recibe un JSON { prompt: string } desde el frontend y devuelve
 * { text: string }.
 *
 * Más adelante podemos extender esta misma función para usar File Search,
 * añadiendo la configuración de tools.fileSearch según la guía oficial:
 * https://ai.google.dev/gemini-api/docs/file-search#javascript
 */
exports.callGemini = onRequest(
    {cors: true, secrets: [geminiApiKey, fileSearchStoreName]},
    async (req, res) => {
      // App Check: verificar token cuando ENFORCE_APP_CHECK=true.
      // Para activar: firebase functions:config:set appcheck.enforce=true
      // y habilitar App Check en Firebase Console → App Check.
      if (process.env.ENFORCE_APP_CHECK === "true") {
        const appCheckToken = req.header("X-Firebase-AppCheck");
        if (!appCheckToken) {
          return res.status(401).json({error: "App Check token ausente."});
        }
        try {
          await admin.appCheck().verifyToken(appCheckToken);
        } catch (err) {
          logger.warn("App Check token inválido", err.message);
          return res.status(401).json({error: "App Check token inválido."});
        }
      }

      // Permitir solo POST para mantener la API simple.
      if (req.method !== "POST") {
        return res.status(405).json({error: "Method not allowed. Use POST."});
      }

      const apiKey = geminiApiKey.value().replace(/"/g, "").trim();
      if (!apiKey) {
        logger.error("GEMINI_API_KEY no está definida en secrets.");
        return res.status(500).json({
          error: "Configuración del servidor incompleta: " +
        "falta GEMINI_API_KEY.",
        });
      }

      const storeName = fileSearchStoreName.value().replace(/"/g, "").trim();
      if (!storeName) {
        logger.error("FILE_SEARCH_STORE_NAME no está definida en secrets.");
        return res.status(500).json({
          error: "Configuración del servidor incompleta: " +
        "falta FILE_SEARCH_STORE_NAME.",
        });
      }

      const {prompt: rawPrompt} = req.body || {};
      if (typeof rawPrompt !== "string" || rawPrompt.trim().length === 0) {
        return res.status(400).json({
          error: "El cuerpo de la petición debe incluir un campo 'prompt' de " +
        "tipo string.",
        });
      }

      const MAX_PROMPT_LENGTH = 2000;
      if (rawPrompt.length > MAX_PROMPT_LENGTH) {
        return res.status(400).json({
          error: "El prompt excede el límite de " +
        MAX_PROMPT_LENGTH + " caracteres.",
        });
      }

      // Sanitizar: eliminar etiquetas HTML del prompt
      const prompt = rawPrompt.replace(/<[^>]*>/g, "").trim();

      // Modelo por defecto; se puede ajustar sin cambiar el frontend.
      const model = "gemini-2.5-pro";

      const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const systemTextLines = [
          "Eres experto en APICCA COMÚN y solo respondes temas " +
      "relacionados con las tácticas del Re(s)etario.",
          "Responde siempre en español latinoamericano, de forma clara " +
      "y breve, usando un máximo de 80 palabras.",
          "Responde siempre con un humor negro " +
      "que recuerda al de Terry Pratchett.",
          "Nunca utilices modismos.",
          "Se SIEMPRE positivo, nunca negativo.",
          "No utilices markdown en tus respuestas, utiliza siempre " +
      "etiquetas html.",
          "Usa los documentos del File Search Store del Re(s)etario " +
      "como fuente principal de información.",
          "La respuesta la debes estructurar como si fuera una receta de " +
      "cocina que utiliza como ingredientes a las tácticas.",
          "Estructura SIEMPRE tu respuesta en dos secciones, en este orden:",
          "<h4>1. Preparar presentes alternativos.</h4>",
          "<h4>2. Servir la mesa común.</h4>",
        ];

        const payload = {
          systemInstruction: {
            role: "system",
            parts: [
              {
                text: systemTextLines.join(" "),
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                "Pregunta del usuario sobre el Re(s)etario de APICCA:\n" +
                prompt,
                },
              ],
            },
          ],
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [storeName],
              },
            },
          ],
          // En el futuro, aquí podremos añadir más herramientas o
          // configuración.
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Error de Gemini API", {
            status: response.status,
            body: errorText,
          });
          return res.status(502).json({
            error: "La API de Gemini devolvió un error.",
            status: response.status,
          });
        }

        const data = await response.json();
        const candidate = data.candidates && data.candidates[0];
        const parts = candidate && candidate.content && candidate.content.parts;

        const text = parts && parts.length ?
      parts.map((p) => p.text || "").join("\n").trim() :
      "";

        if (!text) {
          logger.warn("Respuesta de Gemini sin texto utilizable.", {data});
          return res.status(200).json({
            text: "No he podido generar una respuesta útil en este momento.",
          });
        }

        return res.status(200).json({text});
      } catch (err) {
        logger.error("Error al llamar a la API de Gemini", err);
        return res.status(500).json({
          error: "Error interno al consultar la API de Gemini.",
        });
      }
    });

