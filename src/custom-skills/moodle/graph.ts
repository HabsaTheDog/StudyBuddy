import { END, START, StateGraph } from "@langchain/langgraph";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { AgentStateAnnotation, initialAgentState, type AgentState, type LangGraphAgentState } from "./state.js";
import type { MoodleGraphInput, MoodleGraphResult, MoodleRuntimeConfig } from "./types.js";
import { createRuntimeConfig } from "./config.js";
import { createAnalyzerNode } from "./nodes/analyzerNode.js";
import { createDiskWriterNode } from "./nodes/diskWriterNode.js";
import { createFormatterNode } from "./nodes/formatterNode.js";
import { createScraperNode } from "./nodes/scraperNode.js";

const MAX_RETRIES = 3;

export interface GraphDependencies {
  codex?: CodexClient;
}

export async function runMoodleGraph(
  input: MoodleGraphInput,
  dependencies: GraphDependencies = {},
): Promise<MoodleGraphResult> {
  const config = createRuntimeConfig(input);
  const graph = buildMoodleGraph(config, dependencies);
  const state = (await graph.invoke(initialAgentState)) as AgentState;
  const ok = !state.error_log && Boolean(state.final_document.trim());
  return {
    ok,
    outputPath: ok ? config.outputPath : undefined,
    state,
    error: state.error_log ?? undefined,
  };
}

export function buildMoodleGraph(config: MoodleRuntimeConfig, dependencies: GraphDependencies = {}) {
  const codex = dependencies.codex ?? createCodexClient(config);

  return new StateGraph(AgentStateAnnotation)
    .addNode("scraper", createScraperNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("formatter", createFormatterNode(config, codex))
    .addNode("diskWriter", createDiskWriterNode(config))
    .addEdge(START, "scraper")
    .addEdge("scraper", "analyzer")
    .addConditionalEdges("analyzer", routeAfterAnalyzer, {
      analyzer: "analyzer",
      formatter: "formatter",
      abort: END,
    })
    .addConditionalEdges("formatter", routeAfterFormatter, {
      formatter: "formatter",
      diskWriter: "diskWriter",
      abort: END,
    })
    .addEdge("diskWriter", END)
    .compile();
}

function routeAfterAnalyzer(state: LangGraphAgentState): "analyzer" | "formatter" | "abort" {
  if (!state.error_log) {
    return "formatter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterFormatter(state: LangGraphAgentState): "formatter" | "diskWriter" | "abort" {
  if (!state.error_log) {
    return "diskWriter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "formatter";
}
