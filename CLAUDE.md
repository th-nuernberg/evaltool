# Description

evaltool is a simple web-based tool that allows instructors to conduct an online teaching evaluation based on the Teaching Assessment Poll (TAP).
It maintains privacy by recording only anonymous feedback and storing it with the instructors client only, no server side cache.
It does a basic aggregation and visualization of initial Likert-scale questions, and uses LLMs (via openai-compatible API) to digest the freeform feedback, especially for the three TAP questions.

Find the requirements listed in `Requirements.md`