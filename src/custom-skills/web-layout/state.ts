import { Annotation } from "@langchain/langgraph";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface WebLayoutState {
  source_text: string;
  layout_spec: JsonObject;
  study_guide_content: JsonObject;
  course_blueprint: JsonObject;
  assessment_blueprint: JsonObject;
  question_bank: JsonObject;
  html_document: string;
  validation_report: JsonObject;
  error_log: string | null;
  retry_count: number;
  planner_retry_count: number;
  content_retry_count: number;
  generator_retry_count: number;
  validator_retry_count: number;
  quality_retry_count: number;
  artifact_repair_stage: number;
  artifact_candidate_hashes: string[];
}

export const initialWebLayoutState: WebLayoutState = {
  source_text: "",
  layout_spec: {},
  study_guide_content: {},
  course_blueprint: {},
  assessment_blueprint: {},
  question_bank: {},
  html_document: "",
  validation_report: {},
  error_log: null,
  retry_count: 0,
  planner_retry_count: 0,
  content_retry_count: 0,
  generator_retry_count: 0,
  validator_retry_count: 0,
  quality_retry_count: 0,
  artifact_repair_stage: 0,
  artifact_candidate_hashes: [],
};

export const WebLayoutStateAnnotation = Annotation.Root({
  source_text: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  layout_spec: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  study_guide_content: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  course_blueprint: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  assessment_blueprint: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  question_bank: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  html_document: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  validation_report: Annotation<JsonObject>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  error_log: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  planner_retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  content_retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  generator_retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  validator_retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  quality_retry_count: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  artifact_repair_stage: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  artifact_candidate_hashes: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
});

export type LangGraphWebLayoutState = typeof WebLayoutStateAnnotation.State;
