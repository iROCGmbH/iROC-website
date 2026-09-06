/** Shared nearby-doctor search behavior for the web and native patient apps. */

export const DOCTOR_RADIUS_OPTIONS = [10, 20, 50, 100, 200] as const;
export type DoctorRadiusKm = (typeof DOCTOR_RADIUS_OPTIONS)[number];

export interface GeoCoordinates {
  lat: number;
  lon: number;
}

export interface DoctorWithCoordinates {
  lat?: number | null;
  lon?: number | null;
}

export function hasUsableDoctorCoordinates(
  doctor: DoctorWithCoordinates,
): doctor is DoctorWithCoordinates & { lat: number; lon: number } {
  return (
    doctor.lat != null &&
    doctor.lon != null &&
    Number.isFinite(doctor.lat) &&
    Number.isFinite(doctor.lon) &&
    doctor.lat >= -90 &&
    doctor.lat <= 90 &&
    doctor.lon >= -180 &&
    doctor.lon <= 180
  );
}

export interface DoctorWithDistance<T> {
  doctor: T;
  distanceKm: number;
}

export interface DoctorWithOptionalDistance<T> {
  doctor: T;
  distanceKm?: number;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterDoctorsByRadius<T extends DoctorWithCoordinates>(
  doctors: T[],
  origin: GeoCoordinates,
  radiusKm: DoctorRadiusKm,
): DoctorWithDistance<T>[];
export function filterDoctorsByRadius<T extends DoctorWithCoordinates>(
  doctors: T[],
  origin: GeoCoordinates,
  radiusKm: null,
): DoctorWithOptionalDistance<T>[];
export function filterDoctorsByRadius<T extends DoctorWithCoordinates>(
  doctors: T[],
  origin: GeoCoordinates,
  radiusKm: DoctorRadiusKm | null,
): Array<DoctorWithDistance<T> | DoctorWithOptionalDistance<T>> {
  const withDistance = doctors.map((doctor) => {
    const distanceKm =
      hasUsableDoctorCoordinates(doctor)
        ? haversineKm(origin.lat, origin.lon, doctor.lat, doctor.lon)
        : undefined;
    return { doctor, distanceKm };
  });

  const matching = withDistance.filter(
    ({ distanceKm }) =>
      radiusKm == null || (distanceKm != null && distanceKm <= radiusKm),
  );

  matching.sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm != null) return -1;
    if (b.distanceKm != null) return 1;
    return 0;
  });

  return matching;
}