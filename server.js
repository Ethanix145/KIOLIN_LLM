import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import path from 'path';

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

const __dirname = path.resolve();
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const apiKeys = [
  '4b54efeb-32a8-46ee-9f1b-8d8254831032',
  'bf4237b8-177b-4595-b5af-92a29a162a0f',
  '9c4a6b25-cc62-4a63-8559-6d30256a8eb0',
  '7e5016f5-f850-4aa2-844f-2282bf6d923d',
  'da70f13a-31d9-47ea-82c8-f9fbebebd5e8',
];

// Updated API Configuration with correct model
const API_CONFIG = {
  model: 'Meta-Llama-3.1-8B-Instruct',  // Updated to correct model name
  baseURL: 'https://api.awanllm.com/v1/chat/completions', // Updated to chat completions endpoint
  maxTokens: 1000,
  temperature: 0.7
};

const rateLimits = apiKeys.map(() => ({
  requestsPerMinute: 0,
  requestsPerDay: 0,
  minuteResetTime: Date.now(),
  dayResetTime: Date.now(),
  lastError: null,
  consecutiveErrors: 0
}));

function getAvailableKey() {
  const currentTime = Date.now();
  let bestKey = null;
  let lowestUsage = Infinity;

  for (let i = 0; i < apiKeys.length; i++) {
    const limits = rateLimits[i];

    if (currentTime - limits.minuteResetTime > 60 * 1000) {
      limits.requestsPerMinute = 0;
      limits.minuteResetTime = currentTime;
    }

    if (currentTime - limits.dayResetTime > 24 * 60 * 60 * 1000) {
      limits.requestsPerDay = 0;
      limits.dayResetTime = currentTime;
    }

    if (limits.consecutiveErrors >= 3 && 
        currentTime - limits.lastError < 5 * 60 * 1000) {
      continue;
    }

    const usage = (limits.requestsPerMinute / 20) + (limits.requestsPerDay / 200);
    if (limits.requestsPerMinute < 20 && 
        limits.requestsPerDay < 200 && 
        usage < lowestUsage) {
      lowestUsage = usage;
      bestKey = { key: apiKeys[i], index: i };
    }
  }

  return bestKey;
}

const validateRequest = (req, res, next) => {
  const { message, chatHistory } = req.body;
  
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Message is required and must be a non-empty string' 
    });
  }

  if (chatHistory && !Array.isArray(chatHistory)) {
    return res.status(400).json({ 
      error: 'Chat history must be an array' 
    });
  }

  next();
};

app.post('/chat', validateRequest, async (req, res) => {
  const { message, chatHistory = [] } = req.body;

  const keyInfo = getAvailableKey();
  if (!keyInfo) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. Please try again later.',
      retryAfter: 60
    });
  }

  const { key, index } = keyInfo;

  try {
    // Updated request structure for the Llama model
    const requestBody = {
      model: API_CONFIG.model,
      messages: [
        {
          role: "user",
          content: message
        }
      ],
      temperature: API_CONFIG.temperature,
      max_tokens: API_CONFIG.maxTokens,
      stream: false
    };

    // Add chat history if it exists
    if (chatHistory.length > 0) {
      requestBody.messages = [...chatHistory, ...requestBody.messages];
    }

    console.log('Sending request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(API_CONFIG.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error Response:', errorData);
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('API Success Response:', data);

    rateLimits[index].consecutiveErrors = 0;
    rateLimits[index].lastError = null;
    rateLimits[index].requestsPerMinute += 1;
    rateLimits[index].requestsPerDay += 1;

    res.json({
      success: true,
      reply: data.choices?.[0]?.message?.content || 'No reply from AI',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing request:', error.message);
    
    rateLimits[index].consecutiveErrors += 1;
    rateLimits[index].lastError = Date.now();

    res.status(500).json({
      success: false,
      error: 'Failed to process the request',
      details: error.message,
      retryAfter: 5,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health', (req, res) => {
  const availableKeys = apiKeys.length - rateLimits.filter(limit => 
    limit.consecutiveErrors >= 3
  ).length;
  
  res.json({
    status: 'ok',
    availableKeys,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Using model: ${API_CONFIG.model}`);
});