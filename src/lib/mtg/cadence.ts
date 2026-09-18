/** Debe coincidir con CHECK mtg_series.cadence en la migración. */
export const MTG_SERIES_CADENCE = ["weekly", "biweekly", "monthly", "adhoc"] as const;
export type MtgSeriesCadence = (typeof MTG_SERIES_CADENCE)[number];

export const MTG_CADENCE_LABEL: Record<MtgSeriesCadence, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  adhoc: "Ad hoc",
};
