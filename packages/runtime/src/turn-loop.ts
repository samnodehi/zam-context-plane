// ============================================================================
// ZAM Runtime — Turn Loop Engine
// Canonical source: docs/24 §5.1
// Phase R5: Full tool execution + Subscriber Bus + Stuck Detector advisory.
// ============================================================================

import { createHash } from 'node:crypto';
import type {
  Session,
  UserRequest,
  RuntimeResult,
  ZamClient,
  ProviderClient,
  ProviderToolDefinition,
  Workspace,
  PermissionGate,
  ToolOutputOptimizer,
  OptimizerConfig,
  SubscriberBus,
  StuckDetectorState,
  ZamPlanContent,
  ModelResponseContent,
  ErrorContent,
  SystemEventContent,
  ToolCallContent,
  ToolResultContent,
  EventStreamEntry,
  EventType,
  EventContent,
  AnalyzerEventContent,
  SelectorEventContent,
  CompressorEventContent,
} from './types.js';
import { buildZamInput } from './history-state-builder.js';
import { assemblePrompt } from './prompt-assembler.js';
import { analyzeRequest } from './request-analyzer.js';
import { executeModelAssistedSelector } from './model-selector.js';
import { compressHistory } from './history-compressor.js';

/**
 * Run the Turn Loop Engine.
 *
 * Implements the algorithm from docs/24 §5.1:
 * - Steps 1–5a: Fail-safes, ZAM plan, prompt assembly, model call (Phase R2)
 * - Steps 6b–6c: No-progress detection for tool calls + sequential tool execution (Phase R3)
 * - Step 8: Re-entry with tool results
 *
 * @param session       Active session with EventStream
 * @param request       User's text request
 * @param zamClient     ZAM library API client
 * @param provider      Provider client (OpenRouter in Phase R2)
 * @param registry      Component registry for ZAM
 * @param workspace     Workspace for tool execution
 * @param permissionGate  Permission gate for tool approval
 * @param toolOptimizer Tool output optimizer
 * @param optimizerConfig Optional optimizer config overrides
 * @param subscriberBus  Optional subscriber bus for event observation
 * @param stuckDetectorState Optional stuck detector state for advisory check
 * @param toolDefinitions Optional tool schemas for provider function calling (Phase R6)
 */
