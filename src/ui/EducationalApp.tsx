import { Box, render, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentEventBus } from "../agent-events.ts";
import type { TeachingEvent, TeachingOrchestrator } from "../teaching.ts";
import { ExecutionPane } from "./ExecutionPane.tsx";
import { TeachingPane } from "./TeachingPane.tsx";

interface EducationalAppProps {
  eventBus: AgentEventBus;
  teachingOrchestrator: TeachingOrchestrator;
  onExit?: () => void;
  teachingTimeout?: number;
}

export function EducationalApp({
  eventBus,
  teachingOrchestrator,
  onExit,
  teachingTimeout = 30000,
}: EducationalAppProps) {
  const { exit } = useApp();
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [teachingEvents, setTeachingEvents] = useState<TeachingEvent[]>([]);
  const [runComplete, setRunComplete] = useState(false);
  const [teachingComplete, setTeachingComplete] = useState(false);
  const [teachingTimedOut, setTeachingTimedOut] = useState(false);
  const hasExitedRef = useRef(false);

  useEffect(() => {
    const unsubscribeAgent = eventBus.subscribe((event) => {
      setAgentEvents((prev) => [...prev, event]);
      if (event.type === "run-end") {
        setRunComplete(true);
      }
    });

    const unsubscribeTeaching = teachingOrchestrator.subscribe((event) => {
      setTeachingEvents((prev) => [...prev, event]);
      if (event.type === "teaching-end" || event.type === "teaching-error") {
        setTeachingComplete(true);
      }
    });

    return () => {
      unsubscribeAgent();
      unsubscribeTeaching();
    };
  }, [eventBus, teachingOrchestrator]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    if (runComplete && !teachingComplete) {
      timeoutId = setTimeout(() => {
        setTeachingTimedOut(true);
        setTeachingComplete(true);
      }, teachingTimeout);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [runComplete, teachingComplete, teachingTimeout]);

  useEffect(() => {
    if (!runComplete || !teachingComplete || hasExitedRef.current) {
      return;
    }

    hasExitedRef.current = true;
    onExit?.();
    exit();
  }, [runComplete, teachingComplete, onExit, exit]);

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
        <TeachingPane events={teachingEvents} timedOut={teachingTimedOut} />
      </Box>
    </Box>
  );
}

export function startEducationalApp(
  eventBus: AgentEventBus,
  teachingOrchestrator: TeachingOrchestrator,
  options?: { onExit?: () => void; teachingTimeout?: number }
): { unmount: () => void; waitUntilExit: () => Promise<unknown> } {
  const { unmount, waitUntilExit } = render(
    <EducationalApp
      eventBus={eventBus}
      teachingOrchestrator={teachingOrchestrator}
      onExit={options?.onExit}
      teachingTimeout={options?.teachingTimeout}
    />
  );
  return { unmount, waitUntilExit };
}
