// API helpers for Spirecut patient mobile app

import {
  DOCTOR_RADIUS_OPTIONS,
  filterDoctorsByRadius as sharedFilterDoctorsByRadius,
  haversineKm,
} from '@workspace/spirecut-shared';
import type {
  DoctorRadiusKm,
  DoctorWithDistance as SharedDoctorWithDistance,
  GeoCoordinates,
} from '@workspace/spirecut-shared';

export { DOCTOR_RADIUS_OPTIONS, haversineKm };
export type { DoctorRadiusKm, GeoCoordinates };

export const getApiBase = () =>
  `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DoctorCertification {
  instrument: string;
  certifiedDate: string;
}

export interface TrainedDoctor {
  id: number;
  title?: string | null;
  firstName: string;
  lastName: string;
  specialty?: string | null;
  institutionName?: string | null;
  city: string;
  postalCode?: string | null;
  country: string;
  websiteUrl?: string | null;
  lat?: number | null;
  lon?: number | null;
  certifications: DoctorCertification[];
}

export type DoctorWithDistance = SharedDoctorWithDistance<TrainedDoctor>;

export const filterDoctorsByRadius = (
  doctors: TrainedDoctor[],
  origin: GeoCoordinates,
  radiusKm: DoctorRadiusKm,
): DoctorWithDistance[] => sharedFilterDoctorsByRadius(doctors, origin, radiusKm);

export interface PostopStats {
  total: number;
  averageRating: number;
  ratingDistribution: Record<string, number>;
  byProcedure: Record<string, number>;
  quotes: Array<{ text: string; procedure: string; rating: number }>;
}

export interface PostopSubmission {
  procedure: string;
  operationMonth: string;
  rating: number;
  ageRange?: string | null;
  gender?: string | null;
  occupation?: string | null;
  diseases?: string[];
  experience?: string | null;
  shareQuote?: boolean;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const fetchDoctors = (): Promise<TrainedDoctor[]> =>
  apiFetch<TrainedDoctor[]>('/doctors?instrument=spirecut');

export const geocodePostal = (postal: string, country: string): Promise<GeoCoordinates> =>
  apiFetch<GeoCoordinates>(
    `/geocode-postal?postal=${encodeURIComponent(postal)}&country=${encodeURIComponent(country)}`,
  );

export const fetchPostopStats = (): Promise<PostopStats> =>
  apiFetch<PostopStats>('/patient-postop-stats');

export const submitPostop = (data: PostopSubmission): Promise<{ message: string }> =>
  apiFetch<{ message: string }>('/patient-postop', {
    method: 'POST',
    body: JSON.stringify(data),
  });
