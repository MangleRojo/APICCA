// Módulo compartido de conexión a Firebase Firestore
// Usa los CDN de Firebase para evitar bundling

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  where,
  setDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore-lite.js";

// Configuración del proyecto Firebase.
// Obtener desde: Firebase Console → Project Settings → General → Your apps → Web app
// NOTA: estas claves son públicas y seguras para exponer en el frontend.
const firebaseConfig = {
  apiKey: "AIzaSyAAGwBUZYaWJTDfOPye_1vj2qWmnQBPcYY",
  authDomain: "apicca-com.firebaseapp.com",
  databaseURL: "https://apicca-com-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "apicca-com",
  storageBucket: "apicca-com.firebasestorage.app",
  messagingSenderId: "685545637551",
  appId: "1:685545637551:web:af9e92562e8264a126f65a",
  measurementId: "G-15T2DS80NV"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export async function getApices(ejeFilter) {
  const col = collection(db, "apices");
  let q;
  if (ejeFilter && ejeFilter !== "all") {
    q = query(col, where("eje", "==", ejeFilter));
  } else {
    q = query(col);
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Guarda un reset en la colección 'resets' usando el hash como ID.
 * @param {Object} resetData - Datos del reset (hash, text, tactics, dimensions, etc.)
 */
export async function saveReset(resetData) {
  if (!resetData || !resetData.hash) {
    console.warn("No se puede guardar el reset: falta hash o datos.");
    return;
  }
  
  try {
    const docRef = doc(db, "resets", resetData.hash);
    await setDoc(docRef, {
      ...resetData,
      createdAt: new Date().toISOString(),
    });
    console.log(`Reset guardado exitosamente en Firestore: ${resetData.hash}`);
  } catch (e) {
    console.error("Error al guardar el reset en Firestore:", e);
  }
}
