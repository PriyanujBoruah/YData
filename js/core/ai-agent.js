// js/core/ai-agent.js
import { runQuery, getTableSchema, getTableStats, getDeepTableProfile } from './database.js';
import { getActivePersona } from '../modules/personas.js';
import { getAgenticContextString } from '../modules/agentic-bg.js';
import { getEmbeddings } from './vision-agent.js';
import { fetchWithRetry } from './utils.js';

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY; 
const API_URL = "https://api.mistral.ai/v1/chat/completions";

// User's Targeted Model Configuration
const MODELS = {
    ROUTER: "mistral-medium-2508",        
    ENGINEER: "mistral-large-2411",       
    STRATEGIST: "mistral-medium-2508",    
    TECH_AUDITOR: "mistral-medium-2508"          
};

const bigIntReplacer = (key, value) => 
    typeof value === 'bigint' ? value.toString() : value;

/**
 * ============================================================================
 * AGENT 1: The Router (Intent Classification)
 * ============================================================================
 */
async function getIntent(userQuestion) {
    const res = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: MODELS.ROUTER,
            messages:[{ 
                role: "system", 
                content: `You are a high-speed data router. Classify the user's request.
                
                INTENT TYPES:
                1. "EXPLAIN": User wants to understand the whole dataset or document.
                2. "QUERY": User asks for a specific calculation/SQL on the structured data.
                3. "DOC_CHAT": User asks a question about the content of an uploaded PDF or Image (Semantic search needed).
                4. "CHAT": Pure greetings or unrelated talk.

                CRITICAL RULES:
                - If the user mentions "explain", "summarize", or "data", set "intent" to "EXPLAIN" and "needs_sql" to true.
                - If the user asks about an invoice, receipt, document, or specific unstructured text, set "needs_rag" to true.

                Output valid JSON only: {"intent": "EXPLAIN"|"QUERY"|"DOC_CHAT"|"CHAT", "needs_sql": boolean, "needs_rag": boolean}` 
            }, { role: "user", content: userQuestion }],
            response_format: { type: "json_object" },
            temperature: 0
        })
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

/**
 * ============================================================================
 * AGENT 2: The Data Engineer (Self-Healing ReAct Loop)
 * ============================================================================
 */
/**
 * AGENT 2: The Data Engineer (Self-Healing ReAct Loop)
 * Updated to handle Data Manipulation (UPDATE, DELETE, ALTER) 
 * for real-time data cleaning.
 */
async function generateAndRunSQL(userQuestion, schema, activeTable, maxRetries = 2) {
    let currentAttempt = 0;
    let sqlErrorHistory = "";

    while (currentAttempt <= maxRetries) {
        const res = await fetchWithRetry(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
            body: JSON.stringify({
                model: MODELS.ENGINEER,
                messages:[{ 
                    role: "system", 
                    content: `You are an expert DuckDB SQL Engineer and Data Transformer. 
                    Target Table: "${activeTable}". 
                    Schema: [${schema}].
                    
                    TASK CLASSIFICATION:
                    1. If the user asks for information (How many, List, Summary, Average), use a SELECT statement.
                    2. If the user gives a COMMAND to change, clean, or fix data (Remove, Clean, Standardize, Delete, Fix), use UPDATE, DELETE, or ALTER TABLE to permanently modify the local vault.
                    
                    RULES:
                    1. ALWAYS use "ILIKE" for case-insensitive string comparisons.
                    2. Always quote table and column names with double quotes (e.g., UPDATE "${activeTable}" SET "phone" = ...).
                    3. For phone cleaning: To remove a prefix like '91', use 'CAST(SUBSTRING("column"::TEXT, 3) AS BIGINT)' or similar string manipulation.
                    4. DML LIMIT: When using UPDATE or DELETE, ensure the WHERE clause is accurate based on the user's instruction.
                    5. Output ONLY JSON: {"reasoning": "...", "sql": "query without semicolon"}
                    
                    ${sqlErrorHistory ? `FIX PREVIOUS ERROR: ${sqlErrorHistory}` : ''}`
                }, { role: "user", content: userQuestion }],
                response_format: { type: "json_object" },
                temperature: 0.1 
            })
        });

        const data = await res.json();
        const plan = JSON.parse(data.choices[0].message.content);

        try {
            // Execute the query in the local Wasm DuckDB
            const dbResult = await runQuery(plan.sql);

            // Detect if this query modified the database
            const upperSql = plan.sql.trim().toUpperCase();
            const isModification = upperSql.startsWith("UPDATE") || 
                                   upperSql.startsWith("DELETE") || 
                                   upperSql.startsWith("ALTER") || 
                                   upperSql.startsWith("INSERT") ||
                                   upperSql.startsWith("DROP");

            return { 
                success: true, 
                sql: plan.sql, 
                reasoning: plan.reasoning, 
                data: dbResult,
                isModification: isModification 
            };
        } catch (error) {
            currentAttempt++;
            sqlErrorHistory = error.message;
            
            // If we ran out of retries, return the failure
            if (currentAttempt > maxRetries) {
                return { success: false, error: error.message, sql: plan.sql };
            }
            // Otherwise, the loop continues and the error is fed back to the LLM to fix the SQL
        }
    }
}

