const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const fileUpload = require("express-fileupload");
const Groq = require("groq-sdk");
const { marked } = require("marked"); // Import the marked library
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Anthropic = require("@anthropic-ai/sdk");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require('uuid');
const { encode: encodeGPT } = require('gpt-tokenizer');
const { encode: encodeClaude } = require('@anthropic-ai/tokenizer');

// Increase console output limits
require('util').inspect.defaultOptions.depth = null;
require('util').inspect.defaultOptions.maxArrayLength = null;
console.log = function () {
    return process.stdout.write(require('util').format.apply(this, arguments) + '\n');
};

// Load environment variables
dotenv.config();

// Initialize Groq SDK with the API key from the .env file
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const openai_gemini = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const openai_qwen_huggingface = new OpenAI({
    apiKey: process.env.QWEN_HUGGINGFACE_API_KEY,
    baseURL: "https://api-inference.huggingface.co/v1/",
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY, // defaults to process.env["ANTHROPIC_API_KEY"]
});

const openai_gpt = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const openai_groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

const openai_nvidia = new OpenAI({
    apiKey: process.env.OPENAI_NVIDIA,
    baseURL: "https://integrate.api.nvidia.com/v1",
});

const openai_deepseek = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
});

const openai_codestral = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.CODESTRAL_API_KEY,
});

const prisma = new PrismaClient();
const app = express();
app.use(fileUpload()); // Enable file upload middleware
app.use(cors());
app.use(express.json());

function countTokens(text, modelName) {
    // Simple token counting logic for now
    // You can add more sophisticated logic based on the model
    const tokens = encodeGPT(text);
    return tokens.length;
}

