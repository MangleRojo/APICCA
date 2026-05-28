const admin = require("firebase-admin");

async function main() {
  admin.initializeApp({
    projectId: "apicca-com"
  });
  const db = admin.firestore();
  console.log("Conectado a Firestore. Buscando registros...");

  // Consultar los registros cuyo 'text' coincide con la respuesta fallida
  const targetText = "No he podido generar una respuesta útil en este momento.";
  const snapshot = await db.collection("resets")
    .where("text", "==", targetText)
    .get();

  console.log(`Se encontraron ${snapshot.size} registros coincidentes.`);

  if (snapshot.size === 0) {
    console.log("No hay registros que requieran ser borrados.");
    process.exit(0);
  }

  // Listar los registros encontrados
  console.log("Detalles de los registros a eliminar:");
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`- ID: ${doc.id} | Creado: ${data.createdAt} | Dimensiones: ${JSON.stringify(data.dimensions)}`);
  });

  // Proceder a eliminarlos en lotes (batch)
  const batch = db.batch();
  snapshot.forEach(doc => {
    batch.delete(doc.ref);
  });

  console.log("Eliminando registros...");
  await batch.commit();
  console.log("¡Registros eliminados con éxito!");
  process.exit(0);
}

main().catch(err => {
  console.error("Error al ejecutar el script:", err);
  process.exit(1);
});
