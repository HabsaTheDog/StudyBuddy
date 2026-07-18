import { Annotation } from "@langchain/langgraph";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type SourceFetchStatus = "not_requested" | "success" | "empty" | "failed" | "failed_auth";

export interface SourceCoverageEntry {
  status: SourceFetchStatus;
  detail: string;
  urls: string[];
  pages: number;
}

export interface SourceCoverage {
  moodle: SourceCoverageEntry;
  cis: SourceCoverageEntry;
  calendar: SourceCoverageEntry;
}

export interface AgentState {
  moodle_raw_text: string;
  source_coverage: SourceCoverage;
  extracted_data: JsonObject | JsonArray;
  final_document: string;
  error_log: string | null;
  retry_count: number;
}

export const initialSourceCoverage: SourceCoverage = {
  moodle: {
    status: "not_requested",
    detail: "Moodle was not queried.",
    urls: [],
    pages: 0,
  },
  cis: {
    status: "not_requested",
    detail: "CIS was not queried.",
    urls: [],
    pages: 0,
  },
  calendar: {
    status: "not_requested",
    detail: "Personal calendar was not queried.",
    urls: [],
    pages: 0,
  },
};

export const initialAgentState: AgentState = {
  moodle_raw_text: "",
  source_coverage: initialSourceCoverage,
  extracted_data: {},
  final_document: "",
  error_log: null,
  retry_count: 0,
};

export const AgentStateAnnotation = Annotation.Root({
  moodle_raw_text: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  source_coverage: Annotation<SourceCoverage>({
    reducer: mergeSourceCoverage,
    default: () => initialSourceCoverage,
  }),
  extracted_data: Annotation<JsonObject | JsonArray>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  final_document: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  error_log: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
});

function mergeSourceCoverage(current: SourceCoverage, update: SourceCoverage): SourceCoverage {
  return {
    moodle: update.moodle ?? current.moodle,
    cis: update.cis ?? current.cis,
    calendar: update.calendar ?? current.calendar,
  };
}

export type LangGraphAgentState = typeof AgentStateAnnotation.State;
