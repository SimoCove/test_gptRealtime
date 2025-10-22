# Description

The application allows you to interact with **gpt-realtime** by voice.  
Responses are always transcribed into text format.  
You can enable or disable GPT’s voice responses by speaking the specified *wake word* or *sleep word*.  
The model can also answer questions about the loaded drawing.

# Preparation

1. Create a .env file and insert the following line in it:

```dotenv
VITE_OPENAI_API_KEY=your_OpenAI_api_key
```

2. Install dependencies

```bash
npm install
```

# Execution

```bash
npm start
```