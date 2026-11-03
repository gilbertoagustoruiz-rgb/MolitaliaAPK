import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../below-trade-panetones/src/App.tsx", import.meta.url), "utf8");

function check(label, condition) {
  assert.ok(condition, label);
  console.log("PASS:", label);
}

check("Botón manual visible en el listado compartido de Ventas y Marcaciones",
  app.includes('testId="button-manual-sync"') &&
  app.includes('module === "VENTAS"') &&
  app.includes('requestManualSync'));
check("Botón dispara solicitud y el sincronizador la escucha",
  app.includes('dispatchEvent(new Event("bt-manual-sync-request"))') &&
  app.includes('addEventListener("bt-manual-sync-request", onManualSync)'));
check("Finalización devuelve resultado a la interfaz",
  app.includes('new CustomEvent("bt-manual-sync-complete"') &&
  app.includes('addEventListener("bt-manual-sync-complete", completed)'));
check("Protección contra espera indefinida",
  app.includes('manualSyncTimer.current = window.setTimeout') &&
  app.includes('45_000') &&
  app.includes('setManualSyncBusy(false)'));
check("Reintento conserva el identificador de ventas y marcaciones",
  app.includes('syncOne({ sales: [sale] })') &&
  app.includes('syncOne({ attendance: [item] })') &&
  app.includes('serverSale.id === sale.id') &&
  app.includes('serverItem.id === item.id'));
check("No confirma ventas o marcaciones sin SINCRONIZADA",
  app.includes('confirmed.status !== "SINCRONIZADA"'));
// El contraste envía los IDs sincronizados y el servidor responde los faltantes
// (POST /app-storage/verify-ids), en vez de descargar la base completa.
check("Contraste de historial y límite de espera",
  app.includes('fetch(APP_STORAGE_VERIFY_IDS, {') &&
  app.includes('12_000') &&
  app.includes('payload.missing.sales.length') &&
  app.includes('payload.missing.attendance.length'));
check("Sin red conserva pendientes",
  app.includes('Sin conexión. Los registros pendientes se conservarán.'));
console.log("Contrato de sincronización manual aprobado (no sustituye prueba real de clic móvil).");