/**
 * ============================================================================
 * AGENT 3: Vector Search (RAG Engine)
 * ============================================================================
 */
async function findRelevantContext(userQuestion) {
    try {
        const queryVector = await getEmbeddings(userQuestion);

        // Uses DuckDB's list_cosine_similarity for native vector math
        const sql = `
            SELECT raw_content, file_name, 
                   list_cosine_similarity(embedding,[${queryVector.join(',')}]) as score
            FROM knowledge_base
            WHERE score > 0.4
            ORDER BY score DESC
            LIMIT 3
        `;
        
        const results = await runQuery(sql);
        
        if (results.length === 0) return null;
        return results.map(r => `[Source: ${r.file_name}]: ${r.raw_content}`).join('\n\n');
    } catch (e) {
        console.warn("Vector search bypassed (knowledge_base table likely empty):", e);
        return null;
    }
}

/**
 * ============================================================================
 * AGENT 4: The Strategist (Unified Multimodal Intelligence)
 * ============================================================================
 */
async function* streamStrategistWithContext(userQuestion, sqlData, docText, globalStats, schema, sqlReasoning) {
    const persona = getActivePersona();
    const backgroundContext = getAgenticContextString();

    const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: MODELS.STRATEGIST,
            stream: true,
            messages:[
                { 
                    role: "system", 
                    content: `You are an Indian Data Strategist. Your name is YData ${persona.name}.
                    You evaluate structured SQL data and unstructured Document snippets.

                    --- ABOUT YDATA ---
                    YData (Y-Data) is the first Made-in-India, Made-for-India Agentic AI data workforce company.
                    Developed by engineers and researchers from IIT Madras, Vellore Institute of Technology and Harvard University.
                    YData offers several workforce profiles for various data analysis and business intelligence tasks for industries like E-Commerce, D2C, marketing, and other data-driven industries.
                    YData uses specialized trained and fine tuned LLMs for these tasks.

                    --- PERSONA SETTINGS ---
                    Role: ${persona.name}
                    Instructions: ${persona.instructions}
                    ${backgroundContext}
                    
                    --- DATA CONTEXT ---
                    ${globalStats ? `GLOBAL DATASET PROFILE (ALL ROWS): ${JSON.stringify(globalStats)}` : ''}
                    SCHEMA: ${schema}
                    SQL RESULTS: ${sqlData || "None"}
                    ${sqlReasoning ? `ENGINEER'S NOTE: ${sqlReasoning}` : ''}
                    DOCUMENT SNIPPETS (RAG): ${docText || "None"}
                    
                    --- TASK ---
                    Answer the user's question using the provided context.
                    - If explaining a dataset, use the GLOBAL PROFILE for statistics (do not rely on the Sample SQL rows for stats).
                    - If info is in the DOCUMENT SNIPPETS, clearly cite the filename.
                    - Give the strategic insights based primarily for India and Indian organizations unless stated otherwise.
                    - Use markdown. Highlight key numbers in bold.
                    
                    --- VISUALIZATION CAPABILITY ---
                    You can generate 12 types of diagrams using Markdown 'mermaid' blocks.
                    ALLOWED TYPES: 
                    1. pie title "Title"
                    2. graph TD or graph LR
                    3. sequenceDiagram
                    4. mindmap
                    5. timeline
                    6. erDiagram
                    7. stateDiagram-v2
                    8. journey
                    9. classDiagram
                    10. gitGraph
                    11. requirementDiagram
                    12. xychart-beta

                    STRICT RULES:
                    - ALWAYS wrap labels in double quotes (e.g., A["My Label"]).
                    - NO semicolons at the end of lines.
                    - DO NOT use 'quadrantDiagram' or 'gantt'.` 
                },
                { role: "user", content: userQuestion }
            ],
            temperature: 0.4
        })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const json = JSON.parse(line.replace('data: ', ''));
                    const content = json.choices[0].delta.content;
                    if (content) yield { type: 'text', content: content };
                } catch (e) {}
            }
        }
    }
}

/**
 * ============================================================================
 * MAIN CONVERSATION PIPELINE
 * ============================================================================
 */
export async function* askAgentStream(userQuestion, activeTable) {
    let schema = "";
    if (activeTable) {
        try { schema = await getTableSchema(activeTable); } catch(e) { console.warn(e); }
    }

    // 1. ROUTE
    yield { type: 'status', content: "Understanding intent..." };
    const routing = await getIntent(userQuestion);

    let globalStats = null;
    let sqlResults = "";
    let docContext = "";
    let sqlUsed = "";
    let sqlReasoning = "";

    // 2. DATA GATHERING

    // A. Perform Vector Search (RAG)
    if (routing.needs_rag || routing.intent === "DOC_CHAT") {
        yield { type: 'status', content: "Searching vector vault for relevant snippets..." };
        docContext = await findRelevantContext(userQuestion);
    }

    // B. Perform SQL Execution
    if (routing.intent === "EXPLAIN" && activeTable) {
        yield { type: 'status', content: "Performing deep audit on all rows..." };
        globalStats = await getDeepTableProfile(activeTable);
        
        yield { type: 'status', content: "Fetching visual data sample..." };
        const sample = await generateAndRunSQL("Show 10 row sample", schema, activeTable);
        if (sample.success) {
            sqlResults = JSON.stringify(sample.data, bigIntReplacer);
            sqlUsed = sample.sql;
            sqlReasoning = "Structural overview + Global statistical profile.";
        }
    } else if (routing.needs_sql && activeTable) {
        yield { type: 'status', content: "Generating query..." };
        const execution = await generateAndRunSQL(userQuestion, schema, activeTable);
        if (!execution.success) {
            yield { type: 'error', content: `Database Error: ${execution.error}` };
            return;
        }
        sqlResults = JSON.stringify(execution.data.slice(0, 15), bigIntReplacer);
        sqlUsed = execution.sql;
        sqlReasoning = execution.reasoning;
    }

    if (sqlUsed) yield { type: 'sql', content: sqlUsed };

    // 3. SYNTHESIZE
    yield { type: 'status', content: "Synthesizing cross-engine insights..." };
    
    // Pass everything to the unified Strategist
    yield* streamStrategistWithContext(userQuestion, sqlResults, docContext, globalStats, schema, sqlReasoning);
}

/**
 * ============================================================================
 * EXECUTIVE NARRATIVE ENGINE
 * ============================================================================
 */
export async function* streamDataStory(activeTable) {
    yield { type: 'status', content: "Gathering statistical facts..." };
    const { totalRows, facts } = await getTableStats(activeTable);
    const backgroundContext = getAgenticContextString();

    yield { type: 'status', content: "Strategizing executive narrative..." };

    const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: MODELS.STRATEGIST,
            stream: true,
            messages:[
                { 
                    role: "system", 
                    content: `You are a CSO. Write a high-level "Data Story" for "${activeTable}". Total Records: ${totalRows}.
                    Context: ${backgroundContext}
                    Facts: ${facts}
                    Focus on Value, Risks, and 3 Tactical Actions. Markdown only.` 
                },
                { role: "user", content: "Tell me the story behind this data." }
            ],
            temperature: 0.5
        })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const json = JSON.parse(line.replace('data: ', ''));
                    const content = json.choices[0].delta.content;
                    if (content) yield { type: 'text', content: content };
                } catch (e) {}
            }
        }
    }
}

/**
 * ============================================================================
 * ADVANCED NARRATIVE ENGINE
 * ============================================================================
 */
export async function* streamAdvancedNarrative(activeTable) {
    yield { type: 'status', content: "Stage 1: Deep technical audit..." };
    const profile = await getDeepTableProfile(activeTable);

    const techBriefResponse = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: MODELS.TECH_AUDITOR, 
            messages:[{
                role: "system",
                content: `Analyze this dataset profile: ${activeTable} | Total Rows: ${profile.totalRows}
                Profile: ${profile.columns.join('\n')}
                OUTPUT ONLY TECHNICAL FINDINGS BULLETS.`
            }],
            temperature: 0.1
        })
    });
    
    const techData = await techBriefResponse.json();
    const techBrief = techData.choices[0].message.content;
    const backgroundContext = getAgenticContextString();

    yield { type: 'status', content: "Stage 2: Strategic synthesis..." };

    const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: MODELS.STRATEGIST, 
            stream: true,
            messages:[
                { 
                    role: "system", 
                    content: `You are a CSO. Context: ${backgroundContext}. 
                    Technical Brief: [${techBrief}]. 
                    Write an Executive Data Story with sections: Narrative, Critical Insights, Roadmap.` 
                },
                { role: "user", content: "Present the strategic story." }
            ],
            temperature: 0.6
        })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const json = JSON.parse(line.replace('data: ', ''));
                    const content = json.choices[0].delta.content;
                    if (content) yield { type: 'text', content: content };
                } catch (e) {}
            }
        }
    }
}

/**
 * ============================================================================
 * PROACTIVE INSIGHT GENERATOR
 * ============================================================================
 */
export async function generateProactiveInsights(tableName, schema) {
    const res = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: "mistral-small-2603", 
            messages:[{
                role: "system",
                content: `You are a proactive data assistant. Suggest 6 clickable analysis pills based on a dataset.
                
                STRICT CONSTRAINTS:
                - 3 Pills for "General Analysis" (Statistical inference, data cleaning).
                - 3 Pills for "Visualizations" (Tailored to the 12 supported Mermaid.js types like pie, timeline, mindmap, xychart-beta).
                
                PILL FORMAT:
                - Use a single relevant emoji at the start.
                - Maximum 50 characters per pill.
                - Visual pills must use language like "Graph...", "Map...", "Pie chart...", "Timeline of...".
                
                Table: ${tableName}
                Schema: ${schema}
                
                Output ONLY JSON: {"pills": ["Emoji Text", ...]}`
            }],
            response_format: { type: "json_object" },
            temperature: 0.7
        })
    });

    const data = await res.json();
    return JSON.parse(data.choices[0].message.content).pills;
}
