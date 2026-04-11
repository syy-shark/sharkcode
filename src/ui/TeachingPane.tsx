import { Box, Text } from "ink";
import type { TeachingEvent } from "../teaching.ts";

interface TeachingPaneProps {
  events: TeachingEvent[];
  timedOut?: boolean;
}

export function TeachingPane({ events, timedOut }: TeachingPaneProps) {
  let state: "waiting" | "generating" | "done" | "empty" | "error" = "waiting";
  let text = "";

  for (const event of events) {
    if (event.type === "teaching-start") {
      state = "generating";
    } else if (event.type === "teaching-delta") {
      text += event.delta;
    } else if (event.type === "teaching-end") {
      state = text.length > 0 ? "done" : "empty";
    } else if (event.type === "teaching-error") {
      state = "error";
    }
  }

  let content: React.ReactNode;
  if (state === "waiting") {
    content = <Text dimColor>⏳ 等待 Agent 执行完成...</Text>;
  } else if (state === "generating") {
    content = (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text dimColor>📝 正在生成教学内容...</Text>
        </Box>
        <Text>{text}</Text>
      </Box>
    );
  } else if (state === "done") {
    content = <Text>{text}</Text>;
  } else if (state === "empty") {
    content = <Text color="green">✅ 本次执行无需特别讲解</Text>;
  } else if (state === "error") {
    content = <Text color="red">❌ 教学讲解暂时不可用</Text>;
  }

  if (timedOut) {
    content = <Text color="yellow">⏰ 教学生成超时，已自动退出</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="yellow">📚 教学讲解</Text>
      </Box>
      {content}
    </Box>
  );
}
