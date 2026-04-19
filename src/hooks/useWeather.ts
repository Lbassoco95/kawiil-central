import { useQuery } from "@tanstack/react-query";

type Coords = { lat: number; lon: number };

export type WeatherData = {
  city: string;
  temp: number;
  unit: "°C";
  condition: string;
  code: number;
  isDay: boolean;
};

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Niebla",
  48: "Niebla con escarcha",
  51: "Llovizna ligera",
  53: "Llovizna",
  55: "Llovizna intensa",
  61: "Lluvia ligera",
  63: "Lluvia",
  65: "Lluvia fuerte",
  71: "Nieve ligera",
  73: "Nieve",
  75: "Nieve intensa",
  80: "Chubascos",
  81: "Chubascos fuertes",
  82: "Chubascos torrenciales",
  95: "Tormenta",
  96: "Tormenta con granizo",
  99: "Tormenta intensa",
};

function getCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation no disponible"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 8000, maximumAge: 60_000 * 30 },
    );
  });
}

async function reverseGeocode(coords: Coords): Promise<string> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.lat}&longitude=${coords.lon}&language=es&format=json`,
    );
    if (!res.ok) return "Mi ubicación";
    const j = await res.json();
    const r = j?.results?.[0];
    return r?.name || r?.admin1 || "Mi ubicación";
  } catch {
    return "Mi ubicación";
  }
}

async function fetchWeather(): Promise<WeatherData> {
  const coords = await getCoords();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`;
  const [city, weatherRes] = await Promise.all([reverseGeocode(coords), fetch(url)]);
  if (!weatherRes.ok) throw new Error("Open-Meteo error");
  const data = await weatherRes.json();
  const code = Number(data?.current?.weather_code ?? 0);
  return {
    city,
    temp: Math.round(Number(data?.current?.temperature_2m ?? 0)),
    unit: "°C",
    condition: WMO_DESCRIPTIONS[code] ?? "—",
    code,
    isDay: Number(data?.current?.is_day ?? 1) === 1,
  };
}

export function useWeather() {
  return useQuery({
    queryKey: ["sidebar-weather"],
    queryFn: fetchWeather,
    staleTime: 1000 * 60 * 10,
    refetchInterval: 1000 * 60 * 10,
    retry: 0,
  });
}
