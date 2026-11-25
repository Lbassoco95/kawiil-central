// Qué significan «Pausado» y «Solo lectura»: qué hace valer Kawiil y qué depende de la VM `kawiil-agents`. La pantalla no promete más de lo que se cumple.
// Lo de Kawiil es lo que hacen `dispatch-to-agent` y `agente-constructor` (supabase/functions) al publicarse; lo de la VM está en docs/agentes-vm-requisitos.md.
export type EstadoAclarable = "pausado" | "solo_lectura";
export interface Aclaracion { titulo: string; kawiil: string[]; vm: string[] }

export const ACLARACIONES: Record<EstadoAclarable, Aclaracion> = {
  pausado: {
    titulo: "Pausado",
    kawiil: ["Kawiil no le envía tareas nuevas: el servidor rechaza lo que se le mande desde el chat, la barra «¿Qué necesitas?», «Varios a la vez» y los seguimientos."],
    vm: ["Que no ejecute sus tareas programadas, las llamadas de otros agentes ni lo que ya estaba en curso al pausarlo.", "Que no borre la marca de pausa al registrarse."],
  },
  solo_lectura: {
    titulo: "Solo lectura",
    kawiil: ["Las tareas que se le mandan desde Kawiil no llevan accesos de 1Password ni permiso para escribir en sitios, aunque se marquen."],
    vm: ["Que no escriba ni use accesos por su cuenta, en tareas programadas ni en llamadas de otros agentes.", "Que respete la habilitación de una persona (`config.habilitado`)."],
  },
};
