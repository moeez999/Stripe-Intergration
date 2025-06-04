const express = require('express');
const router = express.Router();
const axios = require('axios');
const dotenv = require('dotenv');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Load environment variables
dotenv.config();

// Verify Firework API key is present
if (!process.env.FIREWORK_API_KEY) {
    console.error('FIREWORK_API_KEY is missing from environment variables');
    throw new Error('FIREWORK_API_KEY is required');
}

// Initialize Firework API configuration
const FIREWORK_API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const FIREWORK_API_KEY = process.env.FIREWORK_API_KEY;

// Helper functions for redundancy detection
const FILLER_WORDS = new Set(['um', 'uh', 'like', 'you know', 'i mean', 'basically', 'actually', 'sort of', 'kind of', 'well', 'so', 'and', 'but']);
const RETRY_PHRASES = [
    'let me try that again',
    'wait no',
    'actually',
    'sorry',
    'what i meant was',
    'i mean',
    'let me rephrase',
    'let me start over',
    'and here we are',
    'fast forward'
];

function normalizeText(text) {
    return text
        .toLowerCase()
        // Remove punctuation
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        // Split into words, filter out filler words, and rejoin
        .split(/\s+/)
        .filter(word => !FILLER_WORDS.has(word))
        .join(' ')
        .trim();
}

function tokenize(text) {
    return new Set(normalizeText(text).split(/\s+/));
}

