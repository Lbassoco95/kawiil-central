import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kawiil-sb-tz";

export type TimezoneEntry = {
  /** IANA timezone, e.g. "America/Los_Angeles" */
  zone: string;
  /** Short label shown in the chip, e.g. "CDMX" — used as unique identifier */
  code: string;
  /** Full city name shown in the picker, e.g. "Ciudad de México" */
  city?: string;
  /** Country name, e.g. "México" */
  country?: string;
  /** Optional flag emoji */
  flag?: string;
};

export type TimezoneCountry = {
  country: string;
  flag: string;
  cities: TimezoneEntry[];
};

/**
 * Curated list of countries → important cities.
 * Multiple cities can share the same IANA `zone` (e.g. CDMX, GDL, MTY all use
 * America/Mexico_City). The unique identifier is `code`, not `zone`.
 */
export const TIMEZONE_COUNTRIES: TimezoneCountry[] = [
  {
    country: "México",
    flag: "🇲🇽",
    cities: [
      { code: "CDMX", city: "Ciudad de México", zone: "America/Mexico_City", country: "México", flag: "🇲🇽" },
      { code: "GDL", city: "Guadalajara", zone: "America/Mexico_City", country: "México", flag: "🇲🇽" },
      { code: "MTY", city: "Monterrey", zone: "America/Monterrey", country: "México", flag: "🇲🇽" },
      { code: "MID", city: "Mérida", zone: "America/Merida", country: "México", flag: "🇲🇽" },
      { code: "TIJ", city: "Tijuana", zone: "America/Tijuana", country: "México", flag: "🇲🇽" },
      { code: "CUN", city: "Cancún", zone: "America/Cancun", country: "México", flag: "🇲🇽" },
      { code: "HMO", city: "Hermosillo", zone: "America/Hermosillo", country: "México", flag: "🇲🇽" },
      { code: "CJS", city: "Ciudad Juárez", zone: "America/Ciudad_Juarez", country: "México", flag: "🇲🇽" },
      { code: "CUU", city: "Chihuahua", zone: "America/Chihuahua", country: "México", flag: "🇲🇽" },
      { code: "MZT", city: "Mazatlán", zone: "America/Mazatlan", country: "México", flag: "🇲🇽" },
      { code: "PVR", city: "Puerto Vallarta", zone: "America/Mexico_City", country: "México", flag: "🇲🇽" },
      { code: "SJD", city: "Los Cabos", zone: "America/Mazatlan", country: "México", flag: "🇲🇽" },
    ],
  },
  {
    country: "Estados Unidos",
    flag: "🇺🇸",
    cities: [
      { code: "SF", city: "San Francisco", zone: "America/Los_Angeles", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "LA", city: "Los Ángeles", zone: "America/Los_Angeles", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "SEA", city: "Seattle", zone: "America/Los_Angeles", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "LAS", city: "Las Vegas", zone: "America/Los_Angeles", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "DEN", city: "Denver", zone: "America/Denver", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "PHX", city: "Phoenix", zone: "America/Phoenix", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "CHI", city: "Chicago", zone: "America/Chicago", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "HOU", city: "Houston", zone: "America/Chicago", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "DFW", city: "Dallas", zone: "America/Chicago", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "NY", city: "Nueva York", zone: "America/New_York", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "MIA", city: "Miami", zone: "America/New_York", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "BOS", city: "Boston", zone: "America/New_York", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "ATL", city: "Atlanta", zone: "America/New_York", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "WAS", city: "Washington D.C.", zone: "America/New_York", country: "Estados Unidos", flag: "🇺🇸" },
      { code: "HNL", city: "Honolulu", zone: "Pacific/Honolulu", country: "Estados Unidos", flag: "🇺🇸" },
    ],
  },
  {
    country: "Canadá",
    flag: "🇨🇦",
    cities: [
      { code: "YVR", city: "Vancouver", zone: "America/Vancouver", country: "Canadá", flag: "🇨🇦" },
      { code: "YYC", city: "Calgary", zone: "America/Edmonton", country: "Canadá", flag: "🇨🇦" },
      { code: "YYZ", city: "Toronto", zone: "America/Toronto", country: "Canadá", flag: "🇨🇦" },
      { code: "YUL", city: "Montreal", zone: "America/Toronto", country: "Canadá", flag: "🇨🇦" },
    ],
  },
  {
    country: "Colombia",
    flag: "🇨🇴",
    cities: [
      { code: "BOG", city: "Bogotá", zone: "America/Bogota", country: "Colombia", flag: "🇨🇴" },
      { code: "MDE", city: "Medellín", zone: "America/Bogota", country: "Colombia", flag: "🇨🇴" },
      { code: "CTG", city: "Cartagena", zone: "America/Bogota", country: "Colombia", flag: "🇨🇴" },
      { code: "CLO", city: "Cali", zone: "America/Bogota", country: "Colombia", flag: "🇨🇴" },
    ],
  },
  {
    country: "Perú",
    flag: "🇵🇪",
    cities: [
      { code: "LIM", city: "Lima", zone: "America/Lima", country: "Perú", flag: "🇵🇪" },
      { code: "CUZ", city: "Cusco", zone: "America/Lima", country: "Perú", flag: "🇵🇪" },
    ],
  },
  {
    country: "Chile",
    flag: "🇨🇱",
    cities: [
      { code: "SCL", city: "Santiago", zone: "America/Santiago", country: "Chile", flag: "🇨🇱" },
    ],
  },
  {
    country: "Argentina",
    flag: "🇦🇷",
    cities: [
      { code: "BUE", city: "Buenos Aires", zone: "America/Argentina/Buenos_Aires", country: "Argentina", flag: "🇦🇷" },
      { code: "MDZ", city: "Mendoza", zone: "America/Argentina/Mendoza", country: "Argentina", flag: "🇦🇷" },
      { code: "COR", city: "Córdoba", zone: "America/Argentina/Cordoba", country: "Argentina", flag: "🇦🇷" },
    ],
  },
  {
    country: "Bolivia",
    flag: "🇧🇴",
    cities: [
      { code: "LPB", city: "La Paz", zone: "America/La_Paz", country: "Bolivia", flag: "🇧🇴" },
      { code: "SRZ", city: "Santa Cruz", zone: "America/La_Paz", country: "Bolivia", flag: "🇧🇴" },
      { code: "CBB", city: "Cochabamba", zone: "America/La_Paz", country: "Bolivia", flag: "🇧🇴" },
      { code: "SRE", city: "Sucre", zone: "America/La_Paz", country: "Bolivia", flag: "🇧🇴" },
    ],
  },
  {
    country: "Ecuador",
    flag: "🇪🇨",
    cities: [
      { code: "UIO", city: "Quito", zone: "America/Guayaquil", country: "Ecuador", flag: "🇪🇨" },
      { code: "GYE", city: "Guayaquil", zone: "America/Guayaquil", country: "Ecuador", flag: "🇪🇨" },
    ],
  },
  {
    country: "Paraguay",
    flag: "🇵🇾",
    cities: [
      { code: "ASU", city: "Asunción", zone: "America/Asuncion", country: "Paraguay", flag: "🇵🇾" },
    ],
  },
  {
    country: "Uruguay",
    flag: "🇺🇾",
    cities: [
      { code: "MVD", city: "Montevideo", zone: "America/Montevideo", country: "Uruguay", flag: "🇺🇾" },
    ],
  },
  {
    country: "Venezuela",
    flag: "🇻🇪",
    cities: [
      { code: "CCS", city: "Caracas", zone: "America/Caracas", country: "Venezuela", flag: "🇻🇪" },
    ],
  },
  {
    country: "República Dominicana",
    flag: "🇩🇴",
    cities: [
      { code: "SDQ", city: "Santo Domingo", zone: "America/Santo_Domingo", country: "República Dominicana", flag: "🇩🇴" },
    ],
  },
  {
    country: "Guatemala",
    flag: "🇬🇹",
    cities: [
      { code: "GUA", city: "Ciudad de Guatemala", zone: "America/Guatemala", country: "Guatemala", flag: "🇬🇹" },
    ],
  },
  {
    country: "Honduras",
    flag: "🇭🇳",
    cities: [
      { code: "TGU", city: "Tegucigalpa", zone: "America/Tegucigalpa", country: "Honduras", flag: "🇭🇳" },
    ],
  },
  {
    country: "El Salvador",
    flag: "🇸🇻",
    cities: [
      { code: "SAL", city: "San Salvador", zone: "America/El_Salvador", country: "El Salvador", flag: "🇸🇻" },
    ],
  },
  {
    country: "Nicaragua",
    flag: "🇳🇮",
    cities: [
      { code: "MGA", city: "Managua", zone: "America/Managua", country: "Nicaragua", flag: "🇳🇮" },
    ],
  },
  {
    country: "Cuba",
    flag: "🇨🇺",
    cities: [
      { code: "HAV", city: "La Habana", zone: "America/Havana", country: "Cuba", flag: "🇨🇺" },
    ],
  },
  {
    country: "Puerto Rico",
    flag: "🇵🇷",
    cities: [
      { code: "SJU", city: "San Juan", zone: "America/Puerto_Rico", country: "Puerto Rico", flag: "🇵🇷" },
    ],
  },
  {
    country: "Brasil",
    flag: "🇧🇷",
    cities: [
      { code: "GRU", city: "São Paulo", zone: "America/Sao_Paulo", country: "Brasil", flag: "🇧🇷" },
      { code: "RIO", city: "Río de Janeiro", zone: "America/Sao_Paulo", country: "Brasil", flag: "🇧🇷" },
      { code: "BSB", city: "Brasilia", zone: "America/Sao_Paulo", country: "Brasil", flag: "🇧🇷" },
    ],
  },
  {
    country: "Costa Rica",
    flag: "🇨🇷",
    cities: [
      { code: "SJO", city: "San José", zone: "America/Costa_Rica", country: "Costa Rica", flag: "🇨🇷" },
    ],
  },
  {
    country: "Panamá",
    flag: "🇵🇦",
    cities: [
      { code: "PTY", city: "Ciudad de Panamá", zone: "America/Panama", country: "Panamá", flag: "🇵🇦" },
    ],
  },
  {
    country: "España",
    flag: "🇪🇸",
    cities: [
      { code: "MAD", city: "Madrid", zone: "Europe/Madrid", country: "España", flag: "🇪🇸" },
      { code: "BCN", city: "Barcelona", zone: "Europe/Madrid", country: "España", flag: "🇪🇸" },
      { code: "VLC", city: "Valencia", zone: "Europe/Madrid", country: "España", flag: "🇪🇸" },
      { code: "SVQ", city: "Sevilla", zone: "Europe/Madrid", country: "España", flag: "🇪🇸" },
    ],
  },
  {
    country: "Reino Unido",
    flag: "🇬🇧",
    cities: [
      { code: "LON", city: "Londres", zone: "Europe/London", country: "Reino Unido", flag: "🇬🇧" },
      { code: "MAN", city: "Manchester", zone: "Europe/London", country: "Reino Unido", flag: "🇬🇧" },
    ],
  },
  {
    country: "Francia",
    flag: "🇫🇷",
    cities: [
      { code: "PAR", city: "París", zone: "Europe/Paris", country: "Francia", flag: "🇫🇷" },
      { code: "MRS", city: "Marsella", zone: "Europe/Paris", country: "Francia", flag: "🇫🇷" },
    ],
  },
  {
    country: "Alemania",
    flag: "🇩🇪",
    cities: [
      { code: "BER", city: "Berlín", zone: "Europe/Berlin", country: "Alemania", flag: "🇩🇪" },
      { code: "MUC", city: "Múnich", zone: "Europe/Berlin", country: "Alemania", flag: "🇩🇪" },
      { code: "FRA", city: "Frankfurt", zone: "Europe/Berlin", country: "Alemania", flag: "🇩🇪" },
    ],
  },
  {
    country: "Italia",
    flag: "🇮🇹",
    cities: [
      { code: "ROM", city: "Roma", zone: "Europe/Rome", country: "Italia", flag: "🇮🇹" },
      { code: "MIL", city: "Milán", zone: "Europe/Rome", country: "Italia", flag: "🇮🇹" },
    ],
  },
  {
    country: "Portugal",
    flag: "🇵🇹",
    cities: [
      { code: "LIS", city: "Lisboa", zone: "Europe/Lisbon", country: "Portugal", flag: "🇵🇹" },
    ],
  },
  {
    country: "Países Bajos",
    flag: "🇳🇱",
    cities: [
      { code: "AMS", city: "Ámsterdam", zone: "Europe/Amsterdam", country: "Países Bajos", flag: "🇳🇱" },
    ],
  },
  {
    country: "Suiza",
    flag: "🇨🇭",
    cities: [
      { code: "ZRH", city: "Zúrich", zone: "Europe/Zurich", country: "Suiza", flag: "🇨🇭" },
    ],
  },
  {
    country: "Suecia",
    flag: "🇸🇪",
    cities: [
      { code: "STO", city: "Estocolmo", zone: "Europe/Stockholm", country: "Suecia", flag: "🇸🇪" },
    ],
  },
  {
    country: "Noruega",
    flag: "🇳🇴",
    cities: [
      { code: "OSL", city: "Oslo", zone: "Europe/Oslo", country: "Noruega", flag: "🇳🇴" },
    ],
  },
  {
    country: "Dinamarca",
    flag: "🇩🇰",
    cities: [
      { code: "CPH", city: "Copenhague", zone: "Europe/Copenhagen", country: "Dinamarca", flag: "🇩🇰" },
    ],
  },
  {
    country: "Irlanda",
    flag: "🇮🇪",
    cities: [
      { code: "DUB", city: "Dublín", zone: "Europe/Dublin", country: "Irlanda", flag: "🇮🇪" },
    ],
  },
  {
    country: "Bélgica",
    flag: "🇧🇪",
    cities: [
      { code: "BRU", city: "Bruselas", zone: "Europe/Brussels", country: "Bélgica", flag: "🇧🇪" },
    ],
  },
  {
    country: "Austria",
    flag: "🇦🇹",
    cities: [
      { code: "VIE", city: "Viena", zone: "Europe/Vienna", country: "Austria", flag: "🇦🇹" },
    ],
  },
  {
    country: "Polonia",
    flag: "🇵🇱",
    cities: [
      { code: "WAW", city: "Varsovia", zone: "Europe/Warsaw", country: "Polonia", flag: "🇵🇱" },
    ],
  },
  {
    country: "Grecia",
    flag: "🇬🇷",
    cities: [
      { code: "ATH", city: "Atenas", zone: "Europe/Athens", country: "Grecia", flag: "🇬🇷" },
    ],
  },
  {
    country: "Rusia",
    flag: "🇷🇺",
    cities: [
      { code: "MOW", city: "Moscú", zone: "Europe/Moscow", country: "Rusia", flag: "🇷🇺" },
      { code: "LED", city: "San Petersburgo", zone: "Europe/Moscow", country: "Rusia", flag: "🇷🇺" },
      { code: "KGD", city: "Kaliningrado", zone: "Europe/Kaliningrad", country: "Rusia", flag: "🇷🇺" },
      { code: "SVX", city: "Ekaterimburgo", zone: "Asia/Yekaterinburg", country: "Rusia", flag: "🇷🇺" },
      { code: "OVB", city: "Novosibirsk", zone: "Asia/Novosibirsk", country: "Rusia", flag: "🇷🇺" },
      { code: "IKT", city: "Irkutsk", zone: "Asia/Irkutsk", country: "Rusia", flag: "🇷🇺" },
      { code: "VVO", city: "Vladivostok", zone: "Asia/Vladivostok", country: "Rusia", flag: "🇷🇺" },
    ],
  },
  {
    country: "Turquía",
    flag: "🇹🇷",
    cities: [
      { code: "IST", city: "Estambul", zone: "Europe/Istanbul", country: "Turquía", flag: "🇹🇷" },
      { code: "ESB", city: "Ankara", zone: "Europe/Istanbul", country: "Turquía", flag: "🇹🇷" },
    ],
  },
  {
    country: "Ucrania",
    flag: "🇺🇦",
    cities: [
      { code: "IEV", city: "Kiev", zone: "Europe/Kyiv", country: "Ucrania", flag: "🇺🇦" },
    ],
  },
  {
    country: "Egipto",
    flag: "🇪🇬",
    cities: [
      { code: "CAI", city: "El Cairo", zone: "Africa/Cairo", country: "Egipto", flag: "🇪🇬" },
    ],
  },
  {
    country: "Sudáfrica",
    flag: "🇿🇦",
    cities: [
      { code: "JNB", city: "Johannesburgo", zone: "Africa/Johannesburg", country: "Sudáfrica", flag: "🇿🇦" },
      { code: "CPT", city: "Ciudad del Cabo", zone: "Africa/Johannesburg", country: "Sudáfrica", flag: "🇿🇦" },
    ],
  },
  {
    country: "Marruecos",
    flag: "🇲🇦",
    cities: [
      { code: "CMN", city: "Casablanca", zone: "Africa/Casablanca", country: "Marruecos", flag: "🇲🇦" },
    ],
  },
  {
    country: "Nigeria",
    flag: "🇳🇬",
    cities: [
      { code: "LOS", city: "Lagos", zone: "Africa/Lagos", country: "Nigeria", flag: "🇳🇬" },
    ],
  },
  {
    country: "Arabia Saudita",
    flag: "🇸🇦",
    cities: [
      { code: "RUH", city: "Riad", zone: "Asia/Riyadh", country: "Arabia Saudita", flag: "🇸🇦" },
      { code: "JED", city: "Yeda", zone: "Asia/Riyadh", country: "Arabia Saudita", flag: "🇸🇦" },
    ],
  },
  {
    country: "Catar",
    flag: "🇶🇦",
    cities: [
      { code: "DOH", city: "Doha", zone: "Asia/Qatar", country: "Catar", flag: "🇶🇦" },
    ],
  },
  {
    country: "Tailandia",
    flag: "🇹🇭",
    cities: [
      { code: "BKK", city: "Bangkok", zone: "Asia/Bangkok", country: "Tailandia", flag: "🇹🇭" },
    ],
  },
  {
    country: "Vietnam",
    flag: "🇻🇳",
    cities: [
      { code: "SGN", city: "Ciudad Ho Chi Minh", zone: "Asia/Ho_Chi_Minh", country: "Vietnam", flag: "🇻🇳" },
      { code: "HAN", city: "Hanói", zone: "Asia/Ho_Chi_Minh", country: "Vietnam", flag: "🇻🇳" },
    ],
  },
  {
    country: "Indonesia",
    flag: "🇮🇩",
    cities: [
      { code: "CGK", city: "Yakarta", zone: "Asia/Jakarta", country: "Indonesia", flag: "🇮🇩" },
      { code: "DPS", city: "Bali", zone: "Asia/Makassar", country: "Indonesia", flag: "🇮🇩" },
    ],
  },
  {
    country: "Malasia",
    flag: "🇲🇾",
    cities: [
      { code: "KUL", city: "Kuala Lumpur", zone: "Asia/Kuala_Lumpur", country: "Malasia", flag: "🇲🇾" },
    ],
  },
  {
    country: "Filipinas",
    flag: "🇵🇭",
    cities: [
      { code: "MNL", city: "Manila", zone: "Asia/Manila", country: "Filipinas", flag: "🇵🇭" },
    ],
  },
  {
    country: "Taiwán",
    flag: "🇹🇼",
    cities: [
      { code: "TPE", city: "Taipéi", zone: "Asia/Taipei", country: "Taiwán", flag: "🇹🇼" },
    ],
  },
  {
    country: "Nueva Zelanda",
    flag: "🇳🇿",
    cities: [
      { code: "AKL", city: "Auckland", zone: "Pacific/Auckland", country: "Nueva Zelanda", flag: "🇳🇿" },
    ],
  },
  {
    country: "Japón",
    flag: "🇯🇵",
    cities: [
      { code: "TYO", city: "Tokio", zone: "Asia/Tokyo", country: "Japón", flag: "🇯🇵" },
      { code: "OSA", city: "Osaka", zone: "Asia/Tokyo", country: "Japón", flag: "🇯🇵" },
    ],
  },
  {
    country: "China",
    flag: "🇨🇳",
    cities: [
      { code: "SHA", city: "Shanghái", zone: "Asia/Shanghai", country: "China", flag: "🇨🇳" },
      { code: "PEK", city: "Pekín", zone: "Asia/Shanghai", country: "China", flag: "🇨🇳" },
    ],
  },
  {
    country: "Hong Kong",
    flag: "🇭🇰",
    cities: [
      { code: "HKG", city: "Hong Kong", zone: "Asia/Hong_Kong", country: "Hong Kong", flag: "🇭🇰" },
    ],
  },
  {
    country: "Singapur",
    flag: "🇸🇬",
    cities: [
      { code: "SIN", city: "Singapur", zone: "Asia/Singapore", country: "Singapur", flag: "🇸🇬" },
    ],
  },
  {
    country: "Corea del Sur",
    flag: "🇰🇷",
    cities: [
      { code: "ICN", city: "Seúl", zone: "Asia/Seoul", country: "Corea del Sur", flag: "🇰🇷" },
    ],
  },
  {
    country: "India",
    flag: "🇮🇳",
    cities: [
      { code: "DEL", city: "Nueva Delhi", zone: "Asia/Kolkata", country: "India", flag: "🇮🇳" },
      { code: "BOM", city: "Bombay", zone: "Asia/Kolkata", country: "India", flag: "🇮🇳" },
      { code: "BLR", city: "Bangalore", zone: "Asia/Kolkata", country: "India", flag: "🇮🇳" },
    ],
  },
  {
    country: "Emiratos Árabes Unidos",
    flag: "🇦🇪",
    cities: [
      { code: "DXB", city: "Dubái", zone: "Asia/Dubai", country: "Emiratos Árabes Unidos", flag: "🇦🇪" },
      { code: "AUH", city: "Abu Dabi", zone: "Asia/Dubai", country: "Emiratos Árabes Unidos", flag: "🇦🇪" },
    ],
  },
  {
    country: "Israel",
    flag: "🇮🇱",
    cities: [
      { code: "TLV", city: "Tel Aviv", zone: "Asia/Jerusalem", country: "Israel", flag: "🇮🇱" },
    ],
  },
  {
    country: "Australia",
    flag: "🇦🇺",
    cities: [
      { code: "SYD", city: "Sídney", zone: "Australia/Sydney", country: "Australia", flag: "🇦🇺" },
      { code: "MEL", city: "Melbourne", zone: "Australia/Melbourne", country: "Australia", flag: "🇦🇺" },
      { code: "PER", city: "Perth", zone: "Australia/Perth", country: "Australia", flag: "🇦🇺" },
    ],
  },
];