export async function runLoop(
  session: Session,
  request: UserRequest,
  zamClient: ZamClient,
  provider: ProviderClient,
  registry: object,
  workspace?: Workspace,
  permissionGate?: PermissionGate,
  toolOptimizer?: ToolOutputOptimizer,
  optimizerConfig?: Partial<OptimizerConfig>,
  subscriberBus?: SubscriberBus,
  stuckDetectorState?: () => StuckDetectorState,
  toolDefinitions?: ProviderToolDefinition[],
): Promise<RuntimeResult> {
  let turnIndex = 0;
  const startTime = Date.now();
  let lastPlanHash: string | null = null;
  let lastEventCount = 0;
  let lastResponseText = '';
  let lastToolCallHash: string | null = null;

  // Step 0: Record user message
  const userEntry = session.eventStream.append({
    sessionId: session.sessionId,
    turnIndex: 0,
    type: 'user_message',
    content: { text: request.text, metadata: request.metadata ?? {} },
  });
  subscriberBus?.publish(userEntry);

  // Main loop
  while (true) {
    // Snapshot the current EventStream length before any work this iteration.
    // Used by Step 3b to distinguish genuine no-progress (plan AND history both
    // unchanged) from valid re-entry turns where new events exist (tool results,
    // errors) even though the plan structure hash is the same.
    const currentEventCount = session.eventStream.read().length;

    // Step 1: Check fail-safes
    if (turnIndex >= session.config.loop.maxTurns) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'system_event',
        content: {
          event: 'fail_safe_triggered',
          details: { reason: 'max_turns' },
        } satisfies SystemEventContent,
      });
      return {
        exitReason: 'max_turns',
        turnCount: turnIndex,
        finalResponse: lastResponseText || 'Maximum turns reached.',
        sessionId: session.sessionId,
      };
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= session.config.loop.timeoutMs) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'system_event',
        content: {
          event: 'fail_safe_triggered',
          details: { reason: 'timeout' },
        } satisfies SystemEventContent,
      });
      return {
        exitReason: 'timeout',
        turnCount: turnIndex,
        finalResponse: lastResponseText || 'Session timed out.',
        sessionId: session.sessionId,
      };
    }

    // Step 1b: Analyze request (Phase M1-D)
    const analyzerResult = session.config.analyzer
      ? await analyzeRequest(request.text, session.config.analyzer)
      : { output: null, tier: 0 as const, durationMs: 0, fallbackUsed: false };

    // Step 1c: Record analyzer result in EventStream
    appendAndPublish(session, subscriberBus, {
      sessionId: session.sessionId,
      turnIndex,
      type: 'system_event',
      content: {
        event: 'analyzer_completed',
        details: {
          analyzerVersion: analyzerResult.output?.analyzerVersion ?? 'none',
          tier: analyzerResult.tier,
          promptFamily: analyzerResult.output?.promptFamily ?? 'none',
          analyzerConfidence: analyzerResult.output?.analyzerConfidence ?? 0,
          durationMs: analyzerResult.durationMs,
          fallbackUsed: analyzerResult.fallbackUsed,
          fallbackReason: analyzerResult.fallbackReason,
        } satisfies AnalyzerEventContent as unknown as Record<string, unknown>,
      } satisfies SystemEventContent,
    });

    // Step 1d: Compress history if needed (Phase M3-D)
    // Canonical: docs/27 §9.1. Runs once per turn before building ZAM input.
    // compressHistory is fail-open: on any error it returns output=null.
    const previousCachedResult = session.cachedCompressorResult;
    const compressorResult = session.config.compressor
      ? await compressHistory(
          session.eventStream.read(),
          session.sessionId,
          session.config.compressor,
          session.cachedCompressorResult,
        )
      : null;

    // Detect if the result was served from cache (same object reference)
    const wasCached = compressorResult !== null && compressorResult === previousCachedResult;

    // Update session cache for next turn
    session.cachedCompressorResult = compressorResult;

    // Step 1e: Record compressor result in EventStream
    if (session.config.compressor) {
      const totalRawTokens = compressorResult?.output?.totalRawTokensApprox ?? 0;
      const compressedTokens = compressorResult?.output?.compressedTokensApprox ?? 0;
      const compressionRatio = totalRawTokens > 0 ? 1 - (compressedTokens / totalRawTokens) : 0;

      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'system_event',
        content: {
          event: 'compressor_completed',
          details: {
            compressorVersion: session.config.compressor.provider.model,
            compressed: compressorResult?.compressed ?? false,
            totalRawTokens,
            compressedTokens,
            compressionRatio,
            rawWindowSize: compressorResult?.rawTurnWindow?.length ?? 0,
            confidenceScore: compressorResult?.output?.compressionConfidence ?? 0,
            failOpenTriggered: compressorResult?.output?.failOpenTriggered ?? false,
            durationMs: compressorResult?.durationMs ?? 0,
            fallbackUsed: compressorResult?.fallbackUsed ?? false,
            fallbackReason: compressorResult?.fallbackReason,
            cachedResult: wasCached,
            protectedCategories: compressorResult?.output?.protectedCategoriesRetained ?? [],
          } satisfies CompressorEventContent as unknown as Record<string, unknown>,
        } satisfies SystemEventContent,
      });
    }

    // Step 2: Build ZAM input
    let zamInput;
    try {
      zamInput = buildZamInput(session.eventStream, request, registry, session.config, compressorResult, analyzerResult.output);
    } catch (buildError) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'error',
        content: {
          errorType: 'internal_error',
          message: (buildError as Error).message,
          recoverable: false,
        } satisfies ErrorContent,
      });
      return {
        exitReason: 'error',
        turnCount: turnIndex,
        finalResponse: 'Internal error building context.',
        sessionId: session.sessionId,
      };
    }

    // Step 3: Call ZAM POST /plan
    let zamResponse;
    try {
      zamResponse = await zamClient.plan(zamInput);
    } catch (zamError) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'error',
        content: {
          errorType: 'zam_error',
          message: (zamError as Error).message,
          recoverable: false,
        } satisfies ErrorContent,
      });
      return {
        exitReason: 'error',
        turnCount: turnIndex,
        finalResponse: 'Context planning failed.',
        sessionId: session.sessionId,
      };
    }

    // Step 3 (M2-D): Model-Assisted Selector — two-pass architecture
    // Canonical: docs/26 §5, §10
    if (session.config.selector?.enabled) {
      // Identify unresolved components from the deterministic trace
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const traceData = zamResponse.trace as any;
      const selectorTrace: Array<{
        componentId: string;
        action: string;
        confidence: string;
        failOpen: boolean;
        evidence: string[];
      }> = traceData?.selectorPhase?.selectorTrace || [];

      // Unresolved criteria from docs/26 §10:
      // - fail_open (Steps 11/12): TraceEntry.failOpen === true
      // - default_include (Step 9): action=include, failOpen=false, confidence=medium,
      //   and NOT conflict_include (which has 'conflict=true' in evidence)
      const unresolvedIds = selectorTrace
        .filter((t) => {
          if (t.failOpen) return true;
          if (
            t.action === 'include' &&
            !t.failOpen &&
            t.confidence === 'medium' &&
            !t.evidence?.includes('conflict=true')
          ) return true;
          return false;
        })
        .map((t) => t.componentId);

      if (unresolvedIds.length > 0) {
        // Build unresolved components JSON from registry metadata
        const registryArray = Array.isArray(registry) ? (registry as Array<Record<string, unknown>>) : [];
        const unresolvedComponents = unresolvedIds
          .map((id: string) => {
            const comp = registryArray.find((c) => c.id === id);
            if (!comp) return null;
            return {
              id: comp.id,
              type: comp.type,
              description: comp.summary || comp.description || '',
              tags: Array.isArray(comp.tags) ? comp.tags : [],
            };
          })
          .filter((c: unknown): c is Record<string, unknown> => c !== null);

        // Extract analyzer output fields (safe fallbacks if analyzer didn't run)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ao = analyzerResult?.output as any;
        const selectorData = {
          requestText: request.text,
          promptFamily: ao?.promptFamily ?? 'unknown',
          analyzerConfidence: ao?.analyzerConfidence ?? 0,
          neededLanes: Array.isArray(ao?.neededLanes) ? ao.neededLanes : [],
          assessedRequestRiskLevel: ao?.assessedRequestRiskLevel ?? 'unknown',
          unresolvedComponentsJson: JSON.stringify(unresolvedComponents),
        };

        // Execute the model-assisted selector
        const selectorResult = await executeModelAssistedSelector(
          provider,
          session.config.selector,
          selectorData,
        );

        // Record model_selector_completed event
        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'system_event',
          content: {
            event: 'model_selector_completed',
            details: {
              selectorVersion: session.config.selector.provider.model,
              unresolvedCount: unresolvedIds.length,
              proposalCount: selectorResult.proposals.length,
              changedCount: selectorResult.proposals.filter(
                (p) => p.action !== 'include',
              ).length,
              durationMs: selectorResult.durationMs,
              fallbackUsed: selectorResult.fallbackUsed,
              fallbackReason: selectorResult.fallbackReason,
            } satisfies SelectorEventContent as unknown as Record<string, unknown>,
          } satisfies SystemEventContent,
        });

        // Second pass: re-run ZAM core with model proposals if any changes
        if (!selectorResult.fallbackUsed && selectorResult.proposals.length > 0) {
          const zamInput2 = buildZamInput(session.eventStream, request, registry, session.config, undefined, analyzerResult.output);
          zamInput2.modelSelectorOutputs = [{
            selectorName: 'model_assisted_context_selector',
            proposals: selectorResult.proposals,
          }];

          try {
            zamResponse = await zamClient.plan(zamInput2);
          } catch (zamError2) {
            // Second pass failure is non-fatal — keep the first pass result
            appendAndPublish(session, subscriberBus, {
              sessionId: session.sessionId,
              turnIndex,
              type: 'system_event',
              content: {
                event: 'fail_safe_triggered',
                details: { reason: 'model_selector_second_pass_failed', error: (zamError2 as Error).message },
              } satisfies SystemEventContent,
            });
          }
        }
      }
    }

    // Step 3a: Record ZAM plan in EventStream
    appendAndPublish(session, subscriberBus, {
      sessionId: session.sessionId,
      turnIndex,
      type: 'zam_plan',
      content: {
        runId: zamResponse.trace.run.runId,
        promptPlan: zamResponse.promptPlan,
        trace: zamResponse.trace,
        summary: zamResponse.summary,
        isReentry: turnIndex > 0,
      } satisfies ZamPlanContent,
    });

    // Step 3b: No-progress detection (plan hash + event count).
    // A plan hash match alone is not sufficient to declare no-progress:
    // on valid re-entry turns, new tool results or errors are appended to the
    // EventStream between iterations, changing currentEventCount even when the
    // component selection (plan structure) remains the same.
    // The guard fires only when BOTH the plan structure AND the event stream
    // are fully unchanged — indicating the loop is genuinely stuck.
    // Canonical: docs/28 §4 I-5 fix.
    const planHash = hashObject(zamResponse.promptPlan);
    if (planHash === lastPlanHash && currentEventCount === lastEventCount) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'system_event',
        content: {
          event: 'fail_safe_triggered',
          details: { reason: 'no_progress_plan' },
        } satisfies SystemEventContent,
      });
      return {
        exitReason: 'no_progress',
        turnCount: turnIndex,
        finalResponse: lastResponseText || 'No progress detected — plan unchanged.',
        sessionId: session.sessionId,
      };
    }
    lastPlanHash = planHash;
    lastEventCount = currentEventCount;

    // Step 4: Assemble prompt from plan
    // Phase R6: Pass user request text, tool definitions, and EventStream
    // history for multi-turn conversation replay.
    const history = session.eventStream.read();
    const assembledPrompt = assemblePrompt(zamResponse.promptPlan, request.text, toolDefinitions, history);

    // Step 5: Call model provider
    let providerResponse;
    try {
      providerResponse = await provider.chat({
        messages: assembledPrompt.messages,
        tools: assembledPrompt.tools,
        model: session.config.provider.model,
        cacheHints: assembledPrompt.cacheHints,
      });
    } catch (providerError) {
      appendAndPublish(session, subscriberBus, {
        sessionId: session.sessionId,
        turnIndex,
        type: 'error',
        content: {
          errorType: 'provider_error',
          message: (providerError as Error).message,
          recoverable: true,
        } satisfies ErrorContent,
      });
      // Provider errors are recoverable — re-enter ZAM with error in history
      turnIndex++;
      continue;
    }

    // Step 5a: Record model response in EventStream
    appendAndPublish(session, subscriberBus, {
      sessionId: session.sessionId,
      turnIndex,
      type: 'model_response',
      content: {
        type: providerResponse.type,
        text: providerResponse.text,
        toolCalls: providerResponse.toolCalls,
        usage: providerResponse.usage,
        providerName: session.config.provider.name,
        model: session.config.provider.model,
      } satisfies ModelResponseContent,
    });

    // Step 5b: Check stuck detector advisory (Phase R5)
    if (stuckDetectorState) {
      const detectorState = stuckDetectorState();
      if (detectorState.isStuck) {
        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'system_event',
          content: {
            event: 'fail_safe_triggered',
            details: { reason: 'stuck_detector_advisory' },
          } satisfies SystemEventContent,
        });
        return {
          exitReason: 'no_progress',
          turnCount: turnIndex,
          finalResponse: lastResponseText || 'No progress detected — stuck detector advisory.',
          sessionId: session.sessionId,
        };
      }
    }

    // Step 6: Parse model response
    if (providerResponse.type === 'text') {
      // Step 6a: Text answer — deliver to user, end loop
      lastResponseText = providerResponse.text ?? '';
      return {
        exitReason: 'completed',
        turnCount: turnIndex + 1,
        finalResponse: lastResponseText,
        sessionId: session.sessionId,
      };
    }

    if (providerResponse.type === 'tool_call') {
      // Check if tool infrastructure is available
      if (!workspace || !permissionGate || !toolOptimizer) {
        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'error',
          content: {
            errorType: 'internal_error',
            message: 'Tool execution not available — workspace, permissionGate, or toolOptimizer not provided.',
            recoverable: false,
            details: {
              toolCalls: providerResponse.toolCalls,
            },
          } satisfies ErrorContent,
        });
        return {
          exitReason: 'error',
          turnCount: turnIndex + 1,
          finalResponse: 'Tool execution not available.',
          sessionId: session.sessionId,
        };
      }

      // Step 6b: No-progress detection (tool call response hash)
      const toolCallHash = hashObject(providerResponse.toolCalls);
      if (toolCallHash === lastToolCallHash) {
        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'system_event',
          content: {
            event: 'fail_safe_triggered',
            details: { reason: 'no_progress_tool' },
          } satisfies SystemEventContent,
        });
        return {
          exitReason: 'no_progress',
          turnCount: turnIndex,
          finalResponse: lastResponseText || 'No progress detected — identical tool calls.',
          sessionId: session.sessionId,
        };
      }
      lastToolCallHash = toolCallHash;

      // Step 6c: Execute each tool call sequentially
      const toolCalls = providerResponse.toolCalls ?? [];
      for (const toolCall of toolCalls) {
        // Step 6c-i: Permission gate
        const permResult = await permissionGate.check(toolCall, session);

        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'tool_call',
          content: {
            callId: toolCall.callId,
            toolName: toolCall.toolName,
            arguments: toolCall.arguments,
            permissionResult: permResult,
          } satisfies ToolCallContent,
        });

        if (!permResult.allowed) {
          // Permission denied — record tool_result with error
          appendAndPublish(session, subscriberBus, {
            sessionId: session.sessionId,
            turnIndex,
            type: 'tool_result',
            content: {
              callId: toolCall.callId,
              toolName: toolCall.toolName,
              success: false,
              output: '',
              error: `Permission denied: ${permResult.reason}`,
              truncated: false,
              rawOutputLength: 0,
              durationMs: 0,
            } satisfies ToolResultContent,
          });
          appendAndPublish(session, subscriberBus, {
            sessionId: session.sessionId,
            turnIndex,
            type: 'error',
            content: {
              errorType: 'permission_denied',
              message: `Permission denied for ${toolCall.toolName}: ${permResult.reason}`,
              recoverable: true,
            } satisfies ErrorContent,
          });
          continue;
        }

        // Step 6c-ii: Execute via Workspace
        let rawObservation;
        try {
          rawObservation = await workspace.execute(toolCall);
        } catch (toolError) {
          appendAndPublish(session, subscriberBus, {
            sessionId: session.sessionId,
            turnIndex,
            type: 'tool_result',
            content: {
              callId: toolCall.callId,
              toolName: toolCall.toolName,
              success: false,
              output: '',
              error: (toolError as Error).message,
              truncated: false,
              rawOutputLength: 0,
              durationMs: 0,
            } satisfies ToolResultContent,
          });
          appendAndPublish(session, subscriberBus, {
            sessionId: session.sessionId,
            turnIndex,
            type: 'error',
            content: {
              errorType: 'tool_error',
              message: (toolError as Error).message,
              recoverable: true,
            } satisfies ErrorContent,
          });
          continue;
        }

        // Step 6c-iii: Optimize output
        const optimized = toolOptimizer.optimize(rawObservation, optimizerConfig ?? {});

        // Step 6c-iv: Record tool result in EventStream
        appendAndPublish(session, subscriberBus, {
          sessionId: session.sessionId,
          turnIndex,
          type: 'tool_result',
          content: {
            callId: toolCall.callId,
            toolName: toolCall.toolName,
            success: rawObservation.success,
            output: optimized.content,
            rawOutputLength: optimized.originalChars,
            truncated: optimized.truncated,
            durationMs: rawObservation.durationMs,
            error: rawObservation.error,
          } satisfies ToolResultContent,
        });

        // Record tool_error event for failed executions (non-exception failures)
        if (!rawObservation.success) {
          appendAndPublish(session, subscriberBus, {
            sessionId: session.sessionId,
            turnIndex,
            type: 'error',
            content: {
              errorType: 'tool_error',
              message: rawObservation.error ?? `Tool ${toolCall.toolName} failed`,
              recoverable: true,
            } satisfies ErrorContent,
          });
        }
      }

      // Step 8: Re-enter loop
      turnIndex++;
      continue;
    }

    // Unexpected response type — should not happen
    return {
      exitReason: 'error',
      turnCount: turnIndex + 1,
      finalResponse: 'Unexpected model response type.',
      sessionId: session.sessionId,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash of an object for no-progress detection.
 * Per docs/24 §5.1 Step 3b and §5.2.
 */
function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Append an event to the EventStream and publish to the SubscriberBus.
 * Helper to avoid repetition across all event recording points.
 */
function appendAndPublish(
  session: Session,
  bus: SubscriberBus | undefined,
  entry: {
    sessionId: string;
    turnIndex: number;
    type: EventType;
    content: EventContent;
  },
): EventStreamEntry {
  const fullEntry = session.eventStream.append(entry);
  bus?.publish(fullEntry);
  return fullEntry;
}
