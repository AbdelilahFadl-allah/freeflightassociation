import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { labels } from "../src/i18n/sites";
import type { Language } from "../src/translations";

vi.mock("../src/SiteMap", () => ({ SiteMap: () => null }));

import { SiteCardContent } from "../src/Sites";

const site = {
  id: "site-1",
  name: "Example site",
  latitude: 34,
  longitude: -5,
  municipality: "Example town",
  status: "open" as const,
  windDirections: ["N", "SW"],
  details: { tandem: "yes" as const },
  landings: [
    { id: "landing-1", name: "Primary field", type: "primary" as const, polygon: [
      { latitude: 34.1, longitude: -5.1 }, { latitude: 34.2, longitude: -5.2 },
    ] },
    { id: "landing-2", name: "Old field", type: "emergency" as const, polygon: null, latitude: 34.3, longitude: -5.3 },
  ],
  revision: 1,
  validatedAt: "2026-01-01T12:00:00Z",
  validatedBy: "admin-1",
  signature: null,
};

describe("site card labels", () => {
  it.each(["en", "fr", "ar"] as Language[])("labels values in %s", (language) => {
    const markup = renderToStaticMarkup(<SiteCardContent site={site} language={language} />);
    const t = labels[language];
    for (const label of [t.name, t.status, t.validationStatus, t.municipality, t.takeoffPoint,
      t.wind, t.landings, t.landingType, t.coordinates, t.validatedBy, t.validatedOn]) {
      expect(markup).toContain(renderToStaticMarkup(<strong>{label}:</strong>));
    }
    for (const value of ["Example site", "Example town", "Primary field", "Old field", "34.1, -5.1", "34.3, -5.3"]) {
      expect(markup).toContain(value);
    }
    expect(markup).toContain(t.primary);
    expect(markup).toContain(t.emergency);
    expect(markup).toContain(t.validated);
    expect(markup).toContain(t.validatorUnavailable);
    expect(markup).not.toContain("admin-1");
    expect(markup).toContain(`<summary>${t.siteDetails}</summary>`);
    expect(markup.match(/class="site-card-related"/g)).toHaveLength(3);
    expect(markup).toContain('class="site-card"');
  });

  it("labels an empty landing list and an unvalidated site", () => {
    const markup = renderToStaticMarkup(<SiteCardContent language="en" site={{ ...site, landings: [], validatedAt: null, validatedBy: null }} />);
    expect(markup).toContain(`${labels.en.landings}:`);
    expect(markup).toContain(labels.en.none);
    expect(markup).toContain(labels.en.unvalidated);
    expect(markup).not.toContain(`${labels.en.validatedBy}:`);
  });
});
