import { screen } from "@testing-library/react";
import DescriptionAccordion from "../DescriptionAccordion";
import { renderWithLocale } from "./renderWithLocale";

// "Overview" opens by default (no line-count shown); the rest start
// collapsed, so their "N line(s)" ICU-pluralized summaries are visible.
const description = [
  "Overview",
  "Overview line",
  "",
  "Goals",
  "Goal only line",
  "",
  "How funds are used",
  "Fund line 1",
  "Fund line 2",
  "Fund line 3",
  "",
  "Team",
  "Team line",
].join("\n");

describe("DescriptionAccordion", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("matches snapshot for a multi-section description", () => {
    const { container } = renderWithLocale(<DescriptionAccordion description={description} />);
    expect(container).toMatchSnapshot();
  });

  it("pluralizes collapsed section line counts (English one/other)", () => {
    renderWithLocale(<DescriptionAccordion description={description} />);
    // Goals + Team each have exactly 1 line.
    expect(screen.getAllByText("1 line")).toHaveLength(2);
    // "How funds are used" has 3 lines.
    expect(screen.getByText("3 lines")).toBeInTheDocument();
  });

  describe("RTL (Arabic locale)", () => {
    it("sets dir=rtl and uses Arabic's 'few' plural category for a 3-line section", () => {
      renderWithLocale(<DescriptionAccordion description={description} />, "ar");
      expect(document.documentElement.dir).toBe("rtl");
      // Arabic "few" (3-10): "٣ أسطر"
      expect(screen.getByText("٣ أسطر")).toBeInTheDocument();
      // Arabic "one": "سطر واحد"
      expect(screen.getAllByText("سطر واحد")).toHaveLength(2);
    });

    it("matches snapshot with RTL text-start alignment", () => {
      const { container } = renderWithLocale(<DescriptionAccordion description={description} />, "ar");
      expect(container).toMatchSnapshot();
    });
  });
});
