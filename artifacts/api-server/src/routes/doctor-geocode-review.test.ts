import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  doctor,
  mockGeocodeDoctorLocation,
  mockUpdate,
  mockSet,
} = vi.hoisted(() => ({
  doctor: {
    id: 17,
    title: "Dr.",
    firstName: "Anna",
    lastName: "Beispiel",
    specialty: "Orthopädie",
    institutionName: "Praxis Beispiel",
    city: "München",
    postalCode: "80331",
    country: "Deutschland",
    phone: null,
    email: "anna@example.com",
    websiteUrl: null,
    lat: null as number | null,
    lon: null as number | null,
  },
  mockGeocodeDoctorLocation: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("./admin-auth.js", () => ({
  requireAdmin: (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next(),
}));

vi.mock("../lib/geocode.js", () => ({
  geocodeDoctorLocation: mockGeocodeDoctorLocation,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_field: unknown, value: unknown) => ({ value })),
  desc: vi.fn(),
  isNotNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const where = vi.fn().mockResolvedValue([doctor]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  mockSet.mockImplementation((update: Record<string, unknown>) => ({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockImplementation(async () => {
        Object.assign(doctor, update);
        return [doctor];
      }),
    }),
  }));
  mockUpdate.mockReturnValue({ set: mockSet });

  return {
    db: {
      select,
      update: mockUpdate,
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { doctorId: doctor.id, instrument: "spirecut", certifiedDate: "2026-01-01" },
          ]),
        }),
      }),
    },
    pool: { query: vi.fn() },
    trainingDatesTable: {},
    trainedDoctorsTable: {
      id: "id",
      postalCode: "postalCode",
      city: "city",
      country: "country",
    },
    doctorCertificationsTable: { doctorId: "doctorId" },
    resourcesTable: {},
    settingsTable: {},
    trainingRegistrationsTable: {},
    websiteCustomersTable: {},
    irocInvoices: {},
  };
});

import adminRouter from "./admin";

const app = express();
app.use(express.json());
app.use(adminRouter);

const SAVE_BODY = {
  title: doctor.title,
  firstName: doctor.firstName,
  lastName: doctor.lastName,
  specialty: doctor.specialty,
  institutionName: doctor.institutionName,
  city: doctor.city,
  postalCode: doctor.postalCode,
  country: doctor.country,
  phone: doctor.phone,
  email: doctor.email,
  websiteUrl: doctor.websiteUrl,
  lat: 48.137154,
  lon: 11.576124,
  certifications: [{ instrument: "spirecut", certifiedDate: "2026-01-01" }],
};

beforeEach(() => {
  doctor.lat = null;
  doctor.lon = null;
  mockGeocodeDoctorLocation.mockReset();
  mockUpdate.mockClear();
  mockSet.mockClear();
});

describe("admin doctor geocoding review", () => {
  it("does not change missing coordinates until the reviewed suggestion is explicitly saved", async () => {
    mockGeocodeDoctorLocation.mockResolvedValue({
      status: "suggestion",
      lat: SAVE_BODY.lat,
      lon: SAVE_BODY.lon,
      displayName: "80331 München, Deutschland",
    });

    const suggestionResponse = await request(app)
      .post(`/admin/doctors/${doctor.id}/geocode`)
      .send({});

    expect(suggestionResponse.status).toBe(200);
    expect(suggestionResponse.body.status).toBe("suggestion");
    expect(doctor.lat).toBeNull();
    expect(doctor.lon).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();

    const saveResponse = await request(app)
      .patch(`/admin/doctors/${doctor.id}`)
      .send(SAVE_BODY);

    expect(saveResponse.status).toBe(200);
    expect(doctor.lat).toBe(SAVE_BODY.lat);
    expect(doctor.lon).toBe(SAVE_BODY.lon);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("leaves missing coordinates unchanged when the lookup is ambiguous", async () => {
    mockGeocodeDoctorLocation.mockResolvedValue({
      status: "ambiguous",
      candidates: [
        { lat: 48.137154, lon: 11.576124, displayName: "München Altstadt" },
        { lat: 48.1391, lon: 11.5802, displayName: "München Zentrum" },
      ],
    });

    const response = await request(app)
      .post(`/admin/doctors/${doctor.id}/geocode`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ambiguous");
    expect(doctor.lat).toBeNull();
    expect(doctor.lon).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});