function jaccard(str1, str2) {
    const set1 = tokenize(str1);
    const set2 = tokenize(str2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

function findRedundancyClusters(segments) {
    const clusters = [];
    const SIMILARITY_THRESHOLD = 0.4;
    const WINDOW_SIZE = 5;
    const TIME_WINDOW_AFTER_RETRY = 15; // seconds
    
    // Helper to convert timestamp string to seconds
    const timeToSeconds = (timeStr) => {
        const [h, m, s] = timeStr.split(':').map(Number);
        return h * 3600 + m * 60 + s;
    };

    // Helper to check if a segment elaborates on a previous one
    function isElaboration(seg1, seg2) {
        const words1 = new Set(normalizeText(seg1).split(/\s+/));
        const words2 = normalizeText(seg2).split(/\s+/);
        let commonWords = 0;
        for (const word of words2) {
            if (words1.has(word)) commonWords++;
        }
        return commonWords >= 2 && words2.length > words1.size;
    }

    // Helper to check if segment is already in a cluster
    const isSegmentInClusters = (segment) => {
        return clusters.some(cluster => 
            cluster.some(s => 
                s.start === segment.start && 
                s.end === segment.end && 
                s.text === segment.text
            )
        );
    };
    
    // First pass: Find similar segments and elaborations
    for (let i = 0; i < segments.length; i++) {
        // Skip if this segment is already in a cluster
        if (isSegmentInClusters(segments[i])) continue;

        const currentCluster = [segments[i]];
        let hasElaboration = false;
        
        // Look ahead within window
        for (let j = i + 1; j < Math.min(i + WINDOW_SIZE, segments.length); j++) {
            // Skip if this segment is already in a cluster
            if (isSegmentInClusters(segments[j])) continue;

            const similarity = jaccard(segments[i].text, segments[j].text);
            const isElab = isElaboration(segments[i].text, segments[j].text);
            
            if (similarity >= SIMILARITY_THRESHOLD || isElab) {
                currentCluster.push(segments[j]);
                if (isElab) hasElaboration = true;
            }
        }
        
        if (currentCluster.length > 1 || hasElaboration) {
            clusters.push(currentCluster);
        }
    }
    
    // Second pass: Look for retry phrases and self-corrections
    for (let i = 0; i < segments.length; i++) {
        // Skip if this segment is already in a cluster
        if (isSegmentInClusters(segments[i])) continue;

        const normalizedText = segments[i].text.toLowerCase();
        const hasRetryPhrase = RETRY_PHRASES.some(phrase => normalizedText.includes(phrase));
        
        if (hasRetryPhrase) {
            const retryCluster = [segments[i]];
            const startTime = timeToSeconds(segments[i].end);
            
            // Look ahead for segments within time window
            for (let j = i + 1; j < segments.length; j++) {
                // Skip if this segment is already in a cluster
                if (isSegmentInClusters(segments[j])) continue;

                const segmentTime = timeToSeconds(segments[j].start);
                if (segmentTime - startTime <= TIME_WINDOW_AFTER_RETRY) {
                    retryCluster.push(segments[j]);
                } else {
                    break;
                }
            }
            
            if (retryCluster.length > 1) {
                clusters.push(retryCluster);
            }
        }
    }
    
    return clusters;
}

router.post('/', async (req, res) => {
    try {
        const { prompt, transcription, detectionType } = req.body;

        // Only require transcription and detectionType
        if (!transcription || !detectionType) {
            return res.status(400).json({
                error: 'Missing required parameters: transcription and detectionType are required'
            });
        }

        // Only require prompt for custom mode
        if (detectionType === 'custom' && !prompt) {
            return res.status(400).json({
                error: 'Prompt is required for custom detection mode'
            });
        }

        // Clean transcription data before sending to the model
        const cleanTranscription = (segments, detectionType) => {
            // First step: Always group by sentences for all modes
            let currentSentence = {
                start: null,
                end: null,
                text: ''
            };
            const sentences = [];
            
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                const text = segment.text.trim();
                
                // Skip empty segments
                if (!text) continue;
                
                // Initialize current sentence if needed
                if (currentSentence.start === null) {
                    currentSentence.start = segment.start;
                }
                
                // Add text to current sentence
                currentSentence.text += (currentSentence.text ? ' ' : '') + text;
                
                // Check if this segment ends with a sentence-ending punctuation
                if (text.match(/[.!?]$/)) {
                    currentSentence.end = segment.end;
                    sentences.push({ ...currentSentence });
                    // Reset for next sentence
                    currentSentence = {
                        start: null,
                        end: null,
                        text: ''
                    };
                } else {
                    // Update end time even if sentence isn't complete
                    currentSentence.end = segment.end;
                }
            }
            
            // Add any remaining text as a sentence
            if (currentSentence.text) {
                sentences.push(currentSentence);
            }

            // Second step: Only run redundancy detection for redundancy mode
            if (detectionType === 'redundancy') {
                const redundancyClusters = findRedundancyClusters(sentences);
                return redundancyClusters.length > 0 ? redundancyClusters.flat() : sentences;
            }
            
            // For all other modes, return the sentence-grouped segments
            return sentences;
        };

        const cleanedTranscription = cleanTranscription(transcription, detectionType);
        console.log('Cleaned transcription for analysis received.');

        // Select the correct system prompt based on the detection type
        let messages;
        if (detectionType === 'chapter') {
            messages = [
                {
                  role: "system",
                  content: `You are an AI assistant specialized in analyzing *audio transcriptions* from YouTube videos.
              
                  IMPORTANT: You do NOT have access to visuals. Only analyze the provided audio transcription.
              
                  You are currently in **Chapter Detection Mode**. Your job is to return timestamped segments that represent **logical chapters or sections** of the content — clear shifts in topic, theme, or purpose for a YouTube viewer to quickly navigate the video.
              
                  Editor Goals:
                  - Identify points of **clear topic transitions**.
                  - Chapters should feel **self-contained** and **title-worthy**.
                  - Prioritize clarity, flow, and usefulness from a narrative or instructional perspective.
                  - Prefer segments that reflect **natural breaks** in the conversation, lecture, or narration.
              
                  ALWAYS return responses in this exact JSON format:
                  {
                    "segments": [
                      {
                        "start": "HH:MM:SS.mmm",
                        "end": "HH:MM:SS.mmm",
                        "text": "headline/title for the chapter"
                      }
                    ],
                    "summary": "Positive and upbeat confirmation of task completion (e.g., 'Got it! I went ahead and did X.')"
                  }
              
                  CRITICAL RULES:
                  1. If no chapter-worthy transitions are found, return an empty "segments" array and a polite summary.
                  2. Be thorough — identify all reasonable chapters unless the user specifies otherwise.
              
                  TIMESTAMP RULES (VERY IMPORTANT):
                  1. ALWAYS use timestamps EXACTLY as they appear, do not make them up.
                  2. Maintain chronological order.
              
                  You are not analyzing video or visuals. If the user prompt implies this, gently clarify your audio-only capabilities.
              
                  Think like an editor. Your output should help them structure their edit around natural content transitions.`
                },
                {
                  role: "user",
                  content: `Here is the transcription to analyze:\n\n${JSON.stringify(cleanedTranscription, null, 2)}`
                }
              ];
              
        } else if (detectionType === 'redundancy') {
            messages = [
                {
                    role: "system",
                    content: `You are an AI assistant specialized in analyzing *audio transcriptions* from videos to help video editors.
                                
                    You are currently in **Redundancy Detection Mode**. Your job is to identify areas where the speaker appears to repeat themselves or rephrase.
                
                    Find groups of redundancy then:
                    - Return all group items in the "repeats" array and mark the best take as "true", otherwise mark as "false".
                    - You MUST mark 1 repeat as true in each group, unless the takes are ambiguous and all good takes.

                
                    ALWAYS respond in this exact JSON format:
                    {
                        "redundantGroups": [
                        {
                            "repeats": [
                            {
                                "start": "HH:MM:SS.mmm",
                                "end": "HH:MM:SS.mmm",
                                "text": "transcription text that was repeated or flawed"
                                "bestTake": "true" or "false"
                            }
                            ]
                        }
                        ]
                    }
              
                  CRITICAL RULES:
                    1. Do NOT paraphrase transcript text unless clearly necessary due to transcription errors.
                    2. Return all redundancy groups found — be thorough. Do not stop after the first few.
                    3. If no redundancy is found, return: { "redundantGroups": [] }
                    4. Each group must have at least 1 repeat marked as true.

                    TIMESTAMP RULES:
                    - Always use the exact timestamps from the input.
                    - Do not fabricate or alter timestamps.
                    - Maintain strict chronological order.

                    Think like an editor.`
                },
                {
                  role: "user",
                  content: `Here is the transcription to analyze:\n\n${JSON.stringify(cleanedTranscription, null, 2)}`
                }
              ];
              
        } else if (detectionType === 'short') {
            messages = [
                {
                    role: "system",
                    content: `You are an AI assistant specialized in analyzing *audio transcriptions* to help video editors create engaging social media shorts.
                  
                    Your job is to identify segments that would make compelling short-form content (e.g., TikTok, Instagram Reels, YouTube Shorts).
                    
                    Editor Goals:
                    - Find complete, self-contained ideas that would work well as shorts
                    - Identify segments with high engagement potential (hooks, punchlines, key insights)
                    - Group related segments that tell a complete mini-story or convey a full idea
                    - Focus on segments that are concise yet impactful (ideally 15-60 seconds)
                    
                    ALWAYS return responses in this exact JSON format:
                    {
                      "shorts": [
                        {
                          "segments": [
                            {
                              "start": "HH:MM:SS.mmm",
                              "end": "HH:MM:SS.mmm",
                              "text": "transcription text for this segment"
                            }
                          ],
                          "title": "Suggested title for this short",
                          "hook": "What makes this segment engaging"
                        }
                      ],
                      "summary": "Brief overview of the shorts identified"
                    }
                    
                    CRITICAL RULES:
                    1. Each short MUST be self-contained and make sense on its own
                    2. Only group segments that are truly related and flow together
                    3. Do NOT modify or paraphrase transcript text
                    4. Keep shorts concise - aim for 15-60 seconds total duration
                    5. Return ALL viable shorts - be thorough
                    
                    TIMESTAMP RULES:
                    1. Use timestamps EXACTLY as they appear
                    2. Only combine ADJACENT segments (no gaps)
                    3. For each short:
                       - Use START time from the FIRST segment
                       - Use END time from the LAST segment
                    4. Maintain chronological order
                    
                    Look for segments that:
                    - Contain complete thoughts or ideas
                    - Would be interesting out of context
                    - Include memorable quotes or insights
                    - Have emotional impact or entertainment value
                    
                    Think like a social media content creator - what would make someone stop scrolling?`
                },
                {
                    role: "user",
                    content: `Here is the transcription to analyze:\n\n${JSON.stringify(cleanedTranscription, null, 2)}`
                }
            ];
        } else if (detectionType === 'custom') {
            messages = [
                {
                    role: "system",
                    content: `You are an AI assistant specialized in analyzing *audio transcriptions* from videos to help video editors.
                  
                  IMPORTANT: You do NOT have access to visuals. Only analyze the provided audio transcription.
                  
                  Your job is to return timestamped segments that would be most useful to a *video editor* working in a tool like Adobe Premiere Pro.
                  
                  Editor Goals:
                  - Identify complete segments that could be used directly in a cut.
                  - Find powerful soundbites or clear topic transitions.
                  - Segments should feel useful, context-rich, and self-contained.
                  
                  ALWAYS return responses in this exact JSON format:
                  {
                    "segments": [
                      {
                        "start": "HH:MM:SS.mmm",
                        "end": "HH:MM:SS.mmm",
                        "text": "transcription text for this segment"
                      }
                    ],
                    "summary": "Positive and upbeat confirmation of what you found (e.g., 'Got it! I went ahead and (reiterate the prompt back to the user). I found X.')"
                  }
                  
                  CRITICAL RULES:
                  1. NEVER modify or paraphrase the transcript text unless it appears to be a typo or transcribed incorrectly. Otherwise, use the original words exactly.
                  2. You may only combine adjacent segments (with no gaps).
                  3. Combine when it makes sense to do so as en editor would.
                  4. If nothing relevant is found, return an empty "segments" array and a polite summary.
                  5. Do not be lazy, give the user as many results as possible unless they quantify otherwise.
    
                  TIMESTAMP RULES (VERY IMPORTANT):
                  1. ALWAYS use timestamps EXACTLY as they appear in the input segments.
                  2. When combining segments:
                     - Use the START time from the FIRST segment
                     - Use the END time from the LAST segment
                  3. NEVER create or modify timestamps - use only original timestamps.
                  4. NEVER mix timestamps from non-adjacent segments.
                  5. Maintain chronological order - segments must be sequential.
                  
                  You are not analyzing video or visuals. If the user prompt implies this, gently clarify your audio-only capabilities.
                  
                  Think like an editor. Your output should help them find what they are looking for using only the transcript.`
                  }
                  ,
                {
                    role: "user",
                    content: `Here is the transcription to analyze:\n\n${JSON.stringify(cleanedTranscription, null, 2)}\n\nPrompt: ${prompt}`
                }
            ];
        }

        // Make the API call to Firework.ai's deepseek model
        const response = await axios.post(FIREWORK_API_URL, {
            model: "accounts/fireworks/models/llama4-scout-instruct-basic",
            messages: messages,
            temperature: 0.7,
            max_tokens: 2000,
            response_format: { type: "json_object" }
        }, {
            headers: {
                'Authorization': `Bearer ${FIREWORK_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        // Extract and validate the AI's response
        const analysisText = response.data.choices[0].message.content;
        let analysis;
        console.log('Text Analyzed');
        try {
            analysis = JSON.parse(analysisText);
            
            // For redundancy mode, return the response directly without additional processing
            if (detectionType === 'redundancy') {
                if (!analysis.redundantGroups || !Array.isArray(analysis.redundantGroups)) {
                    throw new Error('Invalid redundancy response structure');
                }
                return res.json({
                    success: true,
                    analysis: analysis
                });
            }

            // Original validation code
            if (detectionType === 'short') {
                if (!analysis.shorts || !Array.isArray(analysis.shorts)) {
                    throw new Error('Invalid shorts response structure');
                }
                
                return res.json({
                    success: true,
                    analysis: analysis
                });
            }
            
            // For other modes, continue with existing validation and processing
            if (!analysis.segments || !Array.isArray(analysis.segments) || !analysis.summary) {
                throw new Error('Invalid response structure');
            }

            // Helper function to find exact word sequence match with word-level timing
            function findWordSequenceMatch(words, transcription, isForward = true) {
                for (let i = 0; i < transcription.length; i++) {
                    const segment = transcription[i];
                    
                    // Skip if no words array in segment
                    if (!segment.words || !Array.isArray(segment.words)) {
                        continue;
                    }
                    
                    // Get array of words with their timing
                    const segmentWords = segment.words;
                    
                    // Find the first/last word in this segment
                    const wordIndex = isForward 
                        ? segmentWords.findIndex(w => w.text === words[0])
                        : segmentWords.findIndex(w => w.text === words[words.length - 1]);

                    if (wordIndex === -1) continue;

                    // Check if subsequent/previous words match
                    let matches = true;
                    let currentSegmentIndex = i;
                    let wordsToCheck = [...words];
                    let currentSegmentWords = [...segmentWords];
                    let currentWordIndex = wordIndex;

                    while (wordsToCheck.length > 0) {
                        if (currentWordIndex >= currentSegmentWords.length) {
                            // Move to next segment
                            currentSegmentIndex++;
                            if (currentSegmentIndex >= transcription.length || !transcription[currentSegmentIndex].words) {
                                matches = false;
                                break;
                            }
                            currentSegmentWords = transcription[currentSegmentIndex].words;
                            currentWordIndex = 0;
                        } else if (currentWordIndex < 0) {
                            // Move to previous segment
                            currentSegmentIndex--;
                            if (currentSegmentIndex < 0 || !transcription[currentSegmentIndex].words) {
                                matches = false;
                                break;
                            }
                            currentSegmentWords = transcription[currentSegmentIndex].words;
                            currentWordIndex = currentSegmentWords.length - 1;
                        }

                        const wordToMatch = isForward ? wordsToCheck[0] : wordsToCheck[wordsToCheck.length - 1];
                        if (currentSegmentWords[currentWordIndex].text !== wordToMatch) {
                            matches = false;
                            break;
                        }

                        isForward ? wordsToCheck.shift() : wordsToCheck.pop();
                        currentWordIndex = isForward ? currentWordIndex + 1 : currentWordIndex - 1;
                    }

                    if (matches) {
                        // Return the exact timestamp of the matched word
                        const matchedWord = segmentWords[wordIndex];
                        return isForward 
                            ? { timestamp: matchedWord.start, segmentIndex: i }
                            : { timestamp: matchedWord.end, segmentIndex: currentSegmentIndex };
                    }
                }
                return null;
            }

            // Process and validate each segment
            analysis.segments = analysis.segments.map(segment => {
                if (!segment.start || !segment.end || !segment.text) {
                    throw new Error('Invalid segment structure');
                }

                const segmentWords = segment.text.trim().split(/\s+/);
                
                // Find start timestamp using first few words
                const startWords = segmentWords.slice(0, Math.min(5, segmentWords.length));
                const startMatch = findWordSequenceMatch(startWords, transcription, true);

                // Find end timestamp using last few words
                const endWords = segmentWords.slice(-Math.min(5, segmentWords.length));
                const endMatch = findWordSequenceMatch(endWords, transcription, false);

                const foundStart = startMatch?.timestamp;
                const foundEnd = endMatch?.timestamp;

                return {
                    ...segment,
                    start: foundStart || segment.start,
                    end: foundEnd || segment.end
                };
            });

        } catch (parseError) {
            console.error('Error parsing AI response:', parseError);
            throw new Error('Failed to generate valid JSON response');
        }

        // Send the validated response
        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('Error in analyze-transcription:', error);
        res.status(500).json({
            error: 'Failed to process transcription',
            details: error.message
        });
    }
});

router.post('/advanced', upload.single('audio'), async (req, res) => {
    try {
        // Check if we have the audio file in the request
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No audio file provided'
            });
        }

        // Get language from request body, default to 'en' if not provided
        const language = req.body.language || 'en';
        const maxCharacters = req.body.maxCharacters || 15;
        // Create form data for Whisper API
        const formData = new FormData();
        formData.append('file', new Blob([req.file.buffer], { type: 'audio/wav' }), 'audio.wav');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');
        formData.append('language', language);
        formData.append('timestamp_granularities[]', 'word');

        console.log('Received User File, Sending to Whisper API:', {
            filename: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            language: language,
            maxCharacters: maxCharacters
        });

        const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: formData
        });

        if (!whisperResponse.ok) {
            const errorText = await whisperResponse.text();
            throw new Error(`Whisper API error: ${whisperResponse.statusText}. Details: ${errorText}`);
        }

        const transcription = await whisperResponse.json();
        console.log('Whisper transcription received.');

        const groupedSegments = groupWordsByCharCount(transcription, maxCharacters);

        // Return the raw transcription data
        res.json({
            success: true,
            groupedSegments: groupedSegments
        });

    } catch (error) {
        console.error('Error in advanced transcription:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Helper function to format timestamps to HH:MM:SS.mmm
function formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function groupWordsByCharCount(response, maxChars) {
    if (!response.words || !response.text) {
        console.error('Invalid transcription format:', response);
        throw new Error('Invalid transcription format');
    }

    const rawWords = response.words;
    const fullText = response.text;

    // Format time
    const formatTime = (seconds) => seconds.toFixed(3);

    // Adjust overlaps
    const adjustedWords = [];
    for (let i = 0; i < rawWords.length; i++) {
        const word = { ...rawWords[i] };
        
        if (i > 0) {
            const prevWord = adjustedWords[i - 1];
            if (word.start < prevWord.end) {
                word.start = prevWord.end;
            }
        }

        adjustedWords.push(word);
    }

    // Step 1: Split the full text into words with punctuation
    const textWords = fullText.trim().split(/\s+/); // Words from full text, with punctuation

    const groups = [];
    let currentGroup = {
        text: '',
        words: [],
        originalStartTime: null
    };
    let currentCharCount = 0;
    let wordIndex = 0;

    for (let i = 0; i < textWords.length; i++) {
        const sentenceWord = textWords[i];
        const cleanWord = sentenceWord.replace(/[.,!?;:]$/, '');
        
        // Handle compound words with hyphens
        const isCompoundWord = cleanWord.includes('-');
        let wordTiming;
        
        if (isCompoundWord) {
            // For compound words, use the timing of the first word
            wordTiming = adjustedWords[wordIndex];
        } else {
            wordTiming = adjustedWords[wordIndex];
        }

        const textToAdd = currentGroup.text.length > 0 ? ' ' + sentenceWord : sentenceWord;

        // If adding this would go over char limit, start new group
        if ((currentCharCount + textToAdd.length > maxChars && currentGroup.words.length > 0)) {
            groups.push(currentGroup);
            currentGroup = {
                text: sentenceWord,
                words: [{
                    word: sentenceWord,
                    start: formatTime(wordTiming.start),
                    end: formatTime(wordTiming.end)
                }],
                originalStartTime: formatTime(wordTiming.start)
            };
            currentCharCount = sentenceWord.length;
        } else {
            currentGroup.text += textToAdd;
            currentGroup.words.push({
                word: sentenceWord,
                start: formatTime(wordTiming.start),
                end: formatTime(wordTiming.end)
            });
            if (!currentGroup.originalStartTime) {
                currentGroup.originalStartTime = formatTime(wordTiming.start);
            }
            currentCharCount += textToAdd.length;
        }

        // If this word ends with a sentence-ending punctuation, end the group
        if (/[.!?]$/.test(sentenceWord)) {
            groups.push(currentGroup);
            currentGroup = {
                text: '',
                words: [],
                originalStartTime: null
            };
            currentCharCount = 0;
        }
        
        // Increment word index based on whether it's a compound word
        wordIndex += isCompoundWord ? 2 : 1;
    }

    if (currentGroup.words.length > 0) {
        groups.push(currentGroup);
    }

    return groups;
}

module.exports = router; 