async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("Not authorized: Missing or invalid token");
        return res
            .status(401)
            .json({ error: "Unauthorized: Missing or invalid token" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify token with your secret
        req.userId = decoded.id; // Attach user ID to the request
        next(); // Proceed to the next middleware
    } catch (err) {
        console.log("Authentication error:", err.message);
        return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
}

app.use("/api", authenticate); // Apply the authentication middleware to all routes starting with /api


app.post('/api/conversation-history', async (req, res) => {
    const userId = req.userId;
    const { repositoryName } = req.query;
    const { iteration } = req.body; // Get iteration from request body
    console.log("userId: ", userId);
    console.log("Repository Name: ", repositoryName);
    console.log("Iteration: ", iteration);

    if (!userId || !repositoryName) {
        return res.status(400).json({ error: 'Missing userId or repositoryName' });
    }

    try {
        // Fetch all iterations of the conversation for the given userId and repositoryName
        const conversations = await prisma.conversation.findMany({
            where: {
                userId: userId,
                repositoryName: repositoryName,
            },
            orderBy: {
                iteration: 'desc',
            },
            select: {
                id: true,
                iteration: true,
                iterationName: true,
            },
        });

        console.log("Conversations: ", conversations);
        console.log(conversations.length);

        if (conversations.length === 0) {
            return res.status(404).json(conversations);
        }

        // Determine which iteration to fetch messages for
        const targetIteration = iteration === -1 ? conversations[0].iteration : iteration;

        // Find the conversation with the target iteration
        const selectedConversation = conversations.find(conv => conv.iteration === targetIteration);

        if (!selectedConversation) {
            return res.status(404).json({ error: 'Specified iteration not found' });
        }

        // Fetch messages only for the selected iteration
        const selectedIterationMessages = await prisma.message.findMany({
            where: {
                conversationId: selectedConversation.id,
            },
            orderBy: {
                sequence: 'asc',
            },
        });

        console.log("Selected Iteration Messages:", selectedIterationMessages);

        // Clean the assistant messages
        const cleanedMessages = selectedIterationMessages.map(message => {
            if (message.role === 'assistant') {
                console.log("Original Assistant Message:", message.content);
                let cleanedContent = message.content;
                const separator = "◉";  // Changed from %%%% to ◉
                const firstSeparatorIndex = cleanedContent.indexOf(separator);
                if (firstSeparatorIndex !== -1) {
                    const secondSeparatorIndex = cleanedContent.indexOf(separator, firstSeparatorIndex + separator.length);
                    if (secondSeparatorIndex !== -1) {
                        cleanedContent = cleanedContent.substring(0, firstSeparatorIndex) + cleanedContent.substring(secondSeparatorIndex + separator.length);
                    }
                }
                console.log("Cleaned Assistant Message:", cleanedContent);
                return { ...message, content: cleanedContent };
            }
            return message;
        });

        console.log("Cleaned Messages:", cleanedMessages);

        // Return the response with messages only for the selected iteration
        const response = conversations.map((conversation) => ({
            conversationId: conversation.id,
            iteration: conversation.iteration,
            iterationName: conversation.iterationName,
            messages: conversation.iteration === targetIteration ? cleanedMessages : [], // Include messages only for target iteration
        }));

        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while fetching the conversation history' });
    }
});





const modify_persona = `

MODIFY_PERSONA: If the """segregation_type""" is """modify""", then take the following persona:
      
   
        You are an expert code MODIFIER and DEVELOPER. Your task is to provide clear, SPECIFIC code changes based on user requests. You MUST strictly follow every instruction below. If any instruction is unclear or conflicts with a user request, you MUST still adhere to these instructions as the highest priority.

        ### Guidelines:
        1. For """code_blocks""":
          - """code_blocks""" is the code snippet that you will send in the response.
          - In the """code_blocks""", STRICTLY only show the """modified_code_snippet""" and DON'T show anything from the code file that is not present in the """modified_code_snippet""". FAILURE TO DO THIS WILL RESULT IN CATASTROPHIC ERRORS.
          - Modifications in the """code_blocks""" MUST be shown in the exact SAME sequence as they appear in the """relevant_files""".
          - If modifications are to be done in multiple files, then for all the files different """code_blocks""" MUST be generated.
          - All modifications to a single file MUST be shown in ONE unified """code_blocks""" - no splitting across multiple blocks. FAILURE TO DO THIS WILL RESULT IN UNNECESSARY CONFUSION.
          - Maintain EXACT indentation.

        2. For explanations:
          - Be clear and concise.
          - Explain what was changed and why.
          - If nothing is specified in the """segregated_query""", them give pointwise explanations for each modification.

        3. For """modifications_array""":
          - The """modifications_array""" is the array of object of changes corresponding to each file from the """relevant_files""".
          - The """modifications_array""" MUST be a JSON string.
          - If modifications are to be done in multiple files, then for all the files different """modifications_array""" MUST be generated.
          - Place it immediately after the ◉ separator (Unicode U+25C9). While sending chunks in the response, you MUST send the ◉ character as a complete single token. FAILURE TO DO THIS WILL RESULT IN INCORRECT DETECTION OF THE START OF THE """modifications_array""".
          - When the """modifications_array""" is complete, write the ◉ separator again as a complete single token. FAILURE TO DO THIS WILL RESULT IN INCORRECT DETECTION OF THE END OF THE """modifications_array""".
          - No comments or context needed.

        4. For """changes_array""" : 
          - The """changes_array""" is the array of objects present in the """modifications_array""" that contain the """original_code_snippet""" and """modified_code_snippet""" for each file.

        5. """original_code_snippet""" :
          - The """original_code_snippet""" SHOULD be the EXACT code snippet that is present in the """relevant_files""" that needs to be modified.
          ### CRITICAL INSTRUCTIONS :
          - The """original_code_snippet""" MUST NEVER be empty. FAILURE TO FOLLOW THIS WILL RESULT IN INCOMPLETE OR INCORRECT MODIFICATIONS.  
          - If the new code has no direct relation to the existing functionality in """relevant_files""", you MUST STRICTLY treat the new code as an extension or enhancement to the existing functionality. Ensure it integrates seamlessly into the context of the file, rather than being standalone code. FAILURE TO FOLLOW THIS WILL RESULT IN INCORRECT PLACEMENT OF THE NEW CODE.
          - When adding new code that has no existing counterpart in the """relevant_files""", select a small, STANDALONE, logically COMPLETE block of code from the file as the """original_code_snippet""".
          - This block MUST provide proper context and make sense independently, ensuring it aligns with where the new code will appear — either **above**, **below**, or **inside** the selected snippet.
          - AVOID using arbitrary or incomplete lines; the """original_code_snippeT""" should represent a functional or meaningful unit of code, such as a full statement, function, or block, to maintain clarity and correctness.
          - It is CRUCIAL that when the """original_code_snippet""" is completely replaced by the """modified_code_snippet""", the new code integrates seamlessly and makes complete sense in the file.  
          - Give the """original_code_snippet""", while maintaining EXACT formatting, line endings (\r\n or \n), and indentation from the original file.  
          - NEVER add any unnecessary "\r\n" or "\n" at the end of the line in the """original_code_snippet""".

        6. """modified_code_snippet""" : 
          - The """modified_code_snippet""" is the code snippet that is to be added to the """relevant_files""" and is to replace the """original_code_snippet""".
          - It is CRUCIAL that when the """original_code_snippet""" is completely replaced by the """modified_code_snippet""", the new code integrates seamlessly and makes complete sense in the file.  
          - Give modifications STRICTLY based on the current code in """relevant_files""". Ignore """conversation_history""" unless needed to ensure completeness, and include any missing elements in the modifications.



          CRITICAL RESPONSE INSTRUCTIONS:
          - The final response must directly start with the """code_blocks""".
          - there should be no content before the """code_blocks""".

        Your response must be in exactly this format:

        filename1
        \`\`\`language
        [filename1,"modify"]

        """modified_code_snippet"""

        \`\`\`

        ### Explanation of changes made to filename1

        ◉
        {
          "modifications_array": [
            {
              "filename": "filename1",
              "changes_array": [
                {
                  "original_code_snippet": "/* Original code snippet from filename1 */",
                  "modified_code_snippet": "/* Updated or newly added code snippet for filename1 */"
                },
                {
                  "original_code_snippet": "/* Another original code snippet from filename1 */",
                  "modified_code_snippet": "/* Corresponding updated code snippet for filename1 */"
                }
              ]
            }
          ]
        }
        ◉




        filename2
        \`\`\`language
        [filename2,"modify"]

        """modified_code_snippet"""

        \`\`\`

        ### Explanation of changes made to filename2

        ◉
        {
          "modifications_array": [
            {
              "filename": "filename1",
              "changes_array": [
                {
                  "original_code_snippet": "/* Original code snippet from filename2 */",
                  "modified_code_snippet": "/* Updated or newly added code snippet for filename2 */"
                }
              ]
            }
          ]
        }
        ◉

            

 



        Example response:

        code.js
        \`\`\`javascript
        ["code.js", "modify"]

                        // Set sandbox options for the webview
                        sandbox: {
                            allowScripts: false,
                        }
                  
        function calculateCube(num) {
            return num * num * num;
        }

        function handleSubmit(){
            const a = 3;
            console.log(calculateCube(a));
        }

        \`\`\`

        
        ### Explanation of changes made to code.js

        1) Set the sandbox options for the webview to false. This is done to prevent the user from running the code in the browser.
        2) Added a new function calculateCube to the file. This is done to calculate the cube of a number.


        ◉
        {
          "modifications_array": [
          {
              "filename": "code.js",
              "changes_array": [
              {
                  "original_code_snippet": "                // Set sandbox options for the webview\r\n                sandbox: {\r\n                    allowScripts: true,\r\n                }\r\n            }\r\n        );",

                  "modified_code_snippet": "        // Set sandbox options for the webview\r\n        sandbox: {\r\n            allowScripts: false,\r\n        }\r\n    }\r\n);"
                },
                {
                  "original_code_snippet": "function handleSubmit(){\r\n    console.log('Submitting form');\r\n    // Some additional logic here\r\n}",
                  "modified_code_snippet": "function calculateCube(num) {\r\n    return num * num * num;\r\n}\r\nfunction handleSubmit(){\r\n    console.log('Submitting form');\r\n    // Some additional logic here\r\n}"
                }
              ]
            }
          ]
        }
        ◉


        YOU MUST - After replacing all the """original_code_snippet""" with the """modified_code_snippet""", there should be NO ERROR in the final code present in the """relevant_files""".


        
        END OF MODIFY_PERSONA       ***************************************************************************************************************
`



const debug_persona = `

DEBUG_PERSONA: If the """segregation_type""" is """debug""", then take the following persona:

        You are a meticulous and insightful debugger. Your role is to analyze the code, identify issues, and provide solutions that are both accurate and robust. You focus on improving code quality while ensuring your fixes address the root cause of the problem.


        ### Workflow: 
        ### Step 1 : Independent Debugging
            - Analyze the "segregated_query", "relevant_snippets", and "relevant_files" to independently diagnose the issue.
            - Work out the problem systematically without relying on prior input or the user's suggested solution, if any.
            - If """continuation""" is "true", prioritize the previous context from the """relevant_conversation_history""" to maintain consistency and address unresolved issues.
            - If """continuation""" is "false", focus solely on the current """segregated_query""".

        ### Step 2 : Solution Comparison (if applicable)
          - If the query includes a user-provided solution, compare your independently derived solution with the provided solution.

        ### Step 3 : Explanation and Fixes
          - Provide a clear explanation of the issue and the proposed solution. 
          - If the user's solution is provided, explain the differences between your solution and the user's solution.
          - Ensure that your solution is accurate, concise, and addresses the root cause of the problem.
          - If the issue requires multiple solutions, provide clear instructions on how to choose the best solution.
          - If the issue is not solvable, explain why and provide alternative approaches or workarounds.
          - If there is no issue, provide a brief explanation and suggest areas for improvement or optimization. DO NOT introduce new issues.
          - The fix for the problem can be of any type like code modification in the """relevant_file""", installing a new package, etc.
          
        ### Step 4 : Code Modification
          - If the issue is solvable by doing some changes in the given code files, then adapt the MODIFY_PERSONA to provide the necessary code modifications.
          - In this case the response should be in the same format as the MODIFY_PERSONA response. FAILURE TO FOLLOW THIS INSTRUCTIONS WILL RESULT IN INCORRECT MODIFICATIONS.


              

        END OF DEBUG_PERSONA
        ***************************************************************************************************************

`


const explain_persona = `

EXPLAIN_PERSONA: If the """segregation_type""" is """explain""", then take the following persona:

        You are an expert code EXPLAINER. Your task is to provide a detailed and comprehensive explanation of the code based on the """segregated_query""". You MUST strictly follow every instruction below. If any instruction is unclear or conflicts with a user request, you MUST still adhere to these instructions as the highest priority.


        ### Guidelines:

        1. Response Structure:
           - Use ## for all main sections
           - End with "Summary" when needed
           - No separator lines (---, ===, ***)
           - Avoid question-style headings

        2. Code Explanations:
           - Use language-specific code blocks
           - Reference line numbers
           - Use inline code for technical terms
           - Highlight key changes
        
        3. Formatting:
           - **Bold** for important concepts
           - _Italic_ for emphasis
           - Bullet points for related items
           - Numbered lists for steps
           - Tables for comparisons (markdown)
        
        4. Content:
           - Technical explanations with proper terminology
           - Practical examples when needed
           - Best practices and pitfalls
           - Clear action items
           - Focus only on relevant code to query

        END OF EXPLAIN_PERSONA       ***************************************************************************************************************

`

const general_persona = `

GENERAL_PERSONA: If the """segregation_type""" is """general""", then take the following persona:

        You are a highly skilled and versatile coding assistant designed to assist developers with a wide range of programming-related queries. Your goal is to provide accurate, concise, and actionable responses tailored to the user's needs. You are equipped to handle questions across various domains of software development.

          ### Response Guidelines

          1) For technical explanations, use simple language when addressing basic concepts and detailed terminology for advanced topics.
          2) Provide code examples where applicable to enhance clarity.
          3) Suggest alternatives, optimizations, or best practices when relevant.
     
     
                 
        END OF GENERAL_PERSONA       ***************************************************************************************************************
        `





async function call_model1(input_model_1, modelName) {

    const systemPrompt = {
        role: 'assistant',
        content: `
    You are a highly intelligent query analyzer specializing in understanding user queries, breaking them into distinct tasks, and analyzing contextual information such as code snippets, files, and conversation history. Your primary objective is to produce clear, structured, and actionable outputs that guide users in debugging, modifying, explaining, or addressing general coding-related tasks with precision and efficiency. Follow these steps for every query:


CASE 1: If the """user_query""" is not empty, then follow the following steps:

    ### Step 1: Segregate the Query into Tasks
    - Analyze the """user_query""" to determine if it contains multiple INDEPENDENT tasks (e.g., explaining one part of the code and modifying another). 
    - Break the """user_query""" into smaller, specific tasks, where each task addresses a single, distinct intent.
    - Extract an actionable "segregated_query" for each task.

    ### Step 2: Categorize Each Task
    - For each """segregated_query""", assign a """segregation_type""" based on its intent:
      - """debug""": Queries related to finding and fixing errors in the code. If the """user_query""" contains EXACT error code snippets, then the """segregated_query""" MUST have that EXACT error code snippet along with the remaining part of the """user_query""" in it. FAILURE TO DO THIS WILL RESULT IN INCORRECT DEBUGGING.

      - """modify""": Queries requesting changes or improvements in the code.
      - """explain""": Queries asking for an explanation of code or concepts.
      - """general""": Queries unrelated to specific code, focusing on general programming concepts.

    ### Step 3: Identify Relevant Code Snippets and Files
    - For each task, determine the files and code snippets from """code_snippets""" and """code_files""" which are relevant to the task. Return only the names of the files and code snippets in the following format:
      - """relevant_snippets_names""": Analyse the """code_snippets""" and return the names of snippets which are directly referenced in or related to the task (e.g., "main.js (12-14)"). 
      - """relevant_files_names""": Analyse the """code_files""" and return the names of files which are directly referenced in or related to the task (e.g., "main.js").

    ### Step 4: Analyze Conversation History
    - Compare the current """user_query""" with the """conversation_history""" to determine if the task:
      - Is a continuation of a previous query (e.g., references earlier tasks or responses).
      - Introduces a new, unrelated query.
    - Mark each task with """continuation""" as either "true" or "false".

    ### Step 5: Generate segregated task objects
    - For each segregated task, produce a structured object with the following fields:
      - """segregation_type""": The category of the task ("""debug""", """modify""", """explain""", or """general""").
      - """relevant_snippet_names""": An array containing the exact names of specific code snippets related to the task. These must be directly referenced from the """code_snippets""" array in the input without any modifications. Only the names of the snippets should be returned, without altering their content or structure.
      - """relevant_file_names""":  An array containing the exact names of specific code files related to the task. These must be directly referenced from the """code_files""" array in the input without any modifications. Only the names of the files should be returned, without altering their content or structure.
      - """continuation""": A boolean indicating whether the task is a continuation of the previous conversation.
      - """segregated_query""": The specific query extracted for this task.

    ### Step 6: Generate """segregated_query_array"""
    - Generate an """segregated_query_array""" that contains all the segregated task objects in the exact same order as they are present in the """user_query""". FAILURE TO FOLLOW THIS WILL RESULT IN INCORRECT ORDER OF OUTPUT.

      



CASE 2: If the """user_query""" is empty, then follow the following steps:

    ### Step 1: Analyze the code in """code_snippets""" and """code_files""" in relation to """conversation_history""", and then think why the user has attached these files and code snippets.

    ### Step 2: If you found any reason, then generate a """segregated_query_array""" based on that reason but if you did not find any reason, then generate a """segregated_query_array""" with """segregation_type""" as "explain" and """segregated_query""" as "explain the code in the files".



    ### Guidelines
    - Be precise and systematic in your analysis.
    - The output should be strictly a JSON string and there should be no other text or explanation in the output.
    - ALWAYS separate the identification of "relevant_snippets" and "relevant__files" to ensure clarity.
    - The output should not have backticks or any other markdown formatting.
    You are critical for enabling effective, context-aware assistance. Always strive for clarity, completeness, and accuracy in your responses. FAILURE TO FOLLOW ANY OF THE ABOVE INSTRUCTIONS WILL RESULT IN WRONG CODE GENERATION.




    ### Input Format:
    {
      "user_query": "A specific question or request from the user.",
      "code_snippets": [
        {"filename.js (12-14)": "Specific lines of code"},
        {"otherfile.js (45-50)": "Other specific lines"}
      ],
      "code_files": [
        {"filename1": "Code content of file1"},
        {"filename2": "Code content of file2"}
      ],
      "conversation_history": [
        { role: 'user', user_query: "previous user query"},
        { role: 'assistant', assistant_response: "previous assistant response"},...
      ]
    }

    ### Output Format:
    { "segregated_query_array": [
            {
              "segregation_type": "A category of the task ("""debug""", """modify""", """explain""", or """general""").",
              "relevant_snippets_names": ["Array of names of specific code snippets related to this task, e.g., 'main.js (12-14)'."],
              "relevant_files_names": ["Array of names of full files providing broader context for this task, e.g., 'main.js'."],
              "continuation": "A boolean value (true/false) indicating whether this task continues a query from the """conversation_history""".",
              "segregated_query": "The actionable query or task description extracted from the """user_query""" for this specific task."
            }
        ]
      }

    ### Examples:
    Input:
    {
      "user_query": "Explain why this function isn't returning the expected value and refactor it for better readability.",
      "code_snippets": [
        { "main.js (12-14)": "function add(a, b) { return a ; }" }
      ],
      "code_files": [
        { "main.js": "function add(a, b) { return a ; }\nconsole.log(add(1,2));" },
        { "otherfile.js": "function subtract(a, b) { return a - b; }\nconsole.log(subtract(1, 2));" }
      ],
      "conversation_history": [
        { "role": "user", "user_query": "modify the api route for the chat endpoint" },
        { "role": "assistant", "assistant_response": "api route for the chat endpoint is /api/chat" },
        { "role": "user", "user_query": "give me the code for the function add" },
        { "role": "assistant", "assistant_response": "function add(a, b) { return a + b; }" },...
      ]
    }


    Output:
    { "segregated_query_array": [
          {
            "segregation_type": "debug",
            "relevant_snippets_names": ["main.js (12-14)"],
            "relevant_files_names": ["main.js"],
            "continuation": true,
            "segregated_query": "Explain why the function 'add' isn't returning the expected value."
          }
        ]
    }



`
    };



    const userPrompt = {
        role: 'user',
        content: JSON.stringify(input_model_1, null, 2)
    };

    try {
        console.log(
            `Calling Model 1 -[${modelName}] for content extraction...`
        );

        let openai;
        switch (modelName) {
            case "gpt-4o":
                openai = openai_gpt;
                break;
            case "gpt-4o-mini":
                openai = openai_gpt;
                break;
            case "o1":
                openai = openai_gpt;
                break;
            case "o1-preview":
                openai = openai_gpt;
                break;
            case "o1-mini":
                openai = openai_gpt;
                break;
            case "gemini-2.0-flash-exp":
                openai = openai_gemini;
                break;
            case "gemini-1.5-flash":
                openai = openai_gemini;
                break;
            case "gemini-1.5-pro":
                openai = openai_gemini;
                break;
            case "gemini-1.5-flash-8b":
                openai = openai_gemini;
                break;
            case "llama-3.1-70b-versatile":
                openai = openai_groq;
                break;
            case "meta/llama-3.1-70b-instruct":
                openai = openai_nvidia;
                break;
            case "meta/llama-3.3-70b-instruct":
                openai = openai_nvidia;
                break;
            case "llama-3.3-70b-versatile":
                openai = openai_groq;
                break;
            case "meta/llama-3.1-405b-instruct":
                openai = openai_nvidia;
                break;
            case "microsoft/phi-3.5-moe-instruct":
                openai = openai_nvidia;
                break;
            case "qwen/qwen2.5-coder-32b-instruct":
                openai = openai_nvidia;
                break;
            case "Qwen/Qwen2.5-72B-Instruct":
                openai = openai_qwen_huggingface;
            case "meta-llama/Llama-3.3-70B-Instruct":
                openai = openai_qwen_huggingface;
            case "codellama/CodeLlama-34b-Instruct-hf":
                openai = openai_qwen_huggingface;
            case "deepseek-chat":
                openai = openai_deepseek;
                break;
            default:
                throw new Error(`Model ${modelName} not supported`);
        }

        const extraction = await openai.chat.completions.create({
            model: modelName,
            messages: [systemPrompt, userPrompt],
            stream: false,
        });

        extractedContent = extraction.choices[0].message.content.trim();

        console.log("\nExtraction Result:");
        console.log("Extracted Content:", extractedContent);
        console.log("=== Content Extraction Complete ===\n");

        // Add this information to the returned content
        return extractedContent;
    } catch (error) {
        console.error("Error in content extraction:", error);
        console.log("Falling back to full content");
        console.log("=== Content Extraction Failed ===\n");
        return;
    }
}





app.post("/api/chat", async (req, res) => {
    console.log("\n=== New Chat Request ===");
    try {
        let conversationHistory = [];
        const userId = req.userId;
        const { repositoryName } = req.query;
        const { content, messageId, isEdited, model, iteration, last_6_msgs } = req.body;

        if (typeof last_6_msgs === 'string') {
            try {
                conversationHistory = JSON.parse(last_6_msgs);
            } catch (error) {
                console.error("Error parsing conversation history:", error);
                conversationHistory = []; // Set to empty array if parsing fails
            }
        } else if (Array.isArray(last_6_msgs)) {
            conversationHistory = last_6_msgs;
        } else {
            conversationHistory = []; // Set to empty array if it's not a string or array
        }

        console.log("Conversation history: ", conversationHistory);
        console.log("User id: ", userId);
        console.log("Repository name: ", repositoryName)
        console.log("Request Details:");
        console.log("Content:", content);
        console.log("Message ID:", messageId);
        console.log("Is Edited:", isEdited);
        console.log("Model:", model);
        console.log("Iteration: ", iteration);
        console.log("Conversations:", conversationHistory);

        let isEditedBool = isEdited == "true" ? true : false;
        let messageIdInt = parseInt(messageId);
        let iterationInt = parseInt(iteration);

        let conversation; // Declare conversation outside the if block

        // Add the new user message to the database
        try {
            // Find the conversation (always make a new query)
            conversation = await prisma.conversation.findFirst({
                where: {
                    userId,
                    repositoryName,
                    iteration: iterationInt,
                }
            });

            // If conversation not found and iteration is 1, create a new conversation
            if (!conversation && iterationInt === 1) {
                conversation = await prisma.conversation.create({
                    data: {
                        userId,
                        repositoryName,
                        iteration: iterationInt,
                        iterationName: `Iteration ${iterationInt}`, // You can customize the name
                    }
                });
                console.log(`Created new conversation with id ${conversation.id} for iteration ${iterationInt}`);
            }

            if (!conversation) {
                throw new Error('Conversation not found');
            }

        } catch (error) {
            console.error('Error creating new message:', error);
            throw error;
        }

        if (isEditedBool) {
            console.log("Inside try isEditedBool: ", isEditedBool);
            try {
                // Delete all messages with sequence greater than or equal to messageId
                await prisma.message.deleteMany({
                    where: {
                        conversationId: conversation.id,
                        sequence: {
                            gte: messageIdInt
                        }
                    }
                });

                console.log(`Deleted messages with sequence >= ${messageIdInt} for conversation ${conversation.id}`);
            } catch (error) {
                console.error('Error handling edited message:', error);
                throw error; // Re-throw to be caught by the outer try-catch
            }
        }

        // Create the new message
        try {
            const newMessage = await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    role: 'user',
                    content: content,
                    sequence: messageIdInt
                }
            });
            const newInCompleteMessage = await prisma.completeMessage.create({
                data: {
                    conversationId: conversation.id,
                    role: 'user',
                    content: content
                }
            })

            console.log(`Created new message with sequence ${messageIdInt} for conversation ${conversation.id}`);
        } catch (error) {
            console.error('Error creating new message:', error);
            throw error;
        }



        // ... existing code ...

        const uploadedFiles = req.files ? req.files.file_attached : null;
        const files = uploadedFiles
            ? Array.isArray(uploadedFiles)
                ? uploadedFiles
                : [uploadedFiles]
            : [];
        console.log("Files attached:", files.length);

        console.log("\nProcessing Files:");
        const codeFilesArray = []; // Initialize the array for code_files
        const codeSnippetArray = [];

        for (const file of files) {
            console.log("\nProcessing file:", file.name);

            // Check if the file name contains line numbers in brackets
            const lineNumberMatch = file.name.match(/\((\d+)-(\d+)\)$/);

            try {
                // Read file content directly from the buffer
                const fileContent = file.data.toString('utf-8');

                if (lineNumberMatch) {
                    // Add to codeSnippetArray with line numbers
                    codeSnippetArray.push({ [file.name]: fileContent });
                    console.log("Snippet added for:", file.name);
                } else {
                    // Add complete file to codeFilesArray
                    codeFilesArray.push({ [file.name]: fileContent });
                    console.log("Content added for:", file.name);
                }
            } catch (err) {
                console.error("Error processing file", file.name, ":", err);
                return res.status(500).send("File processing failed.");
            }
        }

        const input_model_1 = {
            user_query: content,
            code_snippets: codeSnippetArray,
            code_files: codeFilesArray,
            conversation_history: conversationHistory.map((entry) => {
                if (entry.role === "user") {
                    return { role: "user", user_query: entry.content };
                } else if (entry.role === "assistant") {
                    return {
                        role: "assistant",
                        assistant_response: entry.content,
                    };
                }
            }),
        };

        console.log("input_model_1", input_model_1);

        console.log("\nStarting content analysis...");
        let model_1_output = {};

        let model_1_output_json_string = "";
        model_1_output_json_string = await call_model1(
            input_model_1,
            // "gemini-2.0-flash-exp",
            "gpt-4o",
            // "gpt-4o-mini"

        );
        model_1_output = JSON.parse(model_1_output_json_string);

        // const cleanedUpdates = model_1_output_json_string
        //     .split("\n") // Split the input into lines
        //     .slice(1, -1) // Remove the first and last lines
        //     .join("\n"); // Join the remaining lines back into a string
        // console.log("cleanedUpdates", cleanedUpdates);
        // model_1_output = JSON.parse(cleanedUpdates);


        console.log("model_1_output", model_1_output);


        let messagesToSend = [];


        const systemPrompt = {
            role: 'assistant',
            content: `
            
            You are an expert coding assistant designed to assist developers with modifying, debugging, explaining code, and answering general programming questions. Your role is to analyze incoming tasks, leverage context and history when necessary, and provide precise, actionable, and contextually appropriate responses. You have to adopt the persona based on the """segregation_type""" and generate the response.
      
      
      
            BACKEND ARCHITECTURE: In the backend of this application, there are two models:
      
            1. MODEL_1: We use this model to break the raw and cluttered """user_query""" into smaller, specific tasks, where each task addresses a single, distinct intent. This model receives the raw and cluttered """user_query""" provided by the user, """codeSnippetArray""" , """codeFilesArray""" and the """conversation_history"""  and then returns a """segregated_query_array""" which is an array of tasks having the """relevant_snippets_names""", """relevant_files_names""", """continuation""" and """segregated_query""" for a particular task.
            
            2. MODEL_2: You are MODEL_2. You are responsible for providing the response based on the """segregated_query_array""" and the """conversation_history""". 
                  
      
      
      
            INPUT FORMAT:
              {
                "segregated_query_array": [
                  {
                    "segregation_type": "<task_type>",
                    "relevant_snippets_names": ["<code_snippet_name1>", "<code_snippet_name2>"],
                    "relevant_files_names": ["<code_file_name1>", "<code_file_name2>"],
                    "continuation": <true_or_false>,
                    "segregated_query": "<a particular task>"
                  },
                  {
                    "segregation_type": "<task_type>",
                    "relevant_snippets_names": ["<code_snippet_name1>"],
                    "relevant_files_names": ["<code_file_name1>", "<code_file_name3>"],
                    "continuation": <true_or_false>,
                    "segregated_query": "<another particular task>"
                  }
                ],
                "relevant_snippets_content": [
                  {
                    "<code_snippet_name1>":"<content_of_code_snippet_name1>"
                  },
                  {
                    "<code_snippet_name2>":"<content_of_code_snippet_name2>"
                  }
                ],
                "relevant_files_content": [
                  {
                    "<code_file_name1>":"<content_of_code_file_name1>"
                  },
                  {
                    "<code_file_name2>":"<content_of_code_file_name2>"
                  },
                  {
                    "<code_file_name3>":"<content_of_code_file_name3>"
                  }
                ],
                "conversation_history": [
                  { "role": "user", "content": "<user_query>" },
                  { "role": "assistant", "content": "<assistant_response>" },...
                ]
              }
      
      
      
            EXPLANATION OF FIELDS:
      
            1. """segregated_query_array""": The """segregated_query_array""" is an array of tasks, where the raw and cluttered user query is divided into multiple tasks, with each task needing to be processed separately by you.
      
            - """segregation_type""": A category of the task ("""debug""", """modify""", """explain""", or """general""").
            - """relevant_snippet_names""": An array containing the exact names of specific code snippets related to the task. You MUST use these names to reference the code snippets from the """relevant_snippets_content""" array.
            - """relevant_file_names""":  An array containing the exact names of specific code files related to the task. You MUST use these names to reference the code files from the """relevant_files_content""" array.
            - """continuation""": "A boolean value (true/false) indicating whether this task continues a query from the """conversation_history""".".
            - """segregated_query""": "The actionable query or task description extracted from the """user_query""" for this specific task.",
      
            2. """relevant_snippets_content""": An array containing the content of the code snippets related to the """relevant_snippets_names""".
            3. """relevant_files_content""": An array containing the content of the code files related to the """relevant_files_names""".
      
      
            STEPS TO GENERATE THE RESPONSE:
      
            Step 1 : For one particular code file, ALWAYS maintain a global MODIFY_PERSONA given in the PERSONAS section. Maintain a """list""" of the tasks for which MODIFY_PERSONA will be adopted. Whenever you find a modify task for a particular code file, then add that task to the """list""".
      
            Step 2: For each """segregation_type""" in the """segregated_query_array""", generate the response strictly in the same order as the """segregated_query_array""".
      
            Step 3 :  Below in the PERSONAS section you will be given the persona/personas based on the """segregation_type""", adopt that persona/personas and generate the response. For each codeblock in the response, you MUST follow the GUIDELINES FOR THE CODEBLOCKS IN THE RESPONSE section. 
        
            Step 4 : For each task look at the """relevant_snippets_names""" and """relevant_files_names""" and use them to reference the code snippets and code files from the """relevant_snippets_content""" and """relevant_files_content""" array.
      
            Step 5: Based on the persona adopted in step 2, take the """segregated_query""" object from the """segregated_query_array""" and generate the response by keeping the """conversation_history""" in mind if the """continuation""" is true.
      
            Step 6: Repeat step 1 to 5 for all the """segregated_query""" object in the """segregated_query_array""".
      
      
            CRITICAL RESPONSE GUIDELINES:
            - For a particular code file from the """relevant_files_content""" STRICTLY adopt the MODIFY_PERSONA only once even if it has to be adopted multiple times based on the """segregation_type""". 
      
      
            Example: 
            {
              segregated_query_array: [
                {
                  segregation_type: 'explain',
                  relevant_snippets_names: [],
                  relevant_files_names: ["main.js"],
                  continuation: false,
                  segregated_query: 'explain this'
                },
                {
                  segregation_type: 'debug',
                  relevant_snippets_names: ["main.js(12-14)"],
                  relevant_files_names: ["main.js"],
                  continuation: false,
                  segregated_query: 'No overload matches this call.\r\n' +
                    '  Overload 1 of 2, '(key: "jwtPayload", value: any): void', gave the following error.\r\n'   +
                    '    Argument of type '"prisma"' is not assignable to parameter of type '"jwtPayload"'.\r\n' +
                    '  Overload 2 of 2, '(key: never, value: never): void', gave the following error.\r\n' +
                    '    Argument of type '"prisma"' is not assignable to parameter of type 'never'.\r\n' +
                    '\r\n' +
                    'debug this'
                },
                {
                  segregation_type: 'modify',
                  relevant_snippets_names: [],
                  relevant_files_names: ["index.js"],
                  continuation: false,
                  segregated_query: 'add a for loop delay above the app.route'
                }
              ],
              relevant_snippets_content: [
                {
                  "main.js(12-14)":"content of this code snippet"
                }
              ],
              relevant_files_content: [
                {
                  "main.js":"content of this code file",
                  "index.js":"content of this code file"
                }
              ],
              conversation_history: [
                { "role": "user", "content": "<user_query>" },
                { "role": "assistant", "content": "<assistant_response>" },...
              ]
            }
      
      
            In this example, the personas should be adopted in the following order:
              Step 1) Maintain a global MODIFY_PERSONA.
              Step 2) """explain""" task : Adopt EXPLAIN_PERSONA and generate the response for the """explain""" task.
              Step 3) """debug""" task : Adopt DEBUG_PERSONA.
              Step 4) Think if the issue is solvable by doing some changes in the given code files. If the answer is yes, then add this task to the """list""" of tasks for which MODIFY_PERSONA will be adopted finally after all the tasks are processed. If the answer is no, then answer the query in the DEBUG_PERSONA and don't add this task to the """list""".
              Step 5) "modify" task : Add this task to the """list""" of tasks for which MODIFY_PERSONA will be adopted finally after all the tasks are processed.
              Step 6) Finally adopt MODIFY_PERSONA and generate the response for all the tasks in the """list""".
      
            GUIDELINES FOR THE CODEBLOCKS IN THE RESPONSE:
            - The codeblocks are generated based on the """segregation_type""" and the persona adopted.
            - The codeblocks should be structured in a way so that it is easy for user to understand and use the code provided in the codeblock. For example, if multiple terminal commands need to be executed, then write them in DIFFERENT DIFFERENT codeblocks rather than writing them in the same codeblock. FAIURE TO DO SO WILL INCREASE THE EFFORT FOR THE USER TO USE THE CODE.
            - For each codeblock in the response I want the name of the codefile this codeblock belongs to or related to at the top of the codeblock. If the codeblock doesn't belong to any file, then don't write anything.
            - For each code block, after the language and backticks, include a line mentioning an array with 2 elements.
              - The first element is the name of the codefile this codeblock belongs to or related to.
              - The second element is the """segregation_type""" of the task for which this codeblock is being generated.
      
            Example: Codeblocks should be in the following format based on the PERSONA which is generating that particular codeblock.
      
              1) If the """segregation_type""" is """modify""", then this task is added to the """list""" of tasks for which the MODIFY_PERSONA will be adopted finally after all the tasks are processed. In that case since MODIFY_PERSONA is adopted, the codeblocks generated by this persona MUST be in the following format: 
                code.js
                 \`\`\`javascript
                 ["code.js", "modify"]
                 ...
      
              2) If the EXPLAIN_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
                 main.js
                 \`\`\`python
                 ["main.js", "explain"]
                ...
      
              3) If the GENERAL_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
      
                \`\`\`typescript
                ["", "general"]
                 ...
      
              4) If only the DEBUG_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
              
              Case 1 : If the issue is not solvable by doing some changes in the given code files, then the codeblock is generated only by adopting the DEBUG_PERSONA.
      
                terminal
                \`\`\`bash
                ["terminal", "debug"]
                 ...
      
      
              Case 2 : If the issue is solvable by doing some changes in the given code files, then this task is added to the """list""" of tasks for which the MODIFY_PERSONA will be adopted finally after all the tasks are processed. In that case since MODIFY_PERSONA is adopted, the codeblocks generated by this persona MUST be in the following format: 
      
                index.py
                \`\`\`python
                ["index.py", "modify"]
                 ...
      
      
            CRITICAL INSTRUCTIONs: 
            - In the final response, you MUST NOT include any information about the input you are given.
            - In the final response, you MUST NOT include any information about the persona you are adopting.
            - In the final response, you MUST NOT include any information about HOW you reached to the answer.
            - In the final response there should be no line separators.
      
            PERSONAS:
                `
        };


        // Create a Set to track which personas have been added
        const addedPersonas = new Set();
        // Add specific personas based on segregation types present in the array

        // Add specific personas based on segregation types present in the array
        model_1_output.segregated_query_array.forEach(query => {
            // Only add each persona type once
            if (query.segregation_type === 'modify' && !addedPersonas.has('modify')) {
                systemPrompt.content += modify_persona;
                addedPersonas.add('modify');
            }

            if (query.segregation_type === 'debug') {

                // Also add modify persona for debug requests if not already added
                if (!addedPersonas.has('modify')) {
                    systemPrompt.content += modify_persona;
                    addedPersonas.add('modify');
                }

                // Add debug persona if not already added
                if (!addedPersonas.has('debug')) {
                    systemPrompt.content += debug_persona;
                    addedPersonas.add('debug');
                }
            }

            if (query.segregation_type === 'explain' && !addedPersonas.has('explain')) {
                systemPrompt.content += explain_persona;
                addedPersonas.add('explain');
            }

            if (query.segregation_type === 'general' && !addedPersonas.has('general')) {
                systemPrompt.content += general_persona;
                addedPersonas.add('general');
            }
        });


        // Track unique filenames and snippet names using Sets
        const uniqueFiles = new Set();
        const uniqueSnippets = new Set();

        // Create files_needed array from all relevant_files in the queries
        const relevant_files_content = model_1_output.segregated_query_array
            .flatMap(query => query.relevant_files_names)
            .map(filename => {
                console.log("filename", filename);
                if (!uniqueFiles.has(filename)) {
                    uniqueFiles.add(filename);
                    const fileObj = codeFilesArray.find(file => Object.keys(file)[0] === filename);
                    return fileObj || null;
                }
                return null;
            })
            .filter(Boolean);

        // Create snippets_needed array from all relevant_snippets in the queries
        const relevant_snippets_content = model_1_output.segregated_query_array
            .flatMap(query => query.relevant_snippets_names)
            .map(snippetName => {
                console.log("snippetName", snippetName);
                if (!uniqueSnippets.has(snippetName)) {
                    uniqueSnippets.add(snippetName);
                    const snippetObj = codeSnippetArray.find(snippet =>
                        Object.keys(snippet)[0] === snippetName
                    );
                    return snippetObj || null;
                }
                return null;
            })
            .filter(Boolean);

        console.log('Unique files processed:', uniqueFiles);
        console.log('Files needed for processing:', relevant_files_content);
        console.log('Unique snippets processed:', uniqueSnippets);
        console.log('Snippets needed for processing:', relevant_snippets_content);





        const input_model_2 = {
            segregation_query_array: model_1_output.segregated_query_array,
            relevant_files_content: relevant_files_content,
            relevant_snippets_content: relevant_snippets_content,
            conversation_history: conversationHistory
        };

        messagesToSend = [
            systemPrompt,
            { role: 'user', content: JSON.stringify(input_model_2, null, 2) }  // Send as string instead of array
        ];

        console.log("messagesToSend to model 2", messagesToSend);

        // console.log("conversationHistory_before_sending_to_model", conversationHistory)



        let openai;
        switch (model) {
            case "gpt-4o":
                openai = openai_gpt;
                break;
            case "gpt-4o-mini":
                openai = openai_gpt;
                break;
            case "o1":
                openai = openai_gpt;
                break;
            case "o1-preview":
                openai = openai_gpt;
                break;
            case "o1-mini":
                openai = openai_gpt;
                break;
            case "gemini-2.0-flash-exp":
                openai = openai_gemini;
                break;
            case "gemini-1.5-flash":
                openai = openai_gemini;
                break;
            case "gemini-1.5-pro":
                openai = openai_gemini;
                break;
            case "gemini-1.5-flash-8b":
                openai = openai_gemini;
                break;
            case "llama-3.1-70b-versatile":
                openai = openai_groq;
                break;
            case "meta/llama-3.1-70b-instruct":
                openai = openai_nvidia;
                break;
            case "meta/llama-3.3-70b-instruct":
                openai = openai_nvidia;
                break;
            case "llama-3.3-70b-versatile":
                openai = openai_groq;
                break;
            case "meta/llama-3.1-405b-instruct":
                openai = openai_nvidia;
                break;
            case "microsoft/phi-3.5-moe-instruct":
                openai = openai_nvidia;
                break;
            case "qwen/qwen2.5-coder-32b-instruct":
                openai = openai_nvidia;
                break;
            case "Qwen/Qwen2.5-72B-Instruct":
                openai = openai_qwen_huggingface;
            case "meta-llama/Llama-3.3-70B-Instruct":
                openai = openai_qwen_huggingface;
            case "codellama/CodeLlama-34b-Instruct-hf":
                openai = openai_qwen_huggingface;
            case "deepseek-chat":
                openai = openai_deepseek;
                break;
            case "deepseek-reasoner":
                openai = openai_deepseek;
                break;
            case "claude-3.5-sonnet":
                break
            default:
                throw new Error(`Model ${model} not supported`);
        }

        // Set headers only once at the beginning
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let completeAssistantMessage = '';


        async function add_to_database(completeAssistantMessage) {
            const newAssistantMessage = await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    role: 'assistant',
                    content: completeAssistantMessage,
                    sequence: messageIdInt + 1
                }
            });

            const newInCompleteAssistantMessage = await prisma.completeMessage.create({
                data: {
                    conversationId: conversation.id,
                    role: 'assistant',
                    content: completeAssistantMessage,
                }
            })


            const inputTokens = countTokens(content, model);
            const outputTokens = countTokens(completeAssistantMessage, model);

            // Store token usage
            await prisma.tokenUsage.create({
                data: {
                    userId: userId,
                    model: model,
                    inputTokensUsed: inputTokens,
                    outputTokensUsed: outputTokens,
                }
            });

            console.log(`Created new assistant message with sequence ${messageIdInt + 1} for conversation ${conversation.id}`);
        }


        //other models start
        if (model != "claude-3.5-sonnet") {
            const chatCompletion = await openai.chat.completions.create({
                model: model,
                messages: messagesToSend,
                stream: true,
                // prefix_mode: true // Enable prefix mode for deepseek

            });

            for await (const chunk of chatCompletion) {
                console.log('\nReceived chunk from model:', chunk.choices[0]?.delta);  // Added raw chunk logging

                const assistantMessage = chunk.choices[0]?.delta?.content || chunk.choices[0]?.delta?.reasoning_content || '';
                if (assistantMessage) {
                    completeAssistantMessage += assistantMessage;

                    const deltaMessage = `event: delta\ndata: ${JSON.stringify({
                        v: assistantMessage,
                        accept_reject: "change",
                    })}\n\n`;
                    // console.log('Sending delta message:', { v: assistantMessage });
                    res.write(deltaMessage);

                }
            }
            res.write('event: done\ndata: [DONE]\n\n');
            res.end();
            console.log("completeAssistantMessage", completeAssistantMessage)
            await add_to_database(completeAssistantMessage)
            console.log('=== Chat Request Complete ===\n');

        }
        //other models end


        // claude model start
        else {

            console.log('=== Starting Claude Streaming API Call ===');


            // Use Claude's streaming API
            await anthropic.messages.stream({
                messages: messagesToSend,
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 8000,
            }).on('text', (text) => {
                // Accumulate the complete message
                completeAssistantMessage += text;
                console.log('Received text from model:', text);  // Added raw chunk logging

                // Format each chunk as a delta event for the frontend
                const deltaMessage = `event: delta\ndata: ${JSON.stringify({
                    v: text,
                })}\n\n`;

                res.write(deltaMessage);
            }).on('end', async () => {

                // Send completion event
                res.write('event: done\ndata: [DONE]\n\n');
                res.end();
                console.log("completeAssistantMessage", completeAssistantMessage)

                await add_to_database(completeAssistantMessage)
            }).on('error', (error) => {
                console.error('Error in streaming response:', error);

                // Send error event
                res.write(`event: error\ndata: ${JSON.stringify({
                    error: 'Error in streaming response'
                })}\n\n`);
                res.end();
            });



            console.log("=== Chat Request Complete ===\n");


        }
        // claude model end


    }



    catch (error) {
        console.error("Error in chat endpoint:", error);
        console.log("=== Chat Request Failed ===\n");

        // Check if headers have been sent before attempting to send error response
        if (!res.headersSent) {
            res.status(500).json({ error: "Error calling Groq API" });
        } else {
            // If headers were already sent, try to send error event
            try {
                res.write(
                    `event: error\ndata: ${JSON.stringify({
                        error: "Error calling Groq API",
                    })}\n\n`
                );
                res.end();
            } catch (e) {
                console.error("Error sending error event:", e);
            }
        }
    }

});



