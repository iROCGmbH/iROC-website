import { describe, expect, it } from "vitest";
import { sortLeadsByStatusDateCountryCity, type Lead } from "./Leads";

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: 1,
    salutation: "",
    medicalTitle: null,
    firstName: "Test",
    lastName: "Lead",
    specialty: null,
    institutionName: null,
    zipCode: null,
    city: null,
    country: null,
    email: null,
    phone: null,
    website: null,
    contactWhere: null,
    firstContactDate: null,
    notes: null,
    status: "new",
    createdAt: "2026-01-01T00:00:00.000Z",
    trainingOfferSaved: false,
    trainingOfferDownloadAvailable: false,
    ...overrides,
  };
}

describe("Leads list ordering", () => {
  it("sorts by status, then newest added date, then country, then city", () => {
    const input = [
      lead({ id: 1, status: "new", createdAt: "2026-01-01T00:00:00.000Z", country: "Germany", city: "Berlin" }),
      lead({ id: 2, status: "registered", createdAt: "2025-01-01T00:00:00.000Z", country: "Germany", city: "Munich" }),
      lead({ id: 3, status: "new", createdAt: "2026-02-01T00:00:00.000Z", country: "Austria", city: "Vienna" }),
      lead({ id: 4, status: "new", createdAt: "2026-02-01T00:00:00.000Z", country: "Belgium", city: "Brussels" }),
      lead({ id: 5, status: "new", createdAt: "2026-02-01T00:00:00.000Z", country: "Belgium", city: "Antwerp" }),
      lead({ id: 6, status: "qualified", createdAt: "2026-03-01T00:00:00.000Z", country: "Germany", city: "Berlin" }),
    ];

    expect(sortLeadsByStatusDateCountryCity(input).map(({ id }) => id)).toEqual([2, 6, 3, 5, 4, 1]);
  });

  it("keeps missing countries and cities after populated values", () => {
    const input = [
      lead({ id: 1, country: null, city: "Berlin" }),
      lead({ id: 2, country: "Germany", city: null }),
      lead({ id: 3, country: "Germany", city: "Aachen" }),
    ];

    expect(sortLeadsByStatusDateCountryCity(input).map(({ id }) => id)).toEqual([3, 2, 1]);
  });

  it("does not mutate the fetched leads array", () => {
    const input = [lead({ id: 2 }), lead({ id: 1 })];

    sortLeadsByStatusDateCountryCity(input);

    expect(input.map(({ id }) => id)).toEqual([2, 1]);
  });
});