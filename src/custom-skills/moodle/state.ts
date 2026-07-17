import { Annotation } from "@langchain/langgraph";
import {
  emptyCoverageAssessment,
  emptyEvidencePackage,
  emptyResourceManifest,
  emptyReviewReport,
  emptyStudyModel,
  type ArtifactBundle,
  type CoverageAssessment,
  type EvidencePackage,
  type ResourceManifest,
  type ReviewReport,
  type StudyModel,
} from "./examNavigatorContracts.js";
import {
  emptySourceArchitectDecision,
  type SourceArchitectDecision,
} from "./sourceArchitect.js";

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
  resource_manifest: ResourceManifest;
  evidence_package: EvidencePackage;
  coverage_assessment: CoverageAssessment;
  study_model: StudyModel;
  review_report: ReviewReport;
  artifact_bundle: ArtifactBundle | null;
  source_architect_decision: SourceArchitectDecision;
}

export const initialAgentState: AgentState = {
  moodle_raw_text: "",
  extracted_data: {},
  final_document: "",
  error_log: null,
  retry_count: 0,
  resource_manifest: emptyResourceManifest(),
  evidence_package: emptyEvidencePackage(),
  coverage_assessment: emptyCoverageAssessment(),
  study_model: emptyStudyModel(),
  review_report: emptyReviewReport(),
  artifact_bundle: null,
  source_architect_decision: emptySourceArchitectDecision(),
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
  resource_manifest: Annotation<ResourceManifest>({
    reducer: (_current, update) => update,
    default: emptyResourceManifest,
  }),
  evidence_package: Annotation<EvidencePackage>({
    reducer: (_current, update) => update,
    default: emptyEvidencePackage,
  }),
  coverage_assessment: Annotation<CoverageAssessment>({
    reducer: (_current, update) => update,
    default: emptyCoverageAssessment,
  }),
  study_model: Annotation<StudyModel>({
    reducer: (_current, update) => update,
    default: emptyStudyModel,
  }),
  review_report: Annotation<ReviewReport>({
    reducer: (_current, update) => update,
    default: emptyReviewReport,
  }),
  artifact_bundle: Annotation<ArtifactBundle | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  source_architect_decision: Annotation<SourceArchitectDecision>({
    reducer: (_current, update) => update,
    default: emptySourceArchitectDecision,
  }),
});

export type LangGraphAgentState = typeof AgentStateAnnotation.State;
