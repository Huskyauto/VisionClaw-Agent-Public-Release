declare module "graphology-pagerank" {
  import Graph from "graphology";
  interface PageRankOptions {
    alpha?: number;
    maxIterations?: number;
    tolerance?: number;
    getEdgeWeight?: string | ((edge: string) => number) | null;
  }
  function pagerank(graph: Graph, options?: PageRankOptions): { [node: string]: number };
  export default pagerank;
}
