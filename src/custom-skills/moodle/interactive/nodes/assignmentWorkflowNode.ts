// @effect-diagnostics nodeBuiltinImport:off
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentBrowserClient, AgentBrowserSnapshot } from "../agentBrowserClient.js";
import {
  assertAssignmentFilesUnchanged,
  buildPendingAssignmentPermissionRequest,
  persistPendingAssignmentPermission,
} from "../assignmentPermissions.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "../browserAuth.js";
import { createBrowserClient } from "../browserClient.js";
import { extractAssignmentUrl } from "../quizIntent.js";
import type { JsonObject, LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

export interface AssignmentWorkflowNodeDependencies {
  agentBrowser?: AgentBrowserClient;
}

interface AssignmentReport {
  kind: "assignment_workflow";
  target_url: string;
  assignment_title: string;
  status: "permission_required" | "blocked" | "submitted" | "manual_action_required" | "failed";
  reason: string;
  uploaded_files: string[];
  final_assignment_submit_clicked: boolean;
  final_quiz_submit_clicked: false;
  permission_request_path?: string;
}

export function createAssignmentWorkflowNode(
  config: MoodleRuntimeConfig,
  dependencies: AssignmentWorkflowNodeDependencies = {},
) {
  return async function assignmentWorkflowNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const client = dependencies.agentBrowser ?? createBrowserClient(config);
    const targetUrl =
      extractAssignmentUrl(config.prompt) ??
      (config.moodleUrl.includes("/mod/assign/") ? config.moodleUrl : null);
    if (!targetUrl) {
      return finish(state, config, {
        kind: "assignment_workflow",
        target_url: config.moodleUrl,
        assignment_title: "Moodle assignment",
        status: "blocked",
        reason: "An exact Moodle assignment URL is required for submission.",
        uploaded_files: [],
        final_assignment_submit_clicked: false,
        final_quiz_submit_clicked: false,
      });
    }

    await ensureAgentBrowserLoggedIn(
      client,
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl,
        username: config.username,
        password: config.password,
        allowedOrigins: config.moodleLoginAllowedOrigins,
      }),
    );
    await client.open(targetUrl);
    await client.wait(1_500);
    const assignmentTitle = (await client.getTitle()).trim() || "Moodle assignment";

    if (config.quizSafetyPolicy?.accessMode !== "full-study-assist") {
      return finish(state, config, {
        kind: "assignment_workflow",
        target_url: targetUrl,
        assignment_title: assignmentTitle,
        status: "blocked",
        reason: "Assignment submission requires Full study assist mode.",
        uploaded_files: [],
        final_assignment_submit_clicked: false,
        final_quiz_submit_clicked: false,
      });
    }

    if (!config.approvedAssignmentPermission) {
      const request = await buildPendingAssignmentPermissionRequest({
        targetUrl,
        assignmentTitle,
        files: config.assignmentFiles ?? [],
      });
      const requestPath = await persistPendingAssignmentPermission(config, request);
      return finish(state, config, {
        kind: "assignment_workflow",
        target_url: targetUrl,
        assignment_title: assignmentTitle,
        status: "permission_required",
        reason:
          "Native approval is required before uploading or finally submitting this assignment.",
        uploaded_files: [],
        final_assignment_submit_clicked: false,
        final_quiz_submit_clicked: false,
        permission_request_path: requestPath,
      });
    }

    await assertAssignmentFilesUnchanged(config.approvedAssignmentPermission.files);
    const uploadedFiles = config.approvedAssignmentPermission.files.map((file) => file.path);
    let snapshot = await client.snapshot({ interactive: true, compact: true, depth: 12 });
    const editControl = findControl(snapshot, [
      /add submission/i,
      /edit submission/i,
      /abgabe hinzufügen/i,
      /abgabe bearbeiten/i,
    ]);
    if (uploadedFiles.length > 0) {
      if (editControl) {
        await client.click(`@${editControl}`);
        await client.wait(1_000);
      }
      if (!client.upload) {
        return finish(
          state,
          config,
          failedReport(
            targetUrl,
            assignmentTitle,
            [],
            "The selected browser backend does not support assignment file uploads.",
          ),
        );
      }
      await client.upload("input[type=file]", uploadedFiles);
      const saveSnapshot = await client.snapshot({ interactive: true, compact: true, depth: 12 });
      const saveControl = findControl(saveSnapshot, [
        /^save changes$/i,
        /^änderungen speichern$/i,
        /^aenderungen speichern$/i,
      ]);
      if (!saveControl) {
        return finish(
          state,
          config,
          failedReport(
            targetUrl,
            assignmentTitle,
            uploadedFiles,
            "Uploaded files but could not find the Moodle Save changes control.",
          ),
        );
      }
      await client.click(`@${saveControl}`);
      await client.wait(1_500);
      snapshot = await client.snapshot({ interactive: true, compact: true, depth: 12 });
    }

    if (hasDeclaration(snapshot)) {
      return finish(
        state,
        config,
        manualReport(
          targetUrl,
          assignmentTitle,
          uploadedFiles,
          "Moodle requires accepting a declaration. Study Buddy leaves declarations for the user.",
        ),
      );
    }
    const submitControl = findControl(snapshot, [
      /^submit assignment$/i,
      /^abgabe einreichen$/i,
      /^abgeben$/i,
    ]);
    if (!submitControl) {
      return finish(
        state,
        config,
        failedReport(
          targetUrl,
          assignmentTitle,
          uploadedFiles,
          "Could not find a final assignment submission control. The draft may already be submitted or the Moodle form is unsupported.",
        ),
      );
    }
    await client.click(`@${submitControl}`);
    await client.wait(1_000);

    const confirmation = await client.snapshot({ interactive: true, compact: true, depth: 12 });
    if (hasDeclaration(confirmation)) {
      return finish(
        state,
        config,
        manualReport(
          targetUrl,
          assignmentTitle,
          uploadedFiles,
          "Moodle requires accepting a declaration. The final confirmation was not clicked.",
        ),
      );
    }
    const confirmControl = findControl(confirmation, [
      /^continue$/i,
      /^submit assignment$/i,
      /^abgabe bestätigen$/i,
      /^abgabe bestaetigen$/i,
      /^bestätigen$/i,
      /^bestaetigen$/i,
    ]);
    if (!confirmControl) {
      return finish(
        state,
        config,
        manualReport(
          targetUrl,
          assignmentTitle,
          uploadedFiles,
          "Moodle displayed an unsupported confirmation step. The final confirmation was not clicked.",
        ),
      );
    }
    await client.click(`@${confirmControl}`);
    await client.wait(1_500);
    const body = await client.getText("body");
    const verified =
      /submitted for grading|submitted|zur bewertung abgegeben|abgegeben zur bewertung/i.test(body);
    return finish(state, config, {
      kind: "assignment_workflow",
      target_url: targetUrl,
      assignment_title: assignmentTitle,
      status: verified ? "submitted" : "manual_action_required",
      reason: verified
        ? "Moodle reports that the assignment was submitted."
        : "The approved final control was clicked, but Moodle did not expose a recognizable submitted status.",
      uploaded_files: uploadedFiles,
      final_assignment_submit_clicked: true,
      final_quiz_submit_clicked: false,
    });
  };
}

