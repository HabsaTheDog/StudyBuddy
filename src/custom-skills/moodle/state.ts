import { Annotation } from "@langchain/langgraph";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface AgentState {
  moodle_raw_text: string;
  extracted_data: JsonObject | JsonArray;
  final_document: string;
  error_log: string | null;
  retry_count: number;
}

export const initialAgentState: AgentState = {
  moodle_raw_text: "",
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

export type LangGraphAgentState = typeof AgentStateAnnotation.State;
