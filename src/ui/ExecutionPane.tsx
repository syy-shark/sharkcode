import { Box, Text } from "ink";
import type { AgentEvent } from "../agent-events.ts";

interface ExecutionPaneProps {
  events: AgentEvent[];
}

export function ExecutionPane({ events }: ExecutionPaneProps) {
  const displayEvents = events.slice(-50);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="blue">⚡ 执行过程</Text>
      </Box>
      <Box flexDirection="column">
        {displayEvents.map((event, index) => {
          const key = `${index}-${event.type}`;
          switch (event.type) {
            case "text-delta":
              return <Text key={key}>{event.delta}</Text>;
            case "tool-call":
              return (
                <Text key={key} color="cyan">
                  🔧 {event.toolName} {JSON.stringify(event.args)}
                </Text>
              );
            case "tool-result": {
              const truncated =
                event.result.length > 50
                  ? event.result.substring(0, 50) + "..."
                  : event.result;
              return (
                <Text key={key} color="green">
                  ✓ {truncated}
                </Text>
              );
            }
            case "tool-error":
              return (
                <Text key={key} color="red">
                  ✗ {event.toolName}: {event.error}
                </Text>
              );
            case "thinking-delta":
              return (
                <Text key={key} color="gray" dimColor>
                  💭 {event.delta}
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
