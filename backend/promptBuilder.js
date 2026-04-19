// ============================================================
// promptBuilder.js — Prompt Templates
//
// Two prompt types:
//   buildInsightsPrompt()  → lightweight real-time extraction
//   buildSummaryPrompt()   → heavy full-meeting summary
// ============================================================

// ── TRACK B: Real-time insights prompt ──
// Keep lean: ~600 char context cap = ~150 tokens = cheap + fast
function buildInsightsPrompt(context, prevTasks = [], prevDecisions = []) {
  // Hard-cap context to ~2400 chars to stay within token budget
  const cappedContext = context.slice(-2400);

  // Only inject last 5 accumulated items to keep prompt small
  const recentTasks     = prevTasks.slice(-5);
  const recentDecisions = prevDecisions.slice(-5);

  return `You are an AI assistant analyzing a live business meeting transcript.

## Live Transcript (last ~30 seconds of meeting):
${cappedContext}

## Previously Extracted (do NOT repeat these unless they are updated):
Tasks: ${JSON.stringify(recentTasks)}
Decisions: ${JSON.stringify(recentDecisions)}

## Instructions:
Extract ONLY NEW items explicitly discussed in the transcript above:
1. Tasks — must include: "task" (string), "owner" (person name or "Unassigned"), "deadline" (date/time or "TBD")
2. Decisions — clear committed decisions (strings)
3. Risks — blockers, concerns, or risks mentioned (strings)

## RULES:
- Do NOT hallucinate. Only extract what is explicitly said.
- Do NOT repeat previously extracted items.
- Return ONLY valid JSON. No explanation, no markdown, no code fences.
- If nothing new to extract, return: {"tasks":[],"decisions":[],"risks":[]}

## Required JSON format:
{"tasks":[{"task":"...","owner":"...","deadline":"..."}],"decisions":["..."],"risks":["..."]}`;
}

// ── TRACK C: Full meeting summary prompt ──
// Heavier prompt — called once manually by user
function buildSummaryPrompt(fullTranscript, allTasks = [], allDecisions = []) {
  return `You are an expert AI meeting analyst. The user has just finished a meeting and wants a comprehensive summary.

## Full Meeting Transcript:
${fullTranscript}

## Previously Auto-Extracted Items (include and verify these):
Tasks: ${JSON.stringify(allTasks)}
Decisions: ${JSON.stringify(allDecisions)}

## Instructions:
Generate a COMPLETE meeting summary with the following:
1. "summary" — 3-5 sentence narrative summary of what the meeting covered and achieved.
2. "tasks" — ALL tasks mentioned, each with "task", "owner" (or "Unassigned"), "deadline" (or "TBD").
3. "decisions" — ALL decisions or commitments made (strings).
4. "risks" — ALL blockers, concerns, or risks raised (strings).

## RULES:
- Be comprehensive — capture everything, not just the last few seconds.
- Do NOT hallucinate tasks or decisions. Only extract what was explicitly discussed.
- Return ONLY valid JSON. No markdown, no explanation, no code fences.

## Required JSON format:
{
  "summary": "...",
  "tasks": [{"task":"...","owner":"...","deadline":"..."}],
  "decisions": ["..."],
  "risks": ["..."]
}`;
}

module.exports = { buildInsightsPrompt, buildSummaryPrompt };
