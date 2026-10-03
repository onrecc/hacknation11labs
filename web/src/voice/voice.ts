/**
 * The agent's voice, in order of preference:
 *  1. AgentVoice — ElevenAgents conversation (interviewer / tutor). Our code decides WHEN to speak and sends a
 *     control message ([ASK]/[SAY]/[INTERVENE]/[PREDICT]); the agent phrases it, listens to the answer and may ask
 *     one follow-up. Its mic is muted while the human works (Scribe transcribes everything independently).
 *  2. TtsVoice — ElevenLabs TTS (Flash v2.5) through the api (/tts).
 *  3. BrowserVoice — speechSynthesis.
 */
import { Conversation } from "@elevenlabs/client";
import { voiceToken, tts } from "../lib/api";

export interface SpokenTurn {
  text: string;
  /** true when the agent spoke on its own (follow-up/answer), not because we asked it to. */
  spontaneous: boolean;
}

export interface VoiceEvents {
  onSpeaking: (speaking: boolean) => void;
  /** Every agent utterance with its real text (for the session log). */
  onAgentTurn?: (turn: SpokenTurn) => void;
  onStatus?: (status: string) => void;
}

export interface Voice {
  readonly name: string;
  readonly speaking: boolean;
  /** Agent asks this (rephrasing allowed). Resolves with what was actually said, after it finished speaking. */
  ask(question: string): Promise<string>;
  /** Agent says exactly this. */
  say(text: string): Promise<string>;
  /** Raw control message for agent-specific modes ([INTERVENE] …, [PREDICT] …). Falls back to saying `fallbackText`. */
  control(message: string, fallbackText: string): Promise<string>;
  /** Screen/app context; never spoken. */
  context(text: string): void;
  /** Whether the agent hears the human (mic). */
  listen(on: boolean): void;
  stop(): Promise<void>;
}

export interface AgentOptions {
  agentId?: string;
  dynamicVariables?: Record<string, string | number | boolean>;
  clientTools?: Record<string, (params: Record<string, unknown>) => Promise<string> | string>;
}

export async function createVoice(opts: AgentOptions, ev: VoiceEvents): Promise<Voice> {
  if (opts.agentId) {
    try {
      const { signedUrl } = await voiceToken("agent", opts.agentId);
      if (signedUrl) return await AgentVoice.start(signedUrl, opts, ev);
    } catch (e) {
      console.warn("ElevenAgents unavailable, falling back to TTS:", (e as Error).message);
    }
  }
  try {
    await tts("ok"); // probe
    return new TtsVoice(ev);
  } catch {
    return new BrowserVoice(ev);
  }
}

class AgentVoice implements Voice {
  readonly name = "elevenagents";
  speaking = false;
  private conv!: Awaited<ReturnType<typeof Conversation.startSession>>;
  private expecting = 0; // control messages whose spoken reply hasn't arrived yet
  private lastText = "";
  /** Turns we asked for, resolved in order: a turn ends when the agent started speaking and then stopped. */
  private turns: Array<{ started: boolean; resolve: (t: string) => void }> = [];

  private constructor(private ev: VoiceEvents) {}

  static async start(signedUrl: string, opts: AgentOptions, ev: VoiceEvents): Promise<AgentVoice> {
    const v = new AgentVoice(ev);
    v.conv = await Conversation.startSession({
      signedUrl,
      dynamicVariables: opts.dynamicVariables,
      clientTools: opts.clientTools,
      onMessage: (m) => {
        if (m.role !== "agent" || !m.message) return;
        m = { ...m, message: stripAudioTags(m.message) }; // expressive v3 tags like [slow] are for the voice, not the transcript
        const spontaneous = v.expecting === 0;
        if (!spontaneous) v.expecting--;
        v.lastText = m.message;
        ev.onAgentTurn?.({ text: m.message, spontaneous });
      },
      onModeChange: ({ mode }) => v.onMode(mode === "speaking"),
      onStatusChange: ({ status }) => ev.onStatus?.(status),
      onError: (message) => console.warn("agent error", message),
    });
    v.conv.setMicMuted(true);
    return v;
  }

  private onMode(speaking: boolean) {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    this.ev.onSpeaking(speaking);
    const head = this.turns[0];
    if (!head) return;
    if (speaking) head.started = true;
    else if (head.started) {
      this.turns.shift();
      head.resolve(this.lastText);
    }
  }

  private send(message: string): Promise<string> {
    this.expecting++;
    this.conv.sendUserMessage(message);
    return new Promise<string>((resolve) => {
      const turn = { started: false, resolve };
      this.turns.push(turn);
      setTimeout(() => {
        const i = this.turns.indexOf(turn);
        if (i >= 0) (this.turns.splice(i, 1), resolve(this.lastText)); // agent stayed silent (e.g. skip_turn)
      }, 25_000);
    });
  }

  ask(q: string) {
    return this.send(`[ASK] ${q}`);
  }
  say(text: string) {
    return this.send(`[SAY] ${text}`);
  }
  control(message: string) {
    return this.send(message);
  }
  context(text: string) {
    this.conv.sendContextualUpdate(text);
  }
  listen(on: boolean) {
    this.conv.setMicMuted(!on);
  }
  async stop() {
    await this.conv.endSession();
  }
}

class TtsVoice implements Voice {
  readonly name = "elevenlabs-tts";
  speaking = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ev: VoiceEvents) {}
  private speak(text: string): Promise<string> {
    const run = async () => {
      const blob = await tts(text);
      const a = new Audio(URL.createObjectURL(blob));
      this.speaking = true;
      this.ev.onSpeaking(true);
      this.ev.onAgentTurn?.({ text, spontaneous: false });
      await new Promise<void>((res) => {
        a.onended = a.onerror = () => res();
        void a.play().catch(() => res());
      });
      this.speaking = false;
      this.ev.onSpeaking(false);
      return text;
    };
    const p = this.queue.then(run, run);
    this.queue = p;
    return p;
  }
  ask(q: string) { return this.speak(q); }
  say(t: string) { return this.speak(t); }
  control(_m: string, fallbackText: string) { return this.speak(fallbackText); }
  context() {}
  listen() {}
  async stop() {}
}

export class BrowserVoice implements Voice {
  readonly name = "browser";
  speaking = false;
  constructor(private ev: VoiceEvents) {}
  private speak(text: string) {
    return new Promise<string>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onstart = () => ((this.speaking = true), this.ev.onSpeaking(true), this.ev.onAgentTurn?.({ text, spontaneous: false }));
      u.onend = u.onerror = () => ((this.speaking = false), this.ev.onSpeaking(false), resolve(text));
      speechSynthesis.speak(u);
      setTimeout(() => resolve(text), 30_000);
    });
  }
  ask(q: string) { return this.speak(q); }
  say(t: string) { return this.speak(t); }
  control(_m: string, fallbackText: string) { return this.speak(fallbackText); }
  context() {}
  listen() {}
  async stop() { speechSynthesis.cancel(); }
}

/** Remove eleven_v3 audio tags ("[excited]", "[slow]") from agent text. */
export const stripAudioTags = (t: string) => t.replace(/\[[a-z][a-z ]{1,24}\]\s*/gi, "").replace(/\s{2,}/g, " ").trim();
