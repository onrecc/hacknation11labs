/**
 * The agent's voice. ElevenLabsVoice (ElevenAgents conversation) when an agent id + key are configured;
 * BrowserVoice (speechSynthesis) as the no-key fallback. Our code decides WHEN and WHAT; the agent voices it.
 */
import { Conversation } from "@elevenlabs/client";
import { voiceToken } from "../lib/api";

export interface Voice {
  readonly name: string;
  /** Speak this text now; resolves when finished speaking (best effort). */
  say(text: string): Promise<void>;
  /** Give the agent screen context without making it speak. */
  context(text: string): void;
  readonly speaking: boolean;
  stop(): Promise<void>;
}

export async function createVoice(agentId: string | undefined, onSpeaking: (s: boolean) => void): Promise<Voice> {
  if (agentId) {
    try {
      const { signedUrl } = await voiceToken("agent", agentId);
      if (signedUrl) return await ElevenLabsVoice.start(signedUrl, onSpeaking);
    } catch (e) {
      console.info("ElevenLabs agent unavailable, using browser voice:", (e as Error).message);
    }
  }
  return new BrowserVoice(onSpeaking);
}

export class BrowserVoice implements Voice {
  readonly name = "browser";
  speaking = false;
  constructor(private onSpeaking: (s: boolean) => void) {}
  say(text: string) {
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.onstart = () => ((this.speaking = true), this.onSpeaking(true));
      u.onend = u.onerror = () => ((this.speaking = false), this.onSpeaking(false), resolve());
      speechSynthesis.speak(u);
    });
  }
  context() {}
  async stop() {
    speechSynthesis.cancel();
  }
}

class ElevenLabsVoice implements Voice {
  readonly name = "elevenlabs";
  speaking = false;
  private waiters: Array<() => void> = [];
  private constructor(private conv: Awaited<ReturnType<typeof Conversation.startSession>>) {}

  static async start(signedUrl: string, onSpeaking: (s: boolean) => void): Promise<ElevenLabsVoice> {
    let self: ElevenLabsVoice | null = null;
    const conv = await Conversation.startSession({
      signedUrl,
      onModeChange: ({ mode }) => {
        if (!self) return;
        self.speaking = mode === "speaking";
        onSpeaking(self.speaking);
        if (!self.speaking) self.waiters.splice(0).forEach((w) => w());
      },
    });
    self = new ElevenLabsVoice(conv);
    return self;
  }

  say(text: string) {
    // ⚠️ Day-1 task (docs/capture.md): confirm the best way to make the agent speak a chosen line verbatim.
    // Current approach: a user-message nudge the agent's system prompt is instructed to read out verbatim.
    this.conv.sendUserMessage(`[SAY VERBATIM] ${text}`);
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, 20_000);
    });
  }
  context(text: string) {
    this.conv.sendContextualUpdate(text);
  }
  async stop() {
    await this.conv.endSession();
  }
}
