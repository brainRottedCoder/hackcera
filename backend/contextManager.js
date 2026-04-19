// ============================================================
// contextManager.js — Session Context Buffer
//
// Maintains a sliding window of recent caption chunks for LLM.
// Also accumulates tasks + decisions across the full session.
// ============================================================

class ContextManager {
  constructor(windowSize = 12) {
    // Rolling window for LLM prompt context (last N chunks = ~30s of speech)
    this.recentChunks = [];
    this.windowSize   = windowSize;

    // Full-session accumulators (for summary prompt injection)
    this.tasks     = [];
    this.decisions = [];
    this.risks     = [];
  }

  // Add a new caption chunk to rolling window
  addChunk(text) {
    this.recentChunks.push(text);
    if (this.recentChunks.length > this.windowSize) {
      this.recentChunks.shift(); // drop oldest
    }
  }

  // Get joined context string for LLM prompt
  getContext() {
    return this.recentChunks.join(" ");
  }

  // Merge LLM insights result into session accumulators
  mergeFromLLM({ tasks = [], decisions = [], risks = [] }) {
    tasks.forEach(t => {
      if (!this.tasks.find(x => x.task === t.task)) {
        this.tasks.push(t);
      }
    });

    decisions.forEach(d => {
      if (!this.decisions.includes(d)) {
        this.decisions.push(d);
      }
    });

    risks.forEach(r => {
      if (!this.risks.includes(r)) {
        this.risks.push(r);
      }
    });
  }

  getAllTasks()     { return this.tasks; }
  getAllDecisions() { return this.decisions; }
  getAllRisks()     { return this.risks; }

  // Clear everything on session end
  reset() {
    this.recentChunks = [];
    this.tasks        = [];
    this.decisions    = [];
    this.risks        = [];
  }
}

module.exports = ContextManager;
