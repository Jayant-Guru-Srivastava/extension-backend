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

const prisma = new PrismaClient();
const app = express();
app.use(fileUpload()); // Enable file upload middleware
app.use(cors());
app.use(express.json());

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("Not authorized: Missing or invalid token")
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify token with your secret
    req.userId = decoded.id; // Attach user ID to the request
    next(); // Proceed to the next middleware
  } catch (err) {
    console.log('Authentication error:', err.message);
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
}

app.use('/api', authenticate); // Apply the authentication middleware to all routes starting with /api

async function call_model1(input_model_1) {
    const systemPrompt = {
        role: "assistant",
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

    ### Step 3: Identify Relevant Code
    - For each task, determine the related code and separate it into:
      - """relevant_snippets""": Specific lines or snippets directly referenced in or related to the task (e.g., "main.js (12-14)").
      - """relevant_files""": Full files that provide broader context for the task (e.g., "main.js").

    ### Step 4: Analyze Conversation History
    - Compare the current """user_query""" with the """conversation_history""" to determine if the task:
      - Is a continuation of a previous query (e.g., references earlier tasks or responses).
      - Introduces a new, unrelated query.
    - Mark each task with """continuation""" as either "true" or "false".

    ### Step 5: Construct a """relevant_conversation_history""" array 
    - If """continuation""" is true, then construct a """relevant_conversation_history""" array that contains those messages from the """conversation_history""" that are relevant to the current task.
    - If """continuation""" is false, then return an empty """relevant_conversation_history""" array.
    
    ### Step 6: Generate segregated task objects
    - For each segregated task, produce a structured object with the following fields:
      - """segregation_type""": The category of the task ("""debug""", """modify""", """explain""", or """general""").
      - """relevant_snippets""": An array containing the exact names of specific code snippets related to the task. These must be directly referenced from the """code_snippets""" array in the input without any modifications. Only the names of the snippets should be returned, without altering their content or structure.
      - """relevant_files""":  An array containing the exact names of specific code files related to the task. These must be directly referenced from the """code_files""" array in the input without any modifications. Only the names of the files should be returned, without altering their content or structure.
      - """continuation""": A boolean indicating whether the task is a continuation of the previous conversation.
      - """segregated_query""": The specific query extracted for this task.
      - """relevant_conversation_history""": The relevant conversation history for this task.

    ### Step 7: Generate """segregated_query_array"""
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
              "relevant_snippets": ["Array of specific code snippets related to this task, e.g., 'main.js (12-14)'."],
              "relevant_files": ["Array of file names providing broader context for this task, e.g., 'main.js'."],
              "continuation": "A boolean value (true/false) indicating whether this task continues a query from the """conversation_history""".",
              "segregated_query": "The actionable query or task description extracted from the """user_query""" for this specific task.",
              "relevant_conversation_history": "The relevant conversation history for this task."
            }
        ]
      }

    ### Examples:
    Input:
    {
      "user_query": "Explain why this function isn't returning the expected value and refactor it for better readability.",
      "code_snippets": [
        { "main.js (12-14)": "function add(a, b) { return a + b; }" }
      ],
      "code_files": [
        { "main.js": "function add(a, b) { return a + b; }\nconsole.log(add(1));" },
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
            "relevant_snippets": ["main.js (12-14)"],
            "relevant_files": ["main.js"],
            "continuation": true,
            "segregated_query": "Explain why the function 'add' isn't returning the expected value.",
            "relevant_conversation_history": [
               { "role": "user", "user_query": "give me the code for the function add" },
               { "role": "assistant", "assistant_response": "function add(a, b) { return a + b; }" },...
            ]
          }
        ]
    }



`,
    };

    const userPrompt = {
        role: "user",
        content: JSON.stringify(input_model_1, null, 2),
    };

    try {
        console.log("Calling Model 1 for content extraction...");

        // const extraction = await openai_gpt.chat.completions.create({
        //   model: "gpt-4o",
        //   messages: [systemPrompt, userPrompt],
        //   stream: false,
        // })

        const extraction = await openai_gemini.chat.completions.create({
            model: "gemini-2.0-flash-exp",
            messages: [systemPrompt, userPrompt],
            stream: false,
        });

        const extractedContent = extraction.choices[0].message.content.trim();

        // const extraction = await anthropic.messages.create({
        //   model: "claude-3-5-sonnet-20241022",
        //   messages: [systemPrompt, userPrompt],
        //   max_tokens: 1024,
        //   stream: false
        // });

        // const extractedContent = extraction.content[0].text;

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

let conversationHistory = [];

app.post("/api/chat", async (req, res) => {
    console.log("\n=== New Chat Request ===");
    try {
        const { content, messageId, isEdited, model } = req.body;
        console.log("Request Details:");
        console.log("Content:", content);
        console.log("Message ID:", messageId);
        console.log("Is Edited:", isEdited);
        console.log("Model:", model);

        let messageIdInt = parseInt(messageId);

        if (isEdited) {
            const index = conversationHistory.findIndex(
                (msg) => msg.id === messageIdInt
            );
            if (index !== -1) {
                conversationHistory = conversationHistory.slice(0, index);
            }
        }

        const uploadedFiles = req.files ? req.files.file_attached : null;
        const files = uploadedFiles
            ? Array.isArray(uploadedFiles)
                ? uploadedFiles
                : [uploadedFiles]
            : [];
        console.log("Files attached:", files.length);

        const uploadPath = path.join(__dirname, "uploads");
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
            console.log(`Created uploads directory at: ${uploadPath}`);
        }

        console.log("\nProcessing Files:");
        const codeFilesArray = []; // Initialize the array for code_files
        const codeSnippetArray = [];
        for (const file of files) {
            console.log("\nProcessing file:", file.name);

            // Check if the file name contains line numbers in brackets
            const lineNumberMatch = file.name.match(/\((\d+)-(\d+)\)$/);

            const targetPath = path.join(uploadPath, file.name);

            try {
                await file.mv(targetPath);
                console.log("File uploaded successfully:", file.name);

                const fileContent = fs.readFileSync(targetPath, "utf-8");

                if (lineNumberMatch) {
                    // Add to codeSnippetArray with line numbers
                    codeSnippetArray.push({ [file.name]: fileContent });
                } else {
                    // Add complete file to codeFilesArray as before
                    codeFilesArray.push({ [file.name]: fileContent });
                    console.log("Content added for:", file.name);
                }
            } catch (err) {
                console.error("Error processing file", file.name, ":", err);
                return res.status(500).send("File upload failed.");
            }
        }

        const input_model_1 = {
            user_query: content,
            code_snippets: codeSnippetArray,
            code_files: codeFilesArray,
            conversation_history: conversationHistory.slice(-6).map((entry) => {
                if (entry.role === "user") {
                    return { role: "user", user_query: entry.user_query };
                } else if (entry.role === "assistant") {
                    return {
                        role: "assistant",
                        assistant_response: entry.assistant_response,
                    };
                }
            }),
        };

        console.log("input_model_1", input_model_1);

        console.log("\nStarting content analysis...");
        let model_1_output = {};

        let model_1_output_json_string = "";
        model_1_output_json_string = await call_model1(input_model_1);
        // model_1_output = JSON.parse(model_1_output_json_string);

        const cleanedUpdates = model_1_output_json_string
            .split("\n") // Split the input into lines
            .slice(1, -1) // Remove the first and last lines
            .join("\n"); // Join the remaining lines back into a string
        console.log("cleanedUpdates", cleanedUpdates);
        model_1_output = JSON.parse(cleanedUpdates);

        console.log("model_1_output", model_1_output);

        let messagesToSend = [];

        const modify_persona = `

MODIFY_PERSONA: If the """segregation_type""" is """modify""", then take the following persona:
      
   
        You are an expert code MODIFIER and DEVELOPER. Your task is to provide clear, SPECIFIC code changes based on user requests. You MUST strictly follow every instruction below. If any instruction is unclear or conflicts with a user request, you MUST still adhere to these instructions as the highest priority.

        ### Guidelines:
        1. For """code_blocks""":
          - """code_blocks""" is the code snippet that you will send in the response.
          - In the """code_blocks""", show some lines of code those will be above and below the """modified_code_snippet""" to give context to the user. For the remaining lines, write //existing code
          - Modifications in the """code_blocks""" MUST be shown in the exact SAME sequence as they appear in the """relevant_files""".
          - All modifications to a single file MUST be shown in ONE unified """code_blocks""" - no splitting across multiple blocks. FAILURE TO DO THIS WILL RESULT IN UNNECESSARY CONFUSION.
          - Maintain EXACT indentation.

        2. For """modifications_array""":
          - The """modifications_array""" is the array of object of changes corresponding to each file from the """relevant_files""".
          - The """modifications_array""" MUST be a JSON string.
          - Place it immediately after the %%%% separator. While sending chunks in the response, you MUST send the all the %%%% together in the same chunk. FAILURE TO DO THIS WILL RESULT IN INCORRECT DETECTION OF THE START OF THE """modifications_array""".
          - When the """modifications_array""" is complete, write the %%%% separator again. While sending chunks in the response, you MUST send the all the %%%% together in the same chunk. FAILURE TO DO THIS WILL RESULT IN INCORRECT DETECTION OF THE END OF THE """modifications_array""".
          - No comments or context needed.

        3. For """changes_array""" : 
          - The """changes_array""" is the array of objects present in the """modifications_array""" that contain the """original_code_snippet""" and """modified_code_snippet""" for each file.

        4. """original_code_snippet""" :
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

        5. """modified_code_snippet""" : 
          - The """modified_code_snippet""" is the code snippet that is to be added to the """relevant_files""" and is to replace the """original_code_snippet""".
          - It is CRUCIAL that when the """original_code_snippet""" is completely replaced by the """modified_code_snippet""", the new code integrates seamlessly and makes complete sense in the file.  
          - Give modifications STRICTLY based on the current code in """relevant_files""". Ignore """conversation_history""" unless needed to ensure completeness, and include any missing elements in the modifications.

        6. For explanations:
          - Place immediately after the """modifications_array""".
          - Be clear and concise.
          - Explain what was changed and why.
          - If nothing is specified in the """segregated_query""", them give pointwise explanations for each modification.



        Your response must be in exactly this format:

        filename1
        \`\`\`language
        //[filename1,"modify"]

        //existing code

        """modified_code_snippet"""

        //existing code

        \`\`\`

        %%%%

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

        %%%%

        ### Explanation of changes made to filename1



        filename2
        \`\`\`language
        //[filename2,"modify"]

        //existing code

        """modified_code_snippet"""

        //existing code
        \`\`\`

        %%%%

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
          
        %%%%

        ### Explanation of changes made to filename2
            

 



        Example response:

        code.js
        \`\`\`javascript
        //["code.js", "modify"]

        // existing code

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

        // existing code
        \`\`\`

        %%%%

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

        %%%%

        ### Explanation of changes made to code.js

        1) Set the sandbox options for the webview to false. This is done to prevent the user from running the code in the browser.
        2) Added a new function calculateCube to the file. This is done to calculate the cube of a number.


        YOU MUST - After replacing all the """original_code_snippet""" with the """modified_code_snippet""", there should be NO ERROR in the final code present in the """relevant_files""".


        
        END OF MODIFY_PERSONA       ***************************************************************************************************************
`;

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

`;

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

`;

        const general_persona = `

GENERAL_PERSONA: If the """segregation_type""" is """general""", then take the following persona:

        You are a highly skilled and versatile coding assistant designed to assist developers with a wide range of programming-related queries. Your goal is to provide accurate, concise, and actionable responses tailored to the user's needs. You are equipped to handle questions across various domains of software development.

          ### Response Guidelines

          1) For technical explanations, use simple language when addressing basic concepts and detailed terminology for advanced topics.
          2) Provide code examples where applicable to enhance clarity.
          3) Suggest alternatives, optimizations, or best practices when relevant.
     
     
                 
        END OF GENERAL_PERSONA       ***************************************************************************************************************
        `;

        const systemPrompt = {
            role: "assistant",
            content: `
      
      You are an expert coding assistant designed to assist developers with modifying, debugging, explaining code, and answering general programming questions. Your role is to analyze incoming tasks, leverage context and history when necessary, and provide precise, actionable, and contextually appropriate responses.



      BACKEND ARCHITECTURE: In the backend of this application, there are two models:

      1. MODEL_1: We use this model to break the raw and cluttered """user_query""" into smaller, specific tasks, where each task addresses a single, distinct intent. This model receives the raw and cluttered """user_query""" provided by the user, """codeSnippetArray""" , """codeFilesArray""" and the """conversation_history"""  and then returns a """segregated_query_array""" which is an array of tasks having the """relevant_code_snippets""", """relevant__files""", """continuation""", """segregated_query""" and """relevant_conversation_history""" for a particular task.
      
      2. MODEL_2: You are MODEL_2. You are responsible for providing the response based on the """segregated_query_array""" and the """conversation_history""". 
            



      INPUT FORMAT:
        {
          "segregated_query_array": [
            {
              "segregation_type": "<task_type>",
              "relevant_snippets": ["<code_snippet1>", "<code_snippet2>"],
              "relevant_files": ["<code_file1>", "<code_file2>"],
              "continuation": <true_or_false>,
              "segregated_query": "<a particular task>",
              "relevant_conversation_history" : "<The relevant conversation history for this task>"
            },
            {
              "segregation_type": "<task_type>",
              "relevant_snippets": ["<code_snippet1>", "<code_snippet2>"],
              "relevant_files": ["<code_file1>", "<code_file2>"],
              "continuation": <true_or_false>,
              "segregated_query": "<another particular task>",
              "relevant_conversation_history" : "<The relevant conversation history for this task>"
            }
          ]
        }



      EXPLANATION OF FIELDS:

      1. """segregated_query_array""": The """segregated_query_array""" is an array of tasks, where the raw and cluttered user query is divided into multiple tasks, with each task needing to be processed separately by you.

        """segregation_type""": "A category of the task ("""debug""", """modify""", """explain""", or """general"""). ",
        """relevant_snippets""": "Array of specific code snippets related to this task, e.g., 'main.js (12-14)'.",
        """relevant_files""": "Array of file names providing broader context for this task, e.g., 'main.js'.",
        """continuation""": "A boolean value (true/false) indicating whether this task continues a query from the """conversation_history""".",
        """segregated_query""": "The actionable query or task description extracted from the """user_query""" for this specific task.",
        """relevant_conversation_history""": "The relevant conversation history for this task."


      STEPS TO GENERATE THE RESPONSE:
      
      Step 1: For each """segregation_type""" in the """segregated_query_array""", generate the response strictly in the same order as the """segregated_query_array""".

      Step 2 :  Below in the PERSONAS section you will be given the persona/personas based on the """segregation_type""", adopt that persona/personas and generate the response. For each codeblock in the response, you MUST follow the GUIDELINES FOR THE CODEBLOCKS IN THE RESPONSE section.

      Step 3: Based on the persona adopted in step 2, take the """segregated_query""" object from the """segregated_query_array""" and generate the response by keeping the """relevant_conversation_history""" in mind if the """continuation""" is true.
      
      Step 4: Repeat step 1 to 3 for all the """segregated_query""" object in the """segregated_query_array""".


      CRITICAL RESPONSE GUIDELINES:
      - The final response should be structured in a way so that if a particular persona is adopted for a particular """segregation_type""", then first that persona's response should be completed then the persona's response of the next """segregation_type""" should be started.
      - The final response should be structured in a way so that the response of the next persona starts only after the previous persona's response is complete.

      Example: 
      {
        segregated_query_array: [
          {
            segregation_type: 'debug',
            relevant_snippets: [Array],
            relevant_files: [Array],
            continuation: false,
            segregated_query: 'No overload matches this call.\r\n' +
              '  Overload 1 of 2, '(key: "jwtPayload", value: any): void', gave the following error.\r\n'   +
              '    Argument of type '"prisma"' is not assignable to parameter of type '"jwtPayload"'.\r\n' +
              '  Overload 2 of 2, '(key: never, value: never): void', gave the following error.\r\n' +
              '    Argument of type '"prisma"' is not assignable to parameter of type 'never'.\r\n' +
              '\r\n' +
              'debug this',
            relevant_conversation_history: []
          },
          {
            segregation_type: 'modify',
            relevant_snippets: [],
            relevant_files: [],
            continuation: false,
            segregated_query: 'add a for loop delay above the app.route',
            relevant_conversation_history: []
          }
        ]
      }


      In this example, the personas should be adopted in the following order:

      1. For the """debug""" task, 
        Step a) Adopt DEBUG_PERSONA. 
        Step b) Think if the issue is solvable by doing some changes in the given code files. If the answer is yes, go to step c. If the answer is no, then answer the query in the DEBUG_PERSONA and don't go to step c.
        Step c) then adopt MODIFY_PERSONA and generate the response.
 
      After everything related to the above """debug""" task is complete, then only move on to the """modify""" task in 2.
      2. For the """modify""" task, Adopt MODIFY_PERSONA and generate the response.



      GUIDELINES FOR THE CODEBLOCKS IN THE RESPONSE:
      - The codeblocks are generated based on the """segregation_type""" and the persona adopted.
      - The codeblocks should be structured in a way so that it is easy for user to understand and use the code provided in the codeblock. For example, if multiple terminal commands need to be executed, then write them in DIFFERENT DIFFERENT codeblocks rather than writing them in the same codeblock. FAIURE TO DO SO WILL INCREASE THE EFFORT FOR THE USER TO USE THE CODE.
      - For each codeblock in the response I want the name of the codefile this codeblock belongs to or related to at the top of the codeblock. If the codeblock doesn't belong to any file, then don't write anything.
      - For each code block, after the language and backticks, include a comment line mentioning an array with 2 elements.
        - The first element is the name of the codefile this codeblock belongs to or related to.
        - The second element is the """segregation_type""" of the task for which this codeblock is being generated.

      Example: Codeblocks should be in the following format based on the persona which is generating that particular codeblock.

        1) If the MODIFY_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
          code.js
           \`\`\`javascript
           //["code.js", "modify"]
           ...

        2) If the EXPLAIN_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
           main.js
           \`\`\`python
           //["main.js", "explain"]
          ...

        3) If the GENERAL_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 

          \`\`\`typescript
            //["", "general"]
           ...

        4) If the DEBUG_PERSONA is adopted then the codeblocks generated by this persona MUST be in the following format: 
        
        Case 1 : The codeblock is generated only by adopting the DEBUG_PERSONA.

          terminal
          \`\`\`bash
            //["terminal", "debug"]
           ...


        Case 2 : The codeblock is generated by adopting the DEBUG_PERSONA and the MODIFY_PERSONA since the issue is solvable by doing some changes in the given code files.

          index.py
          \`\`\`python
            //["index.py", "modify"]
           ...


           

      CRITICAL INSTRUCTIONs: 
      - In the final response, you MUST NOT include any information about the input you are given.
      - In the final response, you MUST NOT include any information about the persona you are adopting.
      - In the final response, you MUST NOT include any information about HOW you reached to the answer.
      - In the final response there should be no line separators.

      PERSONAS:
          `,
        };

        // Create a Set to track which personas have been added
        const addedPersonas = new Set();

        // Add specific personas based on segregation types present in the array
        model_1_output.segregated_query_array.forEach((query) => {
            // Only add each persona type once
            if (
                query.segregation_type === "modify" &&
                !addedPersonas.has("modify")
            ) {
                systemPrompt.content += modify_persona;
                addedPersonas.add("modify");
            }

            if (query.segregation_type === "debug") {
                // Also add modify persona for debug requests if not already added
                if (!addedPersonas.has("modify")) {
                    systemPrompt.content += modify_persona;
                    addedPersonas.add("modify");
                }

                // Add debug persona if not already added
                if (!addedPersonas.has("debug")) {
                    systemPrompt.content += debug_persona;
                    addedPersonas.add("debug");
                }
            }

            if (
                query.segregation_type === "explain" &&
                !addedPersonas.has("explain")
            ) {
                systemPrompt.content += explain_persona;
                addedPersonas.add("explain");
            }

            if (
                query.segregation_type === "general" &&
                !addedPersonas.has("general")
            ) {
                systemPrompt.content += general_persona;
                addedPersonas.add("general");
            }
        });

        model_1_output.segregated_query_array =
            model_1_output.segregated_query_array.map((query) => {
                return {
                    ...query,
                    // Transform relevant_snippets to include snippet contents
                    relevant_snippets: query.relevant_snippets
                        .map((snippetName) => {
                            const snippetObj = codeSnippetArray.find(
                                (snippet) =>
                                    Object.keys(snippet)[0] === snippetName
                            );
                            return snippetObj
                                ? { [snippetName]: snippetObj[snippetName] }
                                : null;
                        })
                        .filter(Boolean),

                    // Transform relevant_files to include file contents
                    relevant_files: query.relevant_files
                        .map((filename) => {
                            const fileObj = codeFilesArray.find(
                                (file) => Object.keys(file)[0] === filename
                            );
                            return fileObj
                                ? { [filename]: fileObj[filename] }
                                : null;
                        })
                        .filter(Boolean),
                };
            });

        const input_model_2 = {
            segregation_query_array: model_1_output.segregated_query_array,
        };

        messagesToSend = [
            systemPrompt,
            { role: "user", content: JSON.stringify(input_model_2, null, 2) }, // Send as string instead of array
        ];

        console.log("messagesToSend to model 2", messagesToSend);

        conversationHistory.push({
            role: "user",
            user_query: content,
            id: messageIdInt,
        });
        // console.log("conversationHistory_before_sending_to_model", conversationHistory)

        // Set headers only once at the beginning
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        // const chatCompletion = await openai_gpt.chat.completions.create({
        //   model: "gpt-4o",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await anthropic.messages.create({
        //   model: "claude-3-5-sonnet-20241022",
        //   messages: messagesToSend,
        //   stream: true,
        //   max_tokens: 1024,

        // })

        //   await anthropic.messages.stream({
        //     messages: messagesToSend,
        //     model: 'claude-3-5-sonnet-20241022',
        // max_tokens: 1024,
        // }).on('text', (text) => {
        //     console.log(text);
        //     res.write(text);
        // });

        // const chatCompletion = await openai_gemini.chat.completions.create({
        //   model: "gemini-1.5-flash",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        const chatCompletion = await openai_gemini.chat.completions.create({
            model: "gemini-2.0-flash-exp",
            messages: messagesToSend,
            stream: true,
        });

        // const chatCompletion = await openai_gemini.chat.completions.create({
        //   model: "gemini-1.5-pro",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_groq.chat.completions.create({
        //   model: "llama-3.1-70b-versatile",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // constchatCompletion = await openai_gemini.chat.completions.create({
        //   model: "gemini-1.5-flash-8b",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_nvidia.chat.completions.create({
        //   model: "microsoft/phi-3.5-moe-instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_nvidia.chat.completions.create({
        //   model: "meta/llama-3.1-405b-instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_nvidia.chat.completions.create({
        //   model: "meta/llama-3.3-70b-instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_nvidia.chat.completions.create({
        //   model: "meta/llama-3.1-70b-instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_nvidia.chat.completions.create({
        //   model: "qwen/qwen2.5-coder-32b-instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_qwen_huggingface.chat.completions.create({
        //   model: "Qwen/Qwen2.5-72B-Instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_qwen_huggingface.chat.completions.create({
        //   model: "meta-llama/Llama-3.3-70B-Instruct",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_groq.chat.completions.create({
        //   model: "llama-3.3-70b-versatile",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_qwen_huggingface.chat.completions.create({
        //   model: "codellama/CodeLlama-34b-Instruct-hf",
        //   messages: messagesToSend,
        //   stream: true,
        // })

        // const chatCompletion = await openai_deepseek.chat.completions.create({
        //   model: "deepseek-chat",
        //   messages: messagesToSend,
        //   stream: true,
        // })




        // ANTHROPIC API
        let completeAssistantMessage = "";

        // Use Claude's streaming API
        await anthropic.messages
            .stream({
                messages: messagesToSend,
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 5000,
            })
            .on("text", (text) => {
                // Accumulate the complete message
                completeAssistantMessage += text;
                console.log("\nReceived text from model:", text); // Added raw chunk logging

                // Format each chunk as a delta event for the frontend
                const deltaMessage = `event: delta\ndata: ${JSON.stringify({
                    v: text,
                })}\n\n`;

                res.write(deltaMessage);
            })
            .on("end", () => {
                console.log(completeAssistantMessage);

                // Add the complete message to conversation history
                conversationHistory.push({
                    role: "assistant",
                    assistant_response: completeAssistantMessage,
                    id: messageIdInt + 1,
                });

                // Send completion event
                res.write("event: done\ndata: [DONE]\n\n");
                res.end();
            })
            .on("error", (error) => {
                console.error("Error in streaming response:", error);

                // Send error event
                res.write(
                    `event: error\ndata: ${JSON.stringify({
                        error: "Error in streaming response",
                    })}\n\n`
                );
                res.end();
            });
    } catch (error) {
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

// ANTHROPIC API END





// other MODELS
//     let completeAssistantMessage = '';

//     for await (const chunk of chatCompletion) {
//       // console.log('\nReceived chunk from model:', chunk.choices[0]?.delta);  // Added raw chunk logging

//       const assistantMessage = chunk.choices[0]?.delta?.content || '';
//       if (assistantMessage) {
//         completeAssistantMessage += assistantMessage;

//         const deltaMessage = `event: delta\ndata: ${JSON.stringify({
//           v: assistantMessage,
//           accept_reject: "change",
//         })}\n\n`;
//         // console.log('Sending delta message:', { v: assistantMessage });
//         res.write(deltaMessage);

//       }
//     }

//     // Add logging for complete message
//     console.log('\nComplete Assistant Message:');
//     console.log('------------------------');
//     console.log(completeAssistantMessage);
//     console.log('------------------------\n');

//     conversationHistory.push({ role: 'assistant', assistant_response: completeAssistantMessage, id: messageIdInt + 1 });

//     // console.log("conversationHistory", conversationHistory);

//     console.log('\nCleaning up:');
//     if (fs.existsSync(uploadPath)) {
//       fs.rmSync(uploadPath, { recursive: true });
//       console.log('Uploads directory cleaned');
//     }

//     console.log('=== Chat Request Complete ===\n');

//     res.write('event: done\ndata: [DONE]\n\n');
//     res.end();

//   } catch (error) {
//     console.error('Error in chat endpoint:', error);
//     console.log('=== Chat Request Failed ===\n');

//     // Check if headers have been sent before attempting to send error response
//     if (!res.headersSent) {
//       res.status(500).json({ error: 'Error calling Groq API' });
//     } else {
//       // If headers were already sent, try to send error event
//       try {
//         res.write(`event: error\ndata: ${JSON.stringify({ error: 'Error calling Groq API' })}\n\n`);
//         res.end();
//       } catch (e) {
//         console.error('Error sending error event:', e);
//       }
//     }
//   }
// });

// other MODELS END

// app.post("/api/code-suggestion", async (req, res) => {
//     const { filePath, content, line, cursorPosition } = req.body;

//     console.log("Received request with the following data:");
//     console.log(`File Path: ${filePath}`);
//     console.log(`Content: ${content}`);
//     console.log(`Line: ${line}`);
//     console.log(`Cursor Position: ${cursorPosition}`);

//     // Prepare the input for the LLM model
//     // Prepare the input for the LLM model with clear instructions
//     const messagesToSend = [
//         {
//             role: "developer",
//             content: `You are an expert-level code generator powered by Groq AI. Your task is to provide intelligent code completions and implementations based on the context provided.

// When generating code:
// 1. You can provide single-line completions or full implementations based on comments
// 2. Follow existing code style patterns and project conventions
// 3. Generate contextually appropriate and production-ready code
// 4. Provide complete function/block implementations when needed
// 5. Add helpful comments for complex logic
// 6. Consider the file type, language, and framework context
// 7. Use variables and functions that are available in the current scope
// 8. Handle error cases and edge conditions appropriately
// 9. Support both completion and generation modes:
//    - Completion mode: Continue code from the cursor position
//    - Generation mode: Implement functionality based on comments

// The user message will contain:
// - File path and language context
// - Code before the cursor position
// - Current line and cursor position
// - Any comments or requirements for new implementations`,
//         },
//         {
//             role: "user",
//             content: `Complete the following code by continuing from exactly where the cursor is positioned. Only provide the completion part, not the entire code.

// File: ${filePath}
// Code up to cursor: ${content}
// Current line: ${line}
// Cursor position: ${cursorPosition}

// Important: Only return the code that should be inserted at the cursor position. Do not repeat any existing code before the cursor.`,
//         },
//     ];
//     console.log(
//         "Messages to be sent to the LLM: ",
//         JSON.stringify(messagesToSend, null, 2)
//     );

//     try {
//         // Call Groq API to generate code suggestions
//         const chatCompletion = await openai_gpt.chat.completions.create({
//             messages: messagesToSend,
//             model: "gpt-4o",
//             temperature: 0.3,
//             max_tokens: 8000,
//             top_p: 0.95,
//             stream: false,
//             stop: ["```"],
//         });

//         // Extract the response from the Groq API
//         const assistantMessage = chatCompletion.choices[0].message.content;

//         // Clean up the response to get just the code
//         let suggestion = assistantMessage;

//         // Remove any markdown code block markers
//         suggestion = suggestion
//             .replace(/```[\w]*\n?/g, "")
//             .replace(/```$/g, "");

//         // Calculate the indentation of the current line
//         const currentLineIndentation = line.match(/^\s*/)[0];

//         // Format the suggestion
//         suggestion = suggestion
//             .split("\n")
//             .map((line, index) => {
//                 // Remove any leading/trailing whitespace
//                 line = line.trim();
//                 // Add proper indentation to each line (except first line which continues from cursor)
//                 return index === 0 ? line : currentLineIndentation + line;
//             })
//             .join("\n");

//         // For single-line suggestions, ensure we don't add unnecessary newlines
//         suggestion = suggestion.trim();

//         // If the suggestion is a single line and the current line has content,
//         // make sure we don't add unnecessary indentation
//         const isSingleLine = !suggestion.includes("\n");
//         const currentLineHasContent = line.trim().length > 0;
//         if (isSingleLine && currentLineHasContent) {
//             suggestion = suggestion.trimStart();
//         }

//         let suggestion_to_send = line + suggestion;
//         console.log("Formatted suggestion:", suggestion_to_send);

//         const suggestions = [
//             {
//                 text: suggestion_to_send,
//                 detail: "Groq AI suggestion",
//                 kind: "inline",
//             },
//         ];

//         res.json({ response: suggestions });
//     } catch (error) {
//         console.error("Error generating code suggestion:", error);
//         res.status(500).json({ error: "Failed to generate code suggestion" });
//     }
// });

app.delete("/api/delete-file", (req, res) => {
    console.log("in delete route");
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: "Filename is required" });
    }

    const filePath = path.join(__dirname, "uploads", filename);

    // Check if the file exists and delete it
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).json({ error: "File not found" });
        }

        fs.unlink(filePath, (err) => {
            if (err) {
                return res.status(500).json({ error: "Error deleting file" });
            }
            res.status(200).json({
                message: `${filename} deleted successfully`,
            });
        });
    });
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
