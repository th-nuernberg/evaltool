Check out this polling tool: https://github.com/albrechtje/quiqui

In a similar style and workflow, design a browser-only teaching evaluation tool based on the Teaching Analysis Poll (https://www.dghd.de/blog/teaching-analysis-poll-tap/).

Here are some requirements:
- R1: The tool will be hosted on https://kiz1.in.ohmportal.de via docker compose, but each session has to be anonymous. For dev purposes, have a local `make dev` variant.
- R2: The instructor needs to provide a name for the poll (which will typically be a lecture name). The evaluation also needs a term name, which will be either "Sommersemester {year}" (if the evaluation falls in between March 15 and Sept 30 of {year}) or "Wintersemester {year}" (if the evaluation falls in between Oct 1 of {year} and March 14 of the following year).
- R3: There will be a openai-compatible (vllm) LLM instance provided, with the access credentials provided via env. Make a fallback stub so that the app won't break, but have "LLM not available at present" for evaluation.
- R4: There should be a configurable set of initial questions, similar to quiqui. I will provide examples later, for now assume they are yaml based and consisting of Likert-scales and freeform.
- R5: The responses should only be accrued and stored at the lecturer's client (use localstorage); they can download aggregated responses (in CSV format) for their record and later analysis.
- R6: On completion, 
	- provide a basic chart-based analysis of the Likert scales
	- summarize the freeform questions using the vllm instance. Make the system prompt configurable but provide a good default.
	- Put the three TAP questions in separate sections. Design special assessment prompts based on the theory and motivation of TAP (see the initally referenced website).
	- To the instructor's eyes only, use all student feedback to draft conclusions for the following questions. Design a configurable suitable system prompt for each, and use the vllm to obtain the drafts.
		1. Lehrinhalte
		2. Strukturierung der Lehrinhalte
		3. Darbietung der Lehrinhalte
		4. Workload der Studierenden
- R7: For the lecturer, provide a "Digest feedback" view, where the lecturer has to revise the four conclusions before being able to download a report that contains the date of the poll as well as the number of participants along the conclusions. After download, this will be emailed to the dean of studies.
