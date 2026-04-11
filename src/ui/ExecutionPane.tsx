import { Box, Text } from "ink";
import type { AgentEvent } from "../agent-events.ts";

export type AggregatedItem =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool-running"; toolName: string; args: unknown }
  | { type: "tool-done"; toolName: string; result: string }
  | { type: "tool-error"; toolName: string; error: string }
  | AgentEvent;

export function aggregateEvents(events: AgentEvent[]): AggregatedItem[] {
  const result: AggregatedItem[] = [];
  
  for (const event of events) {
    if (event.type === "text-delta") {
      const last = result[result.length - 1];
      if (last?.type === "text") {
        last.content += event.delta;
      } else {
        result.push({ type: "text", content: event.delta });
      }
    } else if (event.type === "thinking-delta") {
      const last = result[result.length - 1];
      if (last?.type === "thinking") {
        last.content += event.delta;
      } else {
        result.push({ type: "thinking", content: event.delta });
      }
    } else if (event.type === "tool-call") {
      result.push({ type: "tool-running", toolName: event.toolName, args: event.args });
    } else if (event.type === "tool-result") {
      let found = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const r = result[i];
        if (r && r.type === "tool-running" && r.toolName === event.toolName) {
          result[i] = { type: "tool-done", toolName: event.toolName, result: event.result };
          found = true;
          break;
        }
      }
      if (!found) {
        result.push({ type: "tool-done", toolName: event.toolName, result: event.result });
      }
    } else if (event.type === "tool-error") {
      let found = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const r = result[i];
        if (r && r.type === "tool-running" && r.toolName === event.toolName) {
          result[i] = { type: "tool-error", toolName: event.toolName, error: event.error };
          found = true;
          break;
        }
      }
      if (!found) {
        result.push({ type: "tool-error", toolName: event.toolName, error: event.error });
      }
    } else {
      result.push(event);
    }
  }
  
  return result;
}

interface ExecutionPaneProps {
  events: AgentEvent[];
}

export function ExecutionPane({ events }: ExecutionPaneProps) {
  const aggregatedEvents = aggregateEvents(events);
  const displayEvents = aggregatedEvents.slice(-50);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="blue">⚡ 执行过程</Text>
      </Box>
      <Box flexDirection="column">
        {displayEvents.map((event, index) => {
          const key = `${index}-${event.type}`;
          switch (event.type) {
            case "text":
              return <Text key={key}>{event.content}</Text>;
            case "thinking":
              return (
                <Text key={key} color="gray" dimColor>
                  💭 {event.content}
                </Text>
              );
            case "tool-running":
              return (
                <Text key={key} color="cyan">
                  🔧 正在执行: {event.toolName}...
                </Text>
              );
            case "tool-done": {
              const truncated =
                event.result.length > 50
                  ? event.result.substring(0, 50) + "..."
                  : event.result;
              return (
                <Text key={key} color="green">
                  ✓ {event.toolName}: {truncated}
                </Text>
              );
            }
            case "tool-error":
              return (
                <Text key={key} color="red">
                  ✗ {event.toolName}: {event.error}
                </Text>
              );
            case "run-start":
              return <Text key={key} dimColor>---</Text>;
            case "run-end":
              return (
                <Text key={key} dimColor>
                  — done —
                </Text>
              );
            case "error":
              return <Text key={key} color="red">Error: {event.message}</Text>;
            default:
              return null;
          }
        })}
      </Box>
    </Box>
  );
}
