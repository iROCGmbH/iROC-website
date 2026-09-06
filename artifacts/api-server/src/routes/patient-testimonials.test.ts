import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const {
  mockSelectOrderBy,
  mockSelectWhere,
  mockInsertReturning,
  mockUpdateReturning,
  mockDeleteReturning,
} = vi.hoisted(() => ({
  mockSelectOrderBy: vi.fn().mockResolvedValue([]),
  mockSelectWhere: vi.fn(),
  mockInsertReturning: vi.fn().mockResolvedValue([]),
  mockUpdateReturning: vi.fn().mockResolvedValue([]),
  mockDeleteReturning: vi.fn().mockResolvedValue([]),
}));

vi.mock("@workspace/db", () => {
  const query = {
    where: mockSelectWhere,
    orderBy: mockSelectOrderBy,
  };

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(query) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: mockInsertReturning }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: mockUpdateReturning }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: mockDeleteReturning }),
      }),
    },
    patientTestimonialsTable: {},
  };
});

import app from "../app";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    titleDe: "Schnelle Genesung",
    titleEn: "A fast recovery",
    videoUrl,
    displayOrder: 1,
    published: false,
    ...overrides,
  };
}

describe("patient testimonial API", () => {
  beforeEach(() => {
    mockSelectOrderBy.mockReset().mockResolvedValue([]);
    mockSelectWhere.mockReset().mockImplementation(() => Object.assign(Promise.resolve([]), { orderBy: mockSelectOrderBy }));
    mockInsertReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockDeleteReturning.mockReset().mockResolvedValue([]);
  });

  it("keeps admin testimonial data behind the admin guard", async () => {
    const response = await request(app).get("/api/admin/patient-testimonials");
    expect(response.status).toBe(401);
  });

  it("rejects unsupported video hosts when an admin creates a testimonial", async () => {
    const response = await request(app)
      .post("/api/admin/patient-testimonials")
      .set("Authorization", ADMIN_AUTH)
      .send(validBody({ videoUrl: "https://example.com/not-a-youtube-video" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/YouTube/);
  });

  it("creates a validated testimonial for an authenticated admin", async () => {
    const created = {
      id: 19,
      ...validBody({ patientLabel: "M. S.", procedureDe: "Karpaltunnelsyndrom", procedureEn: "Carpal Tunnel Syndrome" }),
      descriptionDe: "",
      descriptionEn: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mockInsertReturning.mockResolvedValue([created]);

    const response = await request(app)
      .post("/api/admin/patient-testimonials")
      .set("Authorization", ADMIN_AUTH)
      .send(validBody({ patientLabel: "M. S.", procedure: "Karpaltunnelsyndrom" }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 19, titleDe: "Schnelle Genesung", patientLabel: "M. S." });
  });

  it("allows admins to update only publication state", async () => {
    mockSelectWhere.mockImplementationOnce(() => Object.assign(Promise.resolve([{
      id: 19, ...validBody(), videoUrl, published: false,
    }]), { orderBy: mockSelectOrderBy }));
    mockUpdateReturning.mockResolvedValue([{
      id: 19,
      ...validBody({ published: true }),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    }]);

    const response = await request(app)
      .patch("/api/admin/patient-testimonials/19")
      .set("Authorization", ADMIN_AUTH)
      .send({ published: true });

    expect(response.status).toBe(200);
    expect(response.body.published).toBe(true);
  });

  it("rejects publishing a legacy testimonial with an invalid video URL", async () => {
    mockSelectWhere.mockImplementationOnce(() => Object.assign(Promise.resolve([{
      id: 19, ...validBody({ videoUrl: "https://unsafe.example/video", published: false }),
    }]), { orderBy: mockSelectOrderBy }));

    const response = await request(app)
      .patch("/api/admin/patient-testimonials/19")
      .set("Authorization", ADMIN_AUTH)
      .send({ published: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid YouTube/i);
  });

  it("rejects a malformed testimonial path id", async () => {
    const response = await request(app)
      .delete("/api/admin/patient-testimonials/19not-an-id")
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(400);
  });

  it("returns only published entries with valid YouTube URLs to the public page", async () => {
    mockSelectOrderBy.mockResolvedValue([
      { id: 1, ...validBody({ displayOrder: 1, published: true }) },
      { id: 2, ...validBody({ displayOrder: 2, published: false }) },
      { id: 3, ...validBody({ displayOrder: 3, published: true, videoUrl: "https://malicious.example/embed/x" }) },
    ]);

    const response = await request(app).get("/api/patient-testimonials");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 1, published: true });
  });

  it("deletes an existing testimonial with an authenticated request", async () => {
    mockDeleteReturning.mockResolvedValue([{ id: 19 }]);

    const response = await request(app)
      .delete("/api/admin/patient-testimonials/19")
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(204);
  });
});