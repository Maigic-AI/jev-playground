const HISTORY_KEY = "jev-pop-lab:history:v1";
const DRAFT_KEY = "jev-pop-lab:draft:v1";

export function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

export function saveResult(result) {
  const next = [result, ...readHistory().filter((item) => item.id !== result.id)].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function deleteResult(id) {
  const next = readHistory().filter((item) => item.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function saveDraft(draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); }
  catch { return null; }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}
