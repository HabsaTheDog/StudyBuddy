import { describe, expect, it } from "vitest";
import {
  scoreMoodleLink,
  selectRelevantFileLinks,
  selectRelevantMoodleLinks,
} from "../nodes/scraperNode.js";

describe("Moodle crawl relevance", () => {
  it("limits broad dashboard discovery to a small course shortlist", () => {
    const links = Array.from({ length: 12 }, (_, index) => ({
      href: `https://moodle.example/course/view.php?id=${index + 1}`,
      label: `Kurs ${index + 1}`,
    }));

    expect(selectRelevantMoodleLinks(links, "DC-DC Wandler Laborvorbereitung")).toHaveLength(4);
  });

  it("prioritizes DC-DC aliases and excludes unrelated files", () => {
    const links = [
      {
        href: "https://moodle.example/mod/resource/view.php?id=10",
        label: "Tiefsetzsteller Skript",
      },
      {
        href: "https://moodle.example/pluginfile.php/20/AD_1_Punktkinematik.pdf",
        label: "Punktkinematik",
      },
      {
        href: "https://moodle.example/mod/assign/view.php?id=30",
        label: "Abgabe Protokoll DC-DC Wandler",
      },
    ];

    expect(selectRelevantMoodleLinks(links, "DC-DC Wandler Laborvorbereitung")).toEqual([
      "https://moodle.example/mod/assign/view.php?id=30",
      "https://moodle.example/mod/resource/view.php?id=10",
    ]);
    expect(selectRelevantFileLinks(links, "DC-DC Wandler Laborvorbereitung")).toEqual([
      links[0],
    ]);
  });

  it("deduplicates repeated resource links before downloading", () => {
    const link = {
      href: "https://moodle.example/mod/resource/view.php?id=10",
      label: "Tiefsetzsteller Skript",
    };

    expect(selectRelevantFileLinks([link, link], "DC-DC Wandler")).toEqual([link]);
  });

  it("deduplicates course section anchors before applying the crawl limit", () => {
    const links = [
      {
        href: "https://moodle.example/course/view.php?id=42#section-17",
        label: "Vorbereitung DC-DC Wandler",
      },
      {
        href: "https://moodle.example/course/view.php?id=42#section-18",
        label: "Durchführung DC-DC Wandler",
      },
      {
        href: "https://moodle.example/mod/resource/view.php?id=10",
        label: "Tiefsetzsteller Skript",
      },
    ];

    expect(selectRelevantMoodleLinks(links, "DC-DC Wandler")).toEqual([
      "https://moodle.example/course/view.php?id=42",
      "https://moodle.example/mod/resource/view.php?id=10",
    ]);
  });

  it("uses explicit Moodle ids without treating URL path words as topic terms", () => {
    const requested = {
      href: "https://moodle.example/mod/resource/view.php?id=2189329",
      label: "Skript",
    };
    const unrelated = {
      href: "https://moodle.example/mod/resource/view.php?id=2189304",
      label: "RLC What to do",
    };

    expect(
      selectRelevantFileLinks(
        [unrelated, requested],
        "Nutze mod/resource/view.php?id=2189329 für DC-DC Wandler",
      ),
    ).toEqual([requested]);
  });

  it("splits technical compounds and ranks the matching laboratory course above news", () => {
    const laboratory = {
      href: "https://moodle.example/course/view.php?id=32320",
      label: "BMR-VZ-2-SS2026-ETLB2-DE Elektrotechnik Labor 2",
    };
    const drawing = {
      href: "https://moodle.example/course/view.php?id=32838",
      label: "Grundlagen des technischen Zeichnens",
    };
    const news = {
      href: "https://moodle.example/mod/forum/discuss.php?d=147697",
      label: "Ein Moodle-Update, viele Verbesserungen",
    };
    const prompt = "PDF-Dokument zur Vorbereitung auf das Elektrotechnik-Labor zu DC-DC-Wandlern";

    expect(scoreMoodleLink(laboratory, prompt)).toBeGreaterThan(scoreMoodleLink(drawing, prompt));
    expect(scoreMoodleLink(news, prompt)).toBeLessThan(100);
    expect(selectRelevantMoodleLinks([drawing, news, laboratory], prompt)[0]).toBe(laboratory.href);
  });

  it("focuses an exact course title instead of crawling neighboring courses", () => {
    const dyn2 = {
      href: "https://moodle.example/course/view.php?id=32844",
      label: "BMR-VZ-2-SS2026-DYN2-DE Anwendungen der Dynamik",
    };
    const phdyn = {
      href: "https://moodle.example/course/view.php?id=32916",
      label: "BMR-VZ-2-SS2026-PHDYN-DE Physikalische Grundlagen der Dynamik",
    };
    const statics = {
      href: "https://moodle.example/course/view.php?id=31034",
      label: "BMR-VZ-1-WS2025-STA2-DE Anwendungen der Statik und Festigkeitslehre",
    };

    expect(
      selectRelevantMoodleLinks(
        [phdyn, statics, dyn2],
        "Moodle-Kurs Anwendungen der Dynamik: Finde Kursunterlagen und Prüfungshinweise.",
      ),
    ).toEqual([dyn2.href]);
  });

  it("keeps a small shortlist when course discovery stays ambiguous", () => {
    const links = [
      {
        href: "https://moodle.example/course/view.php?id=1",
        label: "BMR-VZ-2-SS2026-ET2-DE Elektrotechnik 2",
      },
      {
        href: "https://moodle.example/course/view.php?id=2",
        label: "BMR-VZ-2-SS2026-ETLB2-DE Elektrotechnik Labor 2",
      },
      {
        href: "https://moodle.example/course/view.php?id=3",
        label: "BMR-VZ-2-SS2026-ELAB-DE Elektrotechnik Labor Grundlagen",
      },
    ];

    const selected = selectRelevantMoodleLinks(links, "Elektrotechnik Labor Vorbereitung");
    expect(selected).toHaveLength(3);
    expect(selected).toContain(links[1].href);
    expect(selected).toContain(links[2].href);
  });
});
