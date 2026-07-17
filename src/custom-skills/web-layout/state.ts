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
  html_document: string;
  validation_report: JsonObject;
  error_log: string | null;
  retry_count: number;
  planner_retry_count: number;
  generator_retry_count: number;
  validator_retry_count: number;
  quality_retry_count: number;
}

export const initialWebLayoutState: WebLayoutState = {
  source_text: "",
  layout_spec: {},
  html_document: "",
  validation_report: {},
  error_log: null,
  retry_count: 0,
  planner_retry_count: 0,
  generator_retry_count: 0,
  validator_retry_count: 0,
  quality_retry_count: 0,
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
});

export type LangGraphWebLayoutState = typeof WebLayoutStateAnnotation.State;
