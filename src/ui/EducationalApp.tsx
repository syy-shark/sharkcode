import { useState, useEffect } from "react";
import { Box, useApp, render } from "ink";
import type { AgentEventBus, AgentEvent } from "../agent-events.ts";
import type { TeachingOrchestrator, TeachingEvent } from "../teaching.ts";
import { ExecutionPane } from "./ExecutionPane.tsx";
import { TeachingPane } from "./TeachingPane.tsx";

interface EducationalAppProps {
  eventBus: AgentEventBus;
  teachingOrchestrator: TeachingOrchestrator;
  onExit?: () => void;
}

export function EducationalApp({
  eventBus,
  teachingOrchestrator,
  onExit,
}: EducationalAppProps) {
  const { exit } = useApp();
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [teachingEvents, setTeachingEvents] = useState<TeachingEvent[]>([]);

  useEffect(() => {
    const unsubscribeAgent = eventBus.subscribe((event) => {
      setAgentEvents((prev) => [...prev, event]);
      if (event.type === "run-end") {
        if (onExit) onExit();
        exit();
      }
    });

    const unsubscribeTeaching = teachingOrchestrator.subscribe((event) => {
      setTeachingEvents((prev) => [...prev, event]);
    });

    return () => {
      unsubscribeAgent();
      unsubscribeTeaching();
    };
  }, [eventBus, teachingOrchestrator, exit, onExit]);

  return (
    <Box flexDirection="row" height="100%">
      <Box
        flexDirection="column"
        width="50%"
        borderStyle="single"
        borderColor="blue"
        paddingX={1}
      >
        <ExecutionPane events={agentEvents} />
      </Box>
      <Box
        flexDirection="column"
        width="50%"
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
      >
        <TeachingPane events={teachingEvents} />
      </Box>
    </Box>
  );
}

export function startEducationalApp(
  eventBus: AgentEventBus,
  teachingOrchestrator: TeachingOrchestrator,
  options?: { onExit?: () => void }
): { unmount: () => void } {
  const { unmount } = render(
    <EducationalApp
      eventBus={eventBus}
      teachingOrchestrator={teachingOrchestrator}
      onExit={options?.onExit}
    />
  );
  return { unmount };
}
