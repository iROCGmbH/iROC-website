/**
 * useDoctors — fetches the live certified-doctor list from the shared API.
 * Module-level singleton: one network request per page load, shared across all
 * consumers. The list is always fresh because it reads from the iROC GmbH
 * Website database, where new doctors are added by admins.
 */

export interface DoctorCertification {
  instrument: string;
  certifiedDate: string;
}

export interface Doctor {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  specialty: string | null;
  institutionName: string | null;
  city: string;
  postalCode: string | null;
  country: string;
  websiteUrl: string | null;
  lat: number | null;
  lon: number | null;
  certifications: DoctorCertification[];
}

let cache: Doctor[] | null = null;
let fetchPromise: Promise<Doctor[]> | null = null;

export async function fetchDoctors(): Promise<Doctor[]> {
  if (cache) return cache;
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch("/api/doctors?instrument=spirecut")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Doctor[]>;
    })
    .then((data) => {
      cache = data;
      return data;
    })
    .catch((err) => {
      fetchPromise = null;
      throw err;
    });

  return fetchPromise;
}

/** Invalidate cache — call after an admin saves new doctor data. */
export function invalidateDoctorsCache() {
  cache = null;
  fetchPromise = null;
}

import { useState, useEffect } from "react";

interface UseDoctorsResult {
  doctors: Doctor[];
  loading: boolean;
  error: string | null;
}

export function useDoctors(): UseDoctorsResult {
  const [doctors, setDoctors] = useState<Doctor[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) {
      setDoctors(cache);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDoctors()
      .then((data) => {
        if (!cancelled) {
          setDoctors(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("load_failed");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { doctors, loading, error };
}
