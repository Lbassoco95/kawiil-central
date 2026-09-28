/**
 * Portal del cliente — contrato del emisor de CFDI (M6).
 *
 * Solo factura de INGRESO. Sin nómina, honorarios, arrendamiento, complementos
 * de pago ni notas de crédito. Tres operaciones: validar, emitir y consultar
 * estado. Implementaciones: EmisorPrueba (no timbra nada) y
 * EmisorPacPlantilla (esqueleto para el PAC real que entregará Kawiil).
 */
export interface ConceptoBorrador {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  /** 01 = no objeto de impuesto; 02 = sí objeto. */
  objetoImp: "01" | "02";
  /** Tasa de IVA trasladado cuando objetoImp = 02. */
  ivaTasa?: 0.16 | 0.08 | 0;
}

export interface BorradorFactura {
  /** Lo arma el servidor desde el perfil fiscal verificado; nunca se toma del navegador. */
  emisor: { rfc: string; nombre: string; regimen: string; cp: string };
  receptor: { rfc: string; nombre: string; regimen: string; cp: string; uso: string; email?: string };
  formaPago: string;
  metodoPago: "PUE" | "PPD";
  moneda: "MXN";
  serie?: string;
  folio?: string;
  conceptos: ConceptoBorrador[];
}

export interface ContextoEmision {
  /** Metadatos del CSD vigente (nunca el cifrado). */
  csd: { serial: string | null; notBefore: string | null; notAfter: string | null; revoked: boolean } | null;
  ahora?: Date;
  /** Solo pruebas: sustituye la matriz régimen × uso cargada del catálogo. */
  matrizUsoRegimen?: { uso: string; regimenes: string[] }[];
}

export interface ErrorValidacion {
  campo: string;
  mensaje: string;
}

export interface Totales {
  subtotal: number;
  iva: number;
  total: number;
}

export interface ResultadoValidacion {
  ok: boolean;
  errores: ErrorValidacion[];
  totales: Totales;
}

export interface ResultadoEmision {
  uuid: string;
  xml: string;
  esPrueba: boolean;
  fechaTimbrado: string;
  totales: Totales;
}

export type EstadoCfdi = "prueba" | "vigente" | "cancelado" | "no_encontrado" | "desconocido";

export interface EmisorCfdi {
  readonly nombre: "prueba" | "pac";
  validar(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoValidacion>;
  emitir(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoEmision>;
  consultarEstado(uuid: string): Promise<EstadoCfdi>;
}

export class EmisionRechazada extends Error {
  constructor(public readonly errores: ErrorValidacion[]) {
    super("La factura no pasó las validaciones.");
  }
}

export class PacNoConfigurado extends Error {
  constructor() {
    super("El emisor real (PAC) no está configurado. La emisión real queda apagada hasta que Kawiil entregue el PAC.");
  }
}