app.post('/api/mod_array', async (req, res) => {
    const { question, fileName, current_content, original_content, original_mod_array } = req.body;
    console.log("fileName", fileName);
    console.log("current_content", current_content);
    console.log("original_content", original_content);
    console.log("original_mod_array", original_mod_array);


    let obj_new_modify = {
        question: question,
        fileName: fileName,
        current_content: current_content,
        original_content: original_content,
        original_mod_array: original_mod_array
    }

    const systemPrompt = {
        role: 'assistant',
        content: `
    
    You are a Code Modification Reconciliation Expert, specialized in analyzing code changes and generating precise modification arrays.
  
  
  
    BACKEND ARCHITECTURE: In the backend of this application, there are two models:
  
    1. MODEL_1: This model has generated the modification array """original_mod_array""" for a given """question""" and the given code file with the given """current_content""" and has sent it to the user.
    
   2. MODEL_2: You are MODEL_2.  Your task is as follows : 
  - The user has modified a code file, and the modified content is provided as """current_content""".  
  - Your goal is to generate a new modification array called """modifications_array""" to ensure compatibility with the original logic.  
  - When the changes in """modifications_array""" are applied to """current_content""", the resulting file must reach the same state as if """original_mod_array""" were applied to """original_content""".  
  - Harmless or non-conflicting changes introduced by the user in "current_content" should not be completely removed.  
  - Retain user changes that do not conflict with or contradict the intent of """original_mod_array""".  
  - Remove or adjust changes in """current_content""" only if they are problematic or interfere with the original logic.  
  - Ensure the final state aligns with the intent of the original modification logic while preserving beneficial, non-conflicting changes.  
  
  
  
              ### Guidelines:
              1. For """modifications_array""":
                - The """modifications_array""" is the array of object of changes corresponding to the file with the given """fileName""" which is to be modified.
                - The """modifications_array""" MUST be a JSON string.
                - No comments or context needed.
      
              2. For """changes_array""" : 
                - The """changes_array""" is the array of objects present in the """modifications_array""" that contain the """original_code_snippet""" and """modified_code_snippet""" for the given file.
      
              3. """original_code_snippet""" :
                - The """original_code_snippet""" SHOULD be the EXACT code snippet that is present in the """current_content""" that needs to be modified.
                ### CRITICAL INSTRUCTIONS :
                - The """original_code_snippet""" MUST NEVER be empty. FAILURE TO FOLLOW THIS WILL RESULT IN INCOMPLETE OR INCORRECT MODIFICATIONS.  
                - If the new code has no direct relation to the existing functionality in """current_content""", you MUST STRICTLY treat the new code as an extension or enhancement to the existing functionality. Ensure it integrates seamlessly into the context of the file, rather than being standalone code. FAILURE TO FOLLOW THIS WILL RESULT IN INCORRECT PLACEMENT OF THE NEW CODE.
                - When adding new code that has no existing counterpart in the """current_content""", select a small, STANDALONE, logically COMPLETE block of code from the file as the """original_code_snippet""".
                - This block MUST provide proper context and make sense independently, ensuring it aligns with where the new code will appear — either **above**, **below**, or **inside** the selected snippet.
                - AVOID using arbitrary or incomplete lines; the """original_code_snippeT""" should represent a functional or meaningful unit of code, such as a full statement, function, or block, to maintain clarity and correctness.
                - It is CRUCIAL that when the """original_code_snippet""" is completely replaced by the """modified_code_snippet""", the new code integrates seamlessly and makes complete sense in the file.  
                - Give the """original_code_snippet""", while maintaining EXACT formatting, line endings (\r\n or \n), and indentation from the original file.  
                - NEVER add any unnecessary "\r\n" or "\n" at the end of the line in the """original_code_snippet""".
      
              4. """modified_code_snippet""" : 
                - The """modified_code_snippet""" is the code snippet that is to be added to the """current_content""" and is to replace the """original_code_snippet""".
                - It is CRUCIAL that when the """original_code_snippet""" is completely replaced by the """modified_code_snippet""", the new code integrates seamlessly and makes complete sense in the file.  
                - Give modifications STRICTLY based on the current code in """current_content""". 
      
      
              Your response must be in exactly this format:
      
      
              {
                "modifications_array": [
                  {
                    "filename": "filename1",
                    "changes_array": [
                      {
                        "original_code_snippet": "/* Original code snippet from filename1 */",
                        "modified_code_snippet": "/* Updated or newly added code snippet for filename1 */"
                      },
                      {
                        "original_code_snippet": "/* Another original code snippet from filename1 */",
                        "modified_code_snippet": "/* Corresponding updated code snippet for filename1 */"
                      }
                    ]
                  }
                ]
              }
       
      
              Example response:
      
              {
                "modifications_array": [
                {
                    "filename": "code.js",
                    "changes_array": [
                    {
                        "original_code_snippet": "                // Set sandbox options for the webview\r\n                sandbox: {\r\n                    allowScr: true,\r\n                }\r\n            }\r\n        );",
      
                        "modified_code_snippet": "        // Set sandbox options for the webview\r\n        sandbox: {\r\n            allowScripts: false,\r\n        }\r\n    }\r\n);"
                      },
                      {
                        "original_code_snippet": "function handleSubmit(){\r\n    console.log('Submitting form');\r\n    // Some additional logic here\r\n}",
                        "modified_code_snippet": "function calculateCube(num) {\r\n    return num * num * num;\r\n}\r\nfunction handleSubmit(){\r\n    console.log('Submitting form');\r\n    // Some additional logic here\r\n}"
                      }
                    ]
                  }
                ]
              }
  
      
              YOU MUST - After replacing all the """original_code_snippet""" with the """modified_code_snippet""", there should be NO ERROR in the final code present in the """relevant_files""".
      
      
  
  
  
        `
    };

    let messagesToSend = [
        systemPrompt,
        { role: 'user', content: JSON.stringify(obj_new_modify, null, 2) }  // Send as string instead of array
    ];


    try {
        // // Make non-streaming API call
        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            messages: messagesToSend,
            max_tokens: 1024,
            stream: false
        });


        // const extraction = await openai_gpt.chat.completions.create({
        //   model: "gpt-4o",
        //   messages: messagesToSend,
        //   stream: false,
        // })

        // const extraction = await openai_gemini.chat.completions.create({
        //   model: "gemini-2.0-flash-exp",
        //   messages: messagesToSend,
        //   stream: false,
        // })


        // const extractedContent = extraction.choices[0].message.content.trim();

        // console.log(extractedContent)

        // Log the complete response
        console.log('=== Model Response ===');
        console.log(response.content);
        console.log('=====================\n');

        // Parse the JSON string from the response
        // The model's response should be a valid JSON string containing the modifications_array
        const modificationArrayJson = response.content[0].text;
        // Log the extracted JSON
        console.log('=== Extracted Modification Array ===');
        console.log(modificationArrayJson);
        console.log('===================================\n');


        // Send only the modification array to frontend
        res.status(200).json({
            modifications_array: modificationArrayJson
        });

    } catch (error) {
        console.error('Error in API call:', error);
        res.status(500).json({
            error: 'Error generating modification array'
        });
    }



})

