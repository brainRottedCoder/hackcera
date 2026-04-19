require("dotenv").config();
const { callGeminiInsights, callGeminiSummary } = require("./llmOrchestrator");

const dummyTranscript = `
Alice: We need to get the production database migrated by Friday.
Bob: I can handle the database migration. I'll make sure it's done before the weekend.
Alice: Great. Also, we decided to drop the old analytics vendor and switch to PostHog, right?
Bob: Yes, we agreed to switch to PostHog to save costs. 
Alice: My only concern is that if the migration takes too long, we might experience downtime during peak hours on Friday afternoon.
Bob: Understood. I'll schedule the actual cutover for midnight to avoid that risk.
`;

async function runTests() {
  console.log("=========================================");
  console.log("🧪 TESTING LLM ORCHESTRATOR API WITH DUMMY DATA");
  console.log("=========================================\n");

  console.log("📝 Dummy Transcript Input:");
  console.log(dummyTranscript.trim());
  console.log("\n-----------------------------------------\n");

  console.log("⏳ 1. Testing Live Insights Generation (Tasks, Decisions, Risks)...");
  try {
    const insights = await callGeminiInsights(dummyTranscript);
    console.log("✅ INSIGHTS OUTPUT:");
    console.dir(insights, { depth: null, colors: true });
  } catch (err) {
    console.error("❌ Insights API Failed:", err.message);
  }

  console.log("\n-----------------------------------------\n");

  console.log("⏳ 2. Testing Full Meeting Summary Generation...");
  try {
    const summaryData = await callGeminiSummary(dummyTranscript);
    console.log("✅ SUMMARY OUTPUT:");
    console.dir(summaryData, { depth: null, colors: true });
  } catch (err) {
    console.error("❌ Summary API Failed:", err.message);
  }
}

runTests();
