/** Exportación de datos de RH a Excel (SheetJS, carga dinámica). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function downloadSheets(sheets: { name: string; rows: Row[] }[], fileName: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

export async function exportExpedientesXlsx(rows: Row[]) {
  const date = new Date().toISOString().slice(0, 10);
  await downloadSheets([{ name: "Expedientes", rows }], `expedientes_${date}.xlsx`);
}

export async function exportResultadosXlsx(resumen: Row[], categorias: Row[]) {
  const date = new Date().toISOString().slice(0, 10);
  await downloadSheets(
    [
      { name: "Resumen", rows: resumen },
      { name: "Por categoría", rows: categorias },
    ],
    `resultados_rh_${date}.xlsx`,
  );
}