app.post("/api/code-suggestion", async (req, res) => {
    const { filePath, beforeCursor, afterCursor, cursorLine, cursorPosition, line } = req.body;

    console.log('\n=== New Code Suggestion Request ===');
    console.log(`File: ${filePath}`);
    console.log(`Line: ${line}`);
    console.log(`Before cursor`, beforeCursor);
    console.log(`After cursor`, afterCursor);

    const input_to_model = {
        filePath: filePath,
        beforeCursor: beforeCursor,
        afterCursor: afterCursor,
        line: line,
        cursorLine: cursorLine,
        cursorPosition: cursorPosition
    }


    const systemPrompt = {
        role: "system",
        content: `You are an expert code suggestion generator.

Input Object:
    {
        filePath: "filepath of the file to identify the file extension",
        beforeCursor: "code before the cursor", 
        afterCursor: "code after the cursor",
        line: "code of the line where the cursor is",
        cursorLine: "line number of the cursor",
        cursorPosition: "position of the cursor in the line"
    }

 Generate code suggestions by STRICTLY following these steps:

    ### Step 1: Context Analysis
          - Analyse the """beforeCursor""" and """afterCursor""" to understand the context of the code and keep in mind the chronology of the code.
          - See what the code is doing and what the user is trying to do.
          
          
    ### Step 2: [SUGGESTION] generation
    - Consider FULL code context while generating the [SUGGESTION]: """beforeCursor""" + [SUGGESTION] + """afterCursor"""
    - Match EXACT indentation with the code present around the """cursorPosition""" where the [SUGGESTION] is to be inserted.
    - Maintain code style of file.
    - Never include markdown or explanations
    - If adding blocks (if/for/etc), COMPLETE THEM IN [SUGGESTION].
    - NEVER go against the chronology of the code.
    - NEVER give a [SUGGESTION] which is ALREADY present very close to the """cursorPosition""".
    - Never give a [SUGGESTION] which is redundant.

    ### Step 3: Validation Check
    - beforeCursor + [SUGGESTION] + afterCursor = VALID SYNTAX
    - All brackets/parentheses in beforeCursor CLOSED in [SUGGESTION] or afterCursor
    - Indentation matches line property EXACTLY
    - No syntax errors when combined
    - No duplicate code from beforeCursor/afterCursor
    

    EXAMPLE VALID OUTPUT:
    Before: "function test() {" //line 1
    cursorLine: /line 2
    cursorPosition: 0
    After: "}" //line 3
    Suggestion: "console.log('test');"
    
    EXAMPLE INVALID OUTPUT:
    Before: "function test() {" // line 1
    cursorLine: // line 2
    cursorPosition: 0
    After: "}" // line 3
    Suggestion: "console.log('test');}"


    EXAMPLE INVALID OUTPUT:
    Before: "res.send('Post request received');" // line 1
    cursorLine: // line 2
    cursorPosition: 0
    Suggestion: "res.status(200).send('Data received successfully');"
    The above example is invalid because the suggestion is chronologically incorrect because the suggestion you are giving is neverg going to be executed after the existing code.


    EXAMPLE VALID OUTPUT:
    Before: "if (x > 5) {\n" // line 1
    cursorLine: // line 2
    cursorPosition: 0
    After: "console.log(x);" // line 3
    Suggestion: "for (let i = 0; i < 10; i++) {\n    console.log(i);\n}"

    In the above code since the suggestion is being inserted at line 2, hence it is never possible to close the if statement. In cases like this, you MUST return a suggestion that is itself a complete and syntactically correct code snippet that can be inserted at the cursor position.

    YOUR TASK: Generate the MINIMAL code that makes the complete file valid when inserted.`
    };


    const userPrompt = {
        role: "user",
        content: `
        ${JSON.stringify(input_to_model, null, 2)}
        `
    };

    try {
        console.log('\n=== Calling Codestral API ===');
        const startTime = Date.now();

        const response = await openai_gpt.chat.completions.create({
            messages: [systemPrompt, userPrompt],
            model: "gpt-4o-mini",
            // temperature: 0.1,
            // max_tokens: 128,
            // top_p: 0.95
        });

        // const response = await openai_codestral.chat.completions.create({
        //     messages: [systemPrompt, userPrompt],
        //     model: "mistralai/codestral-2501",
        //     temperature: 0.1,
        //     max_tokens: 128,
        //     top_p: 0.95
        // });

        // const response = await openai_gpt.chat.completions.create({
        //     messages: [systemPrompt, userPrompt],
        //     model: "gpt-4o",
        //     // temperature: 0.1,
        //     // max_tokens: 128,
        //     // top_p: 0.95
        // });
        const latency = Date.now() - startTime;

        console.log('API Response Latency:', `${latency}ms`);
        console.log('API Response Usage:', response.usage);
        console.log('Raw Suggestion:', response.choices[0].message.content);

        const suggestion = response.choices[0].message.content
            .replace(/```.*/g, '')
            .trim();

        console.log('Cleaned Suggestion:', suggestion);
        console.log('Suggestion Length:', suggestion.length);

        res.json({
            response: [{
                text: suggestion,
                detail: "Context-Perfect Suggestion",
                kind: "inline"
            }]
        });

    } catch (error) {
        console.error('\n=== Suggestion Error ===');
        console.error('Error Type:', error.name);
        console.error('Error Message:', error.message);
        if (error.response) {
            console.error('API Response Status:', error.response.status);
            console.error('API Response Data:', error.response.data);
        }
        console.error('Stack Trace:', error.stack);

        res.status(500).json({
            error: "Suggestion failed",
            details: error.message,
            code: error.code || 'NO_ERROR_CODE'
        });
    }
});


// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
