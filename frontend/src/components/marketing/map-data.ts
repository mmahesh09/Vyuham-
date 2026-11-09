import type { Marker } from "@/components/ui/dotted-map";

/* Sample data: where a small agency's revenue comes from. Shares add up to 100. */
export type CityMarker = Marker & { city: string; share: number; label?: boolean };

export const CITIES: CityMarker[] = [
  { city: "Mumbai", lat: 19.08, lng: 72.88, size: 1.5, share: 24, label: true },
  { city: "Bengaluru", lat: 12.97, lng: 77.59, size: 1.25, share: 17 },
  { city: "London", lat: 51.51, lng: -0.13, size: 1.1, share: 14, label: true },
  { city: "Dubai", lat: 25.2, lng: 55.27, size: 0.9, share: 11 },
  { city: "New York", lat: 40.71, lng: -74.0, size: 0.95, share: 12, label: true },
  { city: "Singapore", lat: 1.35, lng: 103.82, size: 0.75, share: 8 },
  { city: "Berlin", lat: 52.52, lng: 13.4, size: 0.6, share: 6 },
  { city: "Sydney", lat: -33.87, lng: 151.21, size: 0.55, share: 5 },
  { city: "Austin", lat: 30.27, lng: -97.74, size: 0.5, share: 3 },
];