/** Flat list of all available city presets (kept for backwards compatibility). */
export const TIMEZONE_PRESETS: TimezoneEntry[] = TIMEZONE_COUNTRIES.flatMap(
  (c) => c.cities,
);

export const DEFAULT_TIMEZONES: TimezoneEntry[] = [
  TIMEZONE_PRESETS.find((p) => p.code === "CDMX")!,
  TIMEZONE_PRESETS.find((p) => p.code === "NY")!,
  TIMEZONE_PRESETS.find((p) => p.code === "MAD")!,
];

function readInitial(): TimezoneEntry[] {
  if (typeof window === "undefined") return DEFAULT_TIMEZONES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TIMEZONES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TIMEZONES;
    return parsed.filter(
      (p) => p && typeof p.zone === "string" && typeof p.code === "string",
    );
  } catch {
    return DEFAULT_TIMEZONES;
  }
}

export function useTimezones() {
  const [zones, setZonesState] = useState<TimezoneEntry[]>(readInitial);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setZonesState(readInitial());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: TimezoneEntry[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (entry: TimezoneEntry) => {
      setZonesState((prev) => {
        if (prev.some((z) => z.code === entry.code)) return prev;
        const next = [...prev, entry];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (code: string) => {
      setZonesState((prev) => {
        const next = prev.filter((z) => z.code !== code);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setZonesState(DEFAULT_TIMEZONES);
    persist(DEFAULT_TIMEZONES);
  }, [persist]);

  return { zones, add, remove, reset };
}

export function formatTimeInZone(date: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "—";
  }
}
