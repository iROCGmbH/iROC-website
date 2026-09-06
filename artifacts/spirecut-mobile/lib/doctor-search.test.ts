import { describe, expect, it } from 'vitest';
import {
  DOCTOR_RADIUS_OPTIONS,
  filterDoctorsByRadius,
  type GeoCoordinates,
  type TrainedDoctor,
} from './api';

const EARTH_RADIUS_KM = 6371;
const origin: GeoCoordinates = { lat: 0, lon: 0 };

function longitudeForDistance(distanceKm: number): number {
  return (distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI);
}

function doctor(id: number, distanceKm?: number): TrainedDoctor {
  return {
    id,
    firstName: `Doctor ${id}`,
    lastName: 'Test',
    city: 'Test City',
    country: 'DE',
    certifications: [],
    ...(distanceKm == null
      ? {}
      : { lat: 0, lon: longitudeForDistance(distanceKm) }),
  };
}

describe('filterDoctorsByRadius', () => {
  it.each(DOCTOR_RADIUS_OPTIONS)(
    'includes doctors through the %s km boundary and omits those beyond it',
    (radiusKm) => {
      const results = filterDoctorsByRadius(
        [
          doctor(1, radiusKm + 0.1),
          doctor(2, radiusKm),
          doctor(3, radiusKm - 0.1),
          doctor(4),
        ],
        origin,
        radiusKm,
      );

      expect(results.map(({ doctor: result }) => result.id)).toEqual([3, 2]);
      expect(results.every(({ doctor: result }) => result.lat != null && result.lon != null)).toBe(true);
    },
  );

  it('orders matching doctors from nearest to farthest', () => {
    const results = filterDoctorsByRadius(
      [doctor(1, 18), doctor(2, 3), doctor(3, 11), doctor(4, 7)],
      origin,
      20,
    );

    expect(results.map(({ doctor: result }) => result.id)).toEqual([2, 4, 3, 1]);
    expect(results.map(({ distanceKm }) => distanceKm)).toEqual(
      expect.arrayContaining([
        expect.closeTo(3, 6),
        expect.closeTo(7, 6),
        expect.closeTo(11, 6),
        expect.closeTo(18, 6),
      ]),
    );
  });

  it('omits doctors with missing, non-finite, or out-of-range coordinates', () => {
    const results = filterDoctorsByRadius(
      [
        doctor(1, 5),
        { ...doctor(2), lat: null, lon: 0 },
        { ...doctor(3), lat: Number.NaN, lon: 0 },
        { ...doctor(4), lat: 91, lon: 0 },
        { ...doctor(5), lat: 0, lon: 181 },
      ],
      origin,
      20,
    );

    expect(results.map(({ doctor: result }) => result.id)).toEqual([1]);
  });
});