function findControl(snapshot: AgentBrowserSnapshot, patterns: RegExp[]): string | null {
  for (const [ref, control] of Object.entries(snapshot.refs)) {
    const label = control.name?.trim() ?? "";
    if (
      (control.role === "button" || control.role === "link") &&
      patterns.some((pattern) => pattern.test(label))
    ) {
      return ref;
    }
  }
  return null;
}

function hasDeclaration(snapshot: AgentBrowserSnapshot): boolean {
  return Object.values(snapshot.refs).some((control) =>
    /declaration|original work|eidesstatt|eigenständig|eigenstaendig/i.test(control.name ?? ""),
  );
}

function failedReport(
  targetUrl: string,
  title: string,
  files: string[],
  reason: string,
): AssignmentReport {
  return {
    kind: "assignment_workflow",
    target_url: targetUrl,
    assignment_title: title,
    status: "failed",
    reason,
    uploaded_files: files,
    final_assignment_submit_clicked: false,
    final_quiz_submit_clicked: false,
  };
}

function manualReport(
  targetUrl: string,
  title: string,
  files: string[],
  reason: string,
): AssignmentReport {
  return {
    kind: "assignment_workflow",
    target_url: targetUrl,
    assignment_title: title,
    status: "manual_action_required",
    reason,
    uploaded_files: files,
    final_assignment_submit_clicked: false,
    final_quiz_submit_clicked: false,
  };
}

async function finish(
  state: LangGraphAgentState,
  config: MoodleRuntimeConfig,
  report: AssignmentReport,
): Promise<Partial<LangGraphAgentState>> {
  const document = [
    "= Moodle Assignment Assist",
    "",
    `Assignment: ${report.assignment_title}`,
    `Status: ${report.status}`,
    `Reason: ${report.reason}`,
    `Final assignment submit clicked: ${report.final_assignment_submit_clicked}`,
    "Final quiz submit clicked: false",
    ...(report.permission_request_path
      ? [`Permission request: ${report.permission_request_path}`]
      : []),
    "",
  ].join("\n");
  await Promise.all([
    writeFile(
      path.join(config.runDir, "assignment-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(path.join(config.runDir, "assignment-report.md"), document, "utf8"),
  ]);
  return {
    extracted_data: JSON.parse(
      JSON.stringify({
        ...(state.extracted_data && !Array.isArray(state.extracted_data)
          ? state.extracted_data
          : {}),
        assignment_workflow: report,
      }),
    ) as JsonObject,
    final_document: document,
    moodle_raw_text: `${report.assignment_title}\n${report.reason}`,
    source_coverage: {
      ...state.source_coverage,
      moodle: {
        status: report.status === "blocked" || report.status === "failed" ? "failed" : "success",
        detail: report.reason,
        urls: [report.target_url],
        pages: 1,
      },
    },
    error_log: report.status === "failed" ? report.reason : null,
  };
}
