// «hace 42 s», «hace 3 min»: cuánto pasó desde la última lectura de datos de los agentes.
export const haceTexto = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 5 ? "ahora" : s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
};
