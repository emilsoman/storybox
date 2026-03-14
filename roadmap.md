i want to build an app that creates live storybooks for kids which have interactive voice narration over generated images using the gemini api.

Features:

- User can talk to the agent to give a thread on the characters in the story and any details about the story.
- The agent will then create the storyboard for the next page of the storybook
- The agent will then "talk" using the live api while the image generation is happening.
- The user can turn on the camera and provide video/audio input which can change the upcoming page of the storybook.
- after the story is complete, the user can save the "live story" as a video.
- the user can create "prompts" which can be saved for generating new stories based on the prompts.

Tech stack:

- Should use the Gemini Gen AI SDK for calling prompts: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview#googlegenaisdk_quickstart-nodejs_genai_sdk
- Should use the gemini live api (https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk ) for live interaction.
