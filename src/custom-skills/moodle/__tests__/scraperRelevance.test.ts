import { describe, expect, it } from "vitest";
import {
  explicitCourseCodes,
  filterMoodleLinksToCourseScope,
  isOutsideResolvedCourseScope,
  isLowValueMoodleUtilityLink,
  scoreMoodleLink,
  scoreCourseFocus,
  scheduleSectionRefs,
  scheduleSectionUrlsFromSnapshot,
  selectRelevantFileLinks,
  selectRelevantMoodleLinks,
} from "../nodes/scraperNode.js";

describe("Moodle crawl relevance", () => {
  it("prioritizes activity pages for read-only quiz discovery", () => {
    const links = [
      { href: "https://moodle.example/mod/page/view.php?id=1", label: "Lecture notes" },
      { href: "https://moodle.example/mod/quiz/view.php?id=2", label: "Minitest 4" },
      { href: "https://moodle.example/mod/hotquestion/view.php?id=3", label: "Self-check questions" },
      { href: "https://moodle.example/course/view.php?id=4", label: "Course" },
    ];

    expect(selectRelevantMoodleLinks(links, "Find quizzes and self-checks that are still open")).toEqual([
      "https://moodle.example/mod/quiz/view.php?id=2",
      "https://moodle.example/mod/hotquestion/view.php?id=3",
    ]);
  });

  it("keeps a resolved course as an immutable crawl boundary", () => {
    const selectedCourse = "https://moodle.example/course/view.php?id=20";
    const links = [
      { href: selectedCourse, label: "Selected course" },
      { href: `${selectedCourse}#section-4`, label: "Selected course section" },
      { href: "https://moodle.example/course/view.php?id=10", label: "Neighboring course" },
      { href: "https://moodle.example/mod/resource/view.php?id=300", label: "Course resource" },
      { href: "https://moodle.example/course/section.php?id=400", label: "Course section" },
    ];

    expect(filterMoodleLinksToCourseScope(links, [selectedCourse])).toEqual([
      links[0],
      links[1],
      links[3],
      links[4],
    ]);
    expect(isOutsideResolvedCourseScope(links[2].href, [selectedCourse])).toBe(true);
    expect(isOutsideResolvedCourseScope(links[3].href, [selectedCourse])).toBe(false);
    expect(selectRelevantMoodleLinks(
      filterMoodleLinksToCourseScope(links, [selectedCourse]),
      "Build a guide for the neighboring course",
    )).not.toContain(links[2].href);
  });

  it("supports an intentional multi-course scope without admitting other courses", () => {
    const selected = [
      "https://moodle.example/course/view.php?id=20",
      "https://moodle.example/course/view.php?id=21",
    ];
    const links = [
      { href: "https://moodle.example/course/view.php?id=20", label: "First selected course" },
      { href: "https://moodle.example/course/view.php?id=21", label: "Second selected course" },
      { href: "https://moodle.example/course/view.php?id=22", label: "Unselected course" },
    ];

    expect(filterMoodleLinksToCourseScope(links, selected)).toEqual(links.slice(0, 2));
  });

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

  it("selects HAN PDF endpoints even when the URL has no .pdf suffix", () => {
    const link = {
      href: "https://example.han.technikum-wien.at/content/pdf/10.1007%2F978-3-8348-9898-2",
      label: "Seite E71 bis E73",
    };

    expect(selectRelevantFileLinks(
      [link],
      "Erstelle einen vollständigen Lernleitfaden aus allen Kursunterlagen",
      5,
      Number.NEGATIVE_INFINITY,
    )).toEqual([link]);
  });

  it("ranks one administrative document ahead of lecture material for schedule probes", () => {
    const lecture = {
      href: "https://moodle.example/mod/resource/view.php?id=10",
      label: "TEZEI Übungsblatt technische Zeichnung",
    };
    const courseInfo = {
      href: "https://moodle.example/mod/resource/view.php?id=11",
      label: "TEZEI Allgemeines und Prüfungstermine",
    };

    expect(selectRelevantFileLinks(
      [lecture, courseInfo],
      "Wann ist die TEZEI Prüfung?",
      1,
    )).toEqual([courseInfo]);
  });

  it("selects only collapsed exam and administrative sections for expansion", () => {
    expect(scheduleSectionRefs({
      origin: "https://moodle.example/course/view.php?id=1",
      refs: {},
      snapshot: [
        '- button "Präsenz: Prüfung" [expanded=false, ref=e91]',
        '- button "Wiederholungsprüfung" [expanded=false, ref=e92]',
        '- button "Präsenz 2: Oberflächen" [expanded=false, ref=e93]',
        '- button "Allgemeines" [expanded=true, ref=e94]',
      ].join("\n"),
    })).toEqual(["e91", "e92"]);
  });

  it("derives bounded direct URLs for collapsed exam sections", () => {
    expect(scheduleSectionUrlsFromSnapshot({
      origin: "https://moodle.example/course/view.php?id=1",
      refs: {},
      snapshot: [
        '- link "Präsenz: Prüfung" [ref=e1, url=https://moodle.example/course/view.php?id=1#section-15]',
        '- link "Datum setzen" [ref=e2, url=https://moodle.example/course/editsection.php?id=474]',
        '- link "Wiederholungsprüfung" [ref=e3, url=https://moodle.example/course/view.php?id=1#section-16]',
        '- link "Datum setzen" [ref=e4, url=https://moodle.example/course/editsection.php?id=475]',
        '- link "Vorlesung" [ref=e5, url=https://moodle.example/course/view.php?id=1#section-3]',
        '- link "Datum setzen" [ref=e6, url=https://moodle.example/course/editsection.php?id=333]',
      ].join("\n"),
    })).toEqual([
      "https://moodle.example/course/section.php?id=474",
      "https://moodle.example/course/section.php?id=475",
    ]);
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

  it("prioritizes MEL1 course over Moodle utility pages for MEL exam prompts", () => {
    const links = [
      { href: "https://moodle.example/mod/page/view.php?id=1872333", label: "Generico Tool" },
      { href: "https://moodle.example/course/view.php?id=32280", label: "BMR-VZ-2-SS2026-MEL1-DE Maschinenelemente 1" },
      { href: "https://moodle.example/course/view.php?id=32844", label: "BMR-VZ-2-SS2026-DYN2-DE Anwendungen der Dynamik" },
    ];
    const prompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin.";

    expect(selectRelevantMoodleLinks(links, prompt)).toEqual([
      "https://moodle.example/course/view.php?id=32280",
    ]);
    expect(scoreMoodleLink(links[0], prompt)).toBeLessThan(scoreMoodleLink(links[1], prompt));
    expect(scoreCourseFocus(links[1].label, prompt)).toBeGreaterThanOrEqual(1_400);
  });

  it("extracts digitless course codes and does not boost Moodle utility pages", () => {
    const help = { href: "https://moodle.example/mod/page/view.php?id=1", label: "Moodle Hilfe und Tipps" };
    const course = { href: "https://moodle.example/course/view.php?id=32280", label: "MEL1 Maschinenelemente 1" };

    expect(explicitCourseCodes("MEL Prüfung in Moodle und CIS")).toEqual(["MEL"]);
    expect(isLowValueMoodleUtilityLink(help)).toBe(true);
    expect(scoreMoodleLink(help, "MEL Prüfung in Moodle")).toBeLessThan(scoreMoodleLink(course, "MEL Prüfung in Moodle"));
  });
});
