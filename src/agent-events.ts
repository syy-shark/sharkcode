export type AgentEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: string }
  | { type: "tool-error"; toolName: string; error: string }
  | { type: "thinking-delta"; delta: string }
  | { type: "step-start"; stepIndex: number }
  | { type: "step-end"; stepIndex: number }
  | { type: "run-start" }
  | { type: "run-end"; interrupted: boolean }
  | { type: "error"; message: string };

type AgentEventListener = (event: AgentEvent) => void;

type GenerateResultToolCall = { toolName: string; args: unknown };
type GenerateResultToolResult = { toolName: string; result: unknown };
type GenerateResultToolError = { toolName: string; error: unknown };
type GenerateResultStep = {
  text?: string;
  toolCalls?: Array<GenerateResultToolCall>;
  toolResults?: Array<GenerateResultToolResult>;
  toolErrors?: Array<GenerateResultToolError>;
};

export class AgentEventBus {
  private readonly listeners = new Set<AgentEventListener>();

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AgentEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function getString(value: Record<string, unknown>, key: string): string | null {
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function getStepIndex(value: Record<string, unknown>): number {
  const stepIndex = value.stepIndex;
  return typeof stepIndex === "number" ? stepIndex : 0;
}

function getTextDelta(value: Record<string, unknown>): string | null {
  return getString(value, "textDelta") ?? getString(value, "text");
}

function hasStepContent(step: GenerateResultStep): boolean {
  return (step.text !== undefined && step.text !== "") ||
    (step.toolCalls?.length ?? 0) > 0 ||
    (step.toolResults?.length ?? 0) > 0 ||
    (step.toolErrors?.length ?? 0) > 0;
}

export function normalizeStreamEvent(rawEvent: unknown): AgentEvent | null {
  if (!isRecord(rawEvent)) {
    return null;
  }

  const type = getString(rawEvent, "type");
  if (type === null) {
    return null;
  }

  switch (type) {
    case "text-delta": {
      const delta = getTextDelta(rawEvent);
      return delta === null ? null : { type: "text-delta", delta };
    }

    case "tool-call": {
      const toolName = getString(rawEvent, "toolName");
      if (toolName === null || !hasOwn(rawEvent, "args")) {
        return null;
      }

      return { type: "tool-call", toolName, args: rawEvent.args };
    }

    case "tool-result": {
      const toolName = getString(rawEvent, "toolName");
      if (toolName === null || !hasOwn(rawEvent, "result")) {
        return null;
      }

      return { type: "tool-result", toolName, result: String(rawEvent.result) };
    }

    case "tool-error": {
      const toolName = getString(rawEvent, "toolName");
      if (toolName === null || !hasOwn(rawEvent, "error")) {
        return null;
      }

      return { type: "tool-error", toolName, error: String(rawEvent.error) };
    }

    case "reasoning":
    case "reasoning-delta": {
      const delta = getTextDelta(rawEvent);
      return delta === null ? null : { type: "thinking-delta", delta };
    }

    case "step-start":
    case "start-step":
      return { type: "step-start", stepIndex: getStepIndex(rawEvent) };

    case "step-finish":
    case "finish-step":
      return { type: "step-end", stepIndex: getStepIndex(rawEvent) };

    case "error": {
      if (!hasOwn(rawEvent, "error")) {
        return null;
      }

      return { type: "error", message: String(rawEvent.error) };
    }

    default:
      return null;
  }
}

export function normalizeGenerateResult(result: {
  text?: string;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
  toolResults?: Array<{ toolName: string; result: unknown }>;
  toolErrors?: Array<{ toolName: string; error: unknown }>;
  steps?: Array<{
    text?: string;
    toolCalls?: Array<{ toolName: string; args: unknown }>;
    toolResults?: Array<{ toolName: string; result: unknown }>;
    toolErrors?: Array<{ toolName: string; error: unknown }>;
  }>;
}): AgentEvent[] {
  const steps = result.steps && result.steps.length > 0
    ? result.steps
    : hasStepContent(result)
    ? [{ text: result.text, toolCalls: result.toolCalls, toolResults: result.toolResults, toolErrors: result.toolErrors }]
    : [];

  const events: AgentEvent[] = [{ type: "run-start" }];

  steps.forEach((step, stepIndex) => {
    events.push({ type: "step-start", stepIndex });

    if (step.text !== undefined && step.text !== "") {
      events.push({ type: "text-delta", delta: step.text });
    }

    for (const toolCall of step.toolCalls ?? []) {
      events.push({
        type: "tool-call",
        toolName: toolCall.toolName,
        args: toolCall.args,
      });
    }

    for (const toolResult of step.toolResults ?? []) {
      events.push({
        type: "tool-result",
        toolName: toolResult.toolName,
        result: String(toolResult.result),
      });
    }

    for (const toolError of step.toolErrors ?? []) {
      events.push({
        type: "tool-error",
        toolName: toolError.toolName,
        error: String(toolError.error),
      });
    }

    events.push({ type: "step-end", stepIndex });
  });

  events.push({ type: "run-end", interrupted: false });

  return events;
}
