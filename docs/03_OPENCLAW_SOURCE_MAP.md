# 03 OpenClaw Source Map

**Goal:** Map OpenClaw as a reference system, without mutating live state.

## 1. CLI Entrypoint
- **Files/Paths:**
- **Questions:** How are arguments parsed? How is the gateway or runner invoked?
- **Notes:**

## 2. Gateway / Service Flow
- **Files/Paths:**
- **Questions:** Does it run as a daemon? How does it proxy requests to the LLM? What headers/metadata are added?
- **Notes:**

## 3. Agent Command Path
- **Files/Paths:**
- **Questions:** What is the lifecycle of an `@agent` command? How does it spawn a session?
- **Notes:**

## 4. Embedded Runner
- **Files/Paths:**
- **Questions:** How is the execution loop managed? Is it synchronous or async? How are retries handled?
- **Notes:**

## 5. Prompt Assembly
- **Files/Paths:**
- **Questions:** Where exactly are the prompt pieces concatenated? How is the budget calculated? Is there any dynamic omission?
- **Notes:**

## 6. Workspace Injected Files
- **Files/Paths:**
- **Questions:** How are files like AGENTS.md, SOUL.md discovered? Are they cached?
- **Notes:**

## 7. AGENTS / SOUL / TOOLS / BOOTSTRAP Usage
- **Files/Paths:**
- **Questions:** When is each injected? Are they injected every turn? What triggers a skip?
- **Notes:**

## 8. Skill Inventory & Tool Registry
- **Files/Paths:**
- **Questions:** How are skills formatted for the LLM? Are they sent as system prompt or tools payload?
- **Notes:**

## 9. History / Session Storage
- **Files/Paths:**
- **Questions:** How is history persisted? When is it truncated or summarized?
- **Notes:**

## 10. Provider Adapters
- **Files/Paths:**
- **Questions:** How are different providers (OpenRouter, Gemini, OpenAI) abstracted? Are prompts formatted differently per provider?
- **Notes:**

## 11. Artifacts & Logging Behavior
- **Files/Paths:**
- **Questions:** Where are the logs and traces kept? Is the raw prompt payload available?
- **Notes:**

## 12. Error / Fallback Handling
- **Files/Paths:**
- **Questions:** What happens if the provider times out? What if the context window is exceeded?
- **Notes:**
