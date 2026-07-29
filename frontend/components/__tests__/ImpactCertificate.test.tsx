import { screen } from "@testing-library/react";
import ImpactCertificate from "../ImpactCertificate";
import { renderWithLocale } from "./renderWithLocale";

const baseProps = {
  donorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
  donorName: "Jane Doe",
  totalDonatedXLM: "1500",
  totalCO2OffsetKg: 2400,
  badgeTier: "forest" as const,
  projectsSupported: [
    { id: "p1", name: "Amazon Reforestation" },
    { id: "p2", name: "Solar for Schools" },
  ],
};

describe("ImpactCertificate", () => {
  // Pin the clock so the "Issued on …" date stays deterministic in snapshots.
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it("renders the CO₂ offset value", () => {
    renderWithLocale(<ImpactCertificate {...baseProps} />);
    // formatCO2(2400) => "2.4k kg CO₂"
    expect(screen.getByText("2.4k kg CO₂")).toBeInTheDocument();
  });

  it("renders the donor name and key impact stats", () => {
    renderWithLocale(<ImpactCertificate {...baseProps} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("1,500 XLM")).toBeInTheDocument();
    expect(screen.getByText("Forest")).toBeInTheDocument();
    expect(screen.getByText("Amazon Reforestation")).toBeInTheDocument();
  });

  it("matches snapshot", () => {
    const { container } = renderWithLocale(<ImpactCertificate {...baseProps} />);
    expect(container).toMatchSnapshot();
  });

  describe("RTL (Arabic locale)", () => {
    it("formats the XLM amount and CO₂ offset with Arabic-Indic numerals via Intl.NumberFormat", () => {
      renderWithLocale(<ImpactCertificate {...baseProps} />, "ar");
      expect(document.documentElement.dir).toBe("rtl");
      // formatXLM("1500", 2, "ar-EG") groups digits using Arabic-Indic
      // numerals rather than the "1,500" Western-Arabic default.
      expect(screen.getByText("١٬٥٠٠ XLM")).toBeInTheDocument();
      // formatCO2(2400, "ar-EG") => "٢٫٤k kg CO₂"
      expect(screen.getByText("٢٫٤k kg CO₂")).toBeInTheDocument();
    });

    it("matches snapshot under RTL", () => {
      const { container } = renderWithLocale(<ImpactCertificate {...baseProps} />, "ar");
      expect(container).toMatchSnapshot();
    });
  });
});
