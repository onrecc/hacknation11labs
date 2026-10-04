/** Echo detection: does an expert utterance just repeat what the agent said? (the mic hears the agent's voice) */

const SHORT_REPLY_WORDS = 2;
const ECHO_HIT_RATIO = 0.7;

export function speechWords(text: string): readonly string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Whole-word match: "No" is not an echo of "I know" / "not now"; a short reply only echoes a whole agent sentence. */
export function looksLikeEcho(replyText: string, agentText: string): boolean {
  const words = speechWords(replyText);
  if (!words.length) return true;
  if (words.length <= SHORT_REPLY_WORDS) {
    const reply = words.join(" ");
    return agentText.split(/[.!?]+/).some((s) => speechWords(s).join(" ") === reply);
  }
  const agentWords = new Set(speechWords(agentText));
  const hit = words.filter((w) => agentWords.has(w)).length;
  return hit / words.length > ECHO_HIT_RATIO;
}
