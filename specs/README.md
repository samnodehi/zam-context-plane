# Component and Prompt Plan Schemas

This directory contains the strict schemas that define how the Context Control Plane operates.

## Planned Schemas

- **`component.schema.json`**: Defines the structure of prompt components (e.g., scaffold, skills, tools), including their token approximations, risk levels, default actions, omission policies, and dependencies.
- **`selector-input.schema.json`**: Defines the input state provided to a selector (e.g., user request, available components, tools, history, capability).
- **`selector-output.schema.json`**: Defines the strict output structure expected from any selector (deterministic or model-assisted), focusing on safety, evidence, and fail-open behavior.
- **`prompt-plan.schema.json`**: The final assembled plan detailing which components are selected or omitted, budget plan, and risk flags, before any text string is concatenated.
- **`trace.schema.json`**: Explains the structure for tracing decisions (e.g., why a component was omitted or included, what selector made the decision, and what evidence supported it).
- **`evaluation-report.schema.json`**: The schema for automated test evaluations measuring safe omissions, false inclusions, privacy leakage, and fail-open correctness.
