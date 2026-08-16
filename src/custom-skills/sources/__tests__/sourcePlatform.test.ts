import { describe, expect, it } from "vitest";
import {
  approveEmailSendProposal,
  consumeEmailSendGrant,
  createEmailSendProposal,
  decideSourceOperation,
  hashEmailDraft,
  projectLegacySourceCatalog,
  selectSourcesForCapabilities,
  validateSourceCatalog,
  type EmailDraft,
  type SourceBlock,
} from "../index.js";

const draft: EmailDraft = {
  version: 1,
  id: "draft-1",
  sourceId: "mail-source",
  accountId: "student-account",
  revision: 3,
  from: "student@example.edu",
  to: ["teacher@example.edu"],
  cc: [],
  bcc: [],
  subject: "Lab question",
  body: "Could you clarify the deadline?",
  attachments: [],
};

describe("generalized source platform", () => {
  it("projects legacy sources without retaining private URL paths or query tokens", () => {
    const catalog = projectLegacySourceCatalog({
      moodle: { url: "https://student:secret@moodle.example.edu/my/?token=private", configured: true },
      calendar: { url: "webcal://calendar.example.edu/private/bearer.ics?key=secret", configured: true },
    });

    expect(catalog.sources.map((source) => source.id)).toEqual([
      "legacy-moodle",
      "legacy-calendar",
    ]);
    expect(JSON.stringify(catalog)).not.toContain("private");
    expect(JSON.stringify(catalog)).not.toContain("secret");
    expect(catalog.connections[1]?.displayOrigin).toBe("https://calendar.example.edu");
  });

  it("selects the smallest high-priority set that covers requested capabilities", () => {
    const catalog = projectLegacySourceCatalog({
      moodle: { url: "https://moodle.example.edu/my/", configured: true },
      cis: { url: "https://portal.example.edu/student/", configured: true },
      calendar: { url: "https://calendar.example.edu/feed.ics", configured: true },
    });
    const selection = selectSourcesForCapabilities(catalog, [
      "course.structure.read",
      "calendar.events.read",
    ]);

    expect(selection.selected.map((source) => source.id)).toEqual([
      "legacy-calendar",
      "legacy-moodle",
    ]);
    expect(selection.missingCapabilities).toEqual([]);
  });

  it("rejects source scope broader than its connection", () => {
    const catalog = projectLegacySourceCatalog({
      moodle: { url: "https://moodle.example.edu/my/", configured: true },
    });
    catalog.sources[0]!.scope.allowedOrigins = ["https://other.example.edu"];
    expect(() => validateSourceCatalog(catalog)).toThrow("outside connection scope");
  });

  it("rejects credential-bearing paths and queries in public connection metadata", () => {
    const catalog = projectLegacySourceCatalog({
      moodle: { url: "https://moodle.example.edu/my/", configured: true },
    });
    catalog.connections[0]!.displayOrigin = "https://moodle.example.edu/private?token=secret";
    expect(() => validateSourceCatalog(catalog)).toThrow("only a public origin");
  });

  it("keeps local email drafts available while send stays denied by default", () => {
    const catalog = projectLegacySourceCatalog({
      moodle: { url: "https://moodle.example.edu/my/", configured: true },
    });
    const template = catalog.sources[0]!;
    const mailSource: SourceBlock = {
      ...template,
      id: "mail-source",
      kind: "email",
      capabilities: ["mail.draft.local", "mail.send"],
    };

    expect(decideSourceOperation(mailSource, "mail.draft.local")).toMatchObject({
      allowed: true,
      effect: "local-only",
      approvalRequired: false,
    });
    expect(decideSourceOperation(mailSource, "mail.send")).toMatchObject({
      allowed: false,
      effect: "forbidden",
    });
    expect(
      decideSourceOperation(
        { ...mailSource, policy: { ...mailSource.policy, emailSend: "approval-required" } },
        "mail.send",
      ),
    ).toMatchObject({ allowed: true, effect: "external-commit", approvalRequired: true });
  });

  it("binds email approval to the exact immutable draft and browser session", () => {
    const now = new Date("2026-08-14T10:00:00.000Z");
    const proposal = createEmailSendProposal(draft, {
      sessionEpoch: 7,
      now,
      id: "proposal-1",
      nonce: "proposal-nonce",
    });
    const grant = approveEmailSendProposal(proposal, draft, {
      sessionEpoch: 7,
      now,
      approvalNonce: "approval-nonce",
    });
    const consumed = consumeEmailSendGrant(proposal, grant, draft, {
      sessionEpoch: 7,
      now,
    });

    expect(consumed.status).toBe("consumed");
    expect(proposal.payloadHash).toBe(hashEmailDraft(draft));
    expect(() => consumeEmailSendGrant(proposal, consumed, draft, { sessionEpoch: 7, now })).toThrow(
      "already consumed",
    );
  });

  it("invalidates approval after recipient, body, revision, account, or session changes", () => {
    const now = new Date("2026-08-14T10:00:00.000Z");
    const proposal = createEmailSendProposal(draft, { sessionEpoch: 4, now });

    expect(() =>
      approveEmailSendProposal(
        proposal,
        { ...draft, to: ["other@example.edu"] },
        { sessionEpoch: 4, now },
      )
    ).toThrow("changed");
    expect(() => approveEmailSendProposal(proposal, draft, { sessionEpoch: 5, now })).toThrow(
      "session changed",
    );
    expect(() =>
      approveEmailSendProposal(proposal, draft, {
        sessionEpoch: 4,
        now: new Date("2026-08-14T10:11:00.000Z"),
      })
    ).toThrow("expired");
  });
});
