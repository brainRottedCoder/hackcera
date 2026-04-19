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
  return `You are an expert AI meeting analyst. The user has just finished a meeting and wants a comprehensive summary resulting in a strict JSON format.

## Full Meeting Transcript:
${fullTranscript}

## Previously Auto-Extracted Items (incorporate these):
Tasks: ${JSON.stringify(allTasks)}
Decisions: ${JSON.stringify(allDecisions)}

## Instructions:
Generate a COMPLETE meeting summary with EXACTLY these four root keys. Do NOT change the key names:
1. "summary" — 3-5 sentence narrative summary of what the meeting covered.
2. "tasks" — Array of task objects. EACH object MUST have three exact keys: "task" (string), "owner" (string, DO NOT USE 'assignee'), "deadline" (string).
3. "decisions" — Array of strings detailing commitments made.
4. "risks" — Array of strings detailing blockers or risks raised.

## REQUIRED JSON SCHEMA EXACT MATCH (DO NOT DEVIATE):
{
  "summary": "Full narrative text here...",
  "tasks": [{"task": "...", "owner": "...", "deadline": "..."}],
  "decisions": ["..."],
  "risks": ["..."]
}
`;
}

module.exports = { buildInsightsPrompt, buildSummaryPrompt };
