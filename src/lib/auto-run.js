const DEFAULT_BATCH_SIZE = 18;

export function buildAutoBatch(test, questions) {
  const state = {
    subject: {
      name: "Jev",
      role: "The AI model taking this questionnaire",
      rule: "For every item, select the option that best reflects Jev's own default judgment or preference. Do not aim for a particular final type. Treat each item independently.",
    },
    questionnaire: { name: test.title, language: test.locale },
    items: questions.map((question) => ({ id: question.id, prompt: question.text })),
  };

  const apiQuestions = {};
  questions.forEach((question, index) => {
    apiQuestions[`item_${index}`] = {
      type: "choice",
      instructions: `For questionnaire item \`items[${index}].prompt\`, which option would the subject choose? Select exactly one option.`,
      criteria: Object.fromEntries(question.options.map((option, optionIndex) => [
        `option_${String.fromCharCode(97 + optionIndex)}`,
        option.label,
      ])),
    };
  });
  return { state, questions: apiQuestions };
}

export function decodeAutoBatch(sourceQuestions, response) {
  return sourceQuestions.map((question, index) => {
    const answer = response.answers[`item_${index}`];
    const selectedIndex = Math.max(0, answer.choice.charCodeAt(answer.choice.length - 1) - 97);
    const selected = question.options[selectedIndex];
    return {
      questionId: question.id,
      prompt: question.text,
      selectedIndex,
      selectedLabel: selected.label,
      selectedValue: selected.value,
      confidence: answer.confidence,
      probabilities: Object.fromEntries(question.options.map((option, optionIndex) => [
        option.label,
        answer.probabilities[`option_${String.fromCharCode(97 + optionIndex)}`] ?? 0,
      ])),
    };
  });
}

export async function runJevQuestionnaire(test, apiKey, onProgress = () => {}, batchSize = DEFAULT_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < test.questions.length; index += batchSize) {
    batches.push(test.questions.slice(index, index + batchSize));
  }
  const startedAt = performance.now();
  const details = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = null;

  for (let index = 0; index < batches.length; index += 1) {
    onProgress({ batch: index + 1, batches: batches.length, answered: details.length, total: test.questions.length });
    const payload = buildAutoBatch(test, batches[index]);
    const httpResponse = await fetch("/api/system-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, ...payload }),
    });
    const response = await httpResponse.json();
    if (!httpResponse.ok) throw new Error(response.error || `第 ${index + 1} 批请求失败`);
    details.push(...decodeAutoBatch(batches[index], response));
    model = response.model;
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
  }

  const answers = Object.fromEntries(details.map((item) => [item.questionId, item.selectedValue]));
  const standard = test.score(answers);
  const elapsedMs = Math.round(performance.now() - startedAt);
  const averageConfidence = details.reduce((sum, item) => sum + item.confidence, 0) / details.length;
  onProgress({ batch: batches.length, batches: batches.length, answered: details.length, total: test.questions.length });
  return {
    standard,
    run: { model, inputTokens, outputTokens, elapsedMs, averageConfidence, batchCount: batches.length, details },
  };
}
