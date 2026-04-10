import { Box, Text } from "ink";
import type { TeachingEvent } from "../teaching.ts";

interface TeachingPaneProps {
  events: TeachingEvent[];
}

export function TeachingPane({ events }: TeachingPaneProps) {
  if (events.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
        <Box marginBottom={1}>
          <Text bold color="yellow">📚 教学讲解</Text>
        </Box>
        <Text dimColor>等待教学内容...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="yellow">📚 教学讲解</Text>
      </Box>
      <Box flexDirection="column">
        {events.map((event, index) => {
          const key = `${index}-${event.type}`;
          switch (event.type) {
            case "teaching-start":
              return null;
            case "teaching-delta":
              return <Text key={key}>{event.delta}</Text>;
            case "teaching-end":
              return null;
            case "teaching-error":
              return (
                <Text key={key} color="red">
                  教学讲解暂时不可用
                </Text>
              );
            default:
              return null;
          }
        })}
      </Box>
    </Box>
  );
}
