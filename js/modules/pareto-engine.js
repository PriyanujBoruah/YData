// js/modules/pareto-engine.js
import { runQuery, getTableSchema } from '../core/database.js';
import { fetchWithRetry } from '../core/utils.js';
import { getActivePersona } from './personas.js';

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY;
const API_URL = "https://api.mistral.ai/v1/chat/completions";

// Helper for BigInt serialization during AI calls
const bigIntReplacer = (key, value) => typeof value === 'bigint' ? value.toString() : value;

/**
 * 🚀 THE ARITHMETIC SHIELD
 * Turns raw column names into cleaned, calculable DOUBLE types.
 */
const sqlClean = (col) => `TRY_CAST(regexp_replace(CAST(${col} AS VARCHAR), '[^0-9.]', '', 'g') AS DOUBLE)`;

let lastAuditMarkdown = ""; 

/**
 * UI: Resets and opens the Pareto Modal
 */
export async function openParetoModal() {
    const resultView = document.getElementById('pareto-result-view');
    const runBtn = document.getElementById('btn-run-pareto-auto');
    const chatBtn = document.getElementById('btn-pareto-to-chat');
    const resetBtn = document.getElementById('btn-pareto-reset');
    const status = document.getElementById('pareto-status-bar');
    const output = document.getElementById('pareto-output-container');

    if (resultView) resultView.style.display = 'none';
    if (runBtn) runBtn.style.display = 'block';
    if (chatBtn) chatBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    if (status) status.classList.add('hidden');
    if (output) output.innerHTML = "";

    window.openModal('pareto-modal');
}

/**
 * CORE ENGINE: Audit-Grade Autonomous Pareto Engine
 */
export async function runAutonomousAudit(tableName) {
    const statusText = document.getElementById('pareto-status-text');
    const output = document.getElementById('pareto-output-container');
    const runBtn = document.getElementById('btn-run-pareto-auto');
    const persona = getActivePersona();

    document.getElementById('pareto-status-bar').classList.remove('hidden');
    runBtn.style.display = 'none';
    output.innerHTML = `<div class="p-20 text-center text-gray-400 italic">Initiating full-scale mathematical audit...</div>`;

    try {
        const columnData = await runQuery(`PRAGMA table_info('${tableName}')`);
        const availableCols = columnData.map(c => c.name);

        const totalRowsRes = await runQuery(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const totalRows = Number(totalRowsRes[0].count);

        // --- STAGE 1: THE RESEARCH PLAN (Architect Agent) ---
        statusText.innerText = "Architecting Multi-Driver Audit Plan...";
        const planResponse = await fetchWithRetry(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
            body: JSON.stringify({
                model: "mistral-small-latest",
                messages: [{
                    role: "system",
                    content: `You are a Lead Data Strategist. 
                    COLUMNS: [${availableCols.join(', ')}]
                    ACTIVE PERSONA: ${persona.instructions}

                    TASK: Identify 3 distinct 80/20 (Pareto) analyses for this business.
                    
                    STRICT RULES:
                    1. For 'met' (metric), provide ONLY a raw math expression (e.g. "Qty" * "Price") or a column name.
                    2. ❌ NEVER use 'SUM', 'COUNT', or commas in the 'met' field.
                    3. ALWAYS use double quotes for column names.
                    4. Return ONLY JSON: {"analyses": [{"dim": "col", "met": "expression", "title": "Title"}]}`
                }],
                response_format: { type: "json_object" }
            })
        });
        
        const planData = await planResponse.json();
        const { analyses } = JSON.parse(planData.choices[0].message.content);

        // --- THE FUZZY AUTOCORRECT LAYER ---
        const findBestColumnMatch = (name) => {
            const clean = name.replace(/"/g, '').trim().toLowerCase();
            let match = availableCols.find(c => c.toLowerCase() === clean);
            if (match) return match;
            match = availableCols.find(c => c.toLowerCase().includes(clean) || clean.includes(c.toLowerCase()));
            return match || availableCols[0];
        };

        let masterResults = [];
        let allTablesHtml = "";
        let paretoFacts = []; 
        let mathProofs = [];

        // --- STAGE 2: THE EXECUTION LOOP (Hardened SQL) ---
        for (const item of analyses) {
            statusText.innerText = `Analyzing Driver: ${item.title}...`;

            // 🚀 Logic Fix: Unified Sanitization
            const correctedDim = findBestColumnMatch(item.dim);
            
            // Clean AI string: Remove keywords, fix commas, strip brackets
            let baseMet = item.met.replace(/SUM|COUNT|DISTINCT|AVG|MAX|MIN/gi, '')
                                 .replace(/[()]/g, '')
                                 .replace(/,/g, ' + ');

            // Apply sqlClean to every column identified in the metric
            const metricSql = baseMet.replace(/"?([a-zA-Z0-9_ ]+)"?/g, (match) => {
                const rawName = match.replace(/"/g, '').trim();
                if (!isNaN(rawName) || rawName === '') return rawName; 
                return sqlClean(`"${findBestColumnMatch(rawName)}"`);
            });

            // 🚀 The Full Dataset Audit Query
            const sql = `
                WITH raw_aggregated AS (
                    SELECT 
                        "${correctedDim}" as label, 
                        SUM(${metricSql}) as total_val
                    FROM "${tableName}" 
                    WHERE "${correctedDim}" IS NOT NULL AND "${correctedDim}" != ''
                    GROUP BY 1
                ),
                full_stats AS (
                    SELECT COUNT(*) as unique_count, SUM(total_val) as global_sum FROM raw_aggregated WHERE total_val > 0
                ),
                cumulative AS (
                    SELECT 
                        label, total_val,
                        SUM(total_val) OVER (ORDER BY total_val DESC) as running_total,
                        (SELECT global_sum FROM full_stats) as total_sum,
                        (SELECT unique_count FROM full_stats) as total_count,
                        ROW_NUMBER() OVER (ORDER BY total_val DESC) as rank
                    FROM raw_aggregated WHERE total_val > 0
                )
                SELECT label, total_val, total_sum, total_count, rank,
                (running_total * 100.0 / total_sum) as pct_contribution
                FROM cumulative ORDER BY total_val DESC
            `;

            const data = await runQuery(sql);
            if (!data || data.length === 0) continue;

            // Mathematical Proof Extraction
            const topRow = data[0];
            const paretoRow = data.find(r => r.pct_contribution >= 80) || data[data.length - 1];
            
            const proof = {
                title: item.title,
                totalSum: Number(topRow.total_sum),
                totalEntities: Number(topRow.total_count),
                whaleCount: Number(paretoRow.rank),
                whalePercentage: ((Number(paretoRow.rank) / Number(topRow.total_count)) * 100).toFixed(1)
            };
            mathProofs.push(proof);
            paretoFacts.push(`${proof.whalePercentage}% of ${correctedDim} accounts for 80% of total ${item.title}`);

            masterResults.push({ ...item, data: data.slice(0, 10) });

            allTablesHtml += `
                <div class="my-6">
                    <h4 class="text-blue-700 font-bold mb-2">${item.title}</h4>
                    <div class="table-scroll-container">
                        <table>
                            <thead><tr><th>${correctedDim}</th><th>Value</th><th>Cumulative %</th><th>Rank</th></tr></thead>
                            <tbody>
                                ${data.slice(0, 10).map(r => `
                                    <tr>
                                        <td><strong>${r.label}</strong></td>
                                        <td>₹${Number(r.total_val).toLocaleString()}</td>
                                        <td class="text-blue-600 font-bold">${Number(r.pct_contribution).toFixed(1)}%</td>
                                        <td class="text-gray-400 text-xs">#${r.rank}</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>\n`;
        }

        // --- STAGE 3: SYNTHESIS (Mistral Large) ---
        statusText.innerText = "Chief Strategist is finalizing the Dossier...";
        const finalResponse = await fetchWithRetry(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
            body: JSON.stringify({
                model: "mistral-large-latest",
                messages: [{
                    role: "system",
                    content: `You are a Senior Strategic Consultant. 
                    MATH PROOFS: ${JSON.stringify(mathProofs, bigIntReplacer)}
                    
                    TASK: Write a 1000-word Strategic Concentration Audit. 

                    🚀 OPENING RULE:
                    The very first line of your response must be exactly: "Analysed ${totalRows.toLocaleString()} number of rows" (formatted in plain text or italics). 
                    
                    STRICT RULES:
                    1. After the opening line, start the report with: "# 🚨 STRATEGIC CONCENTRATION ALERT".
                    2. Directly below, create a blockquote (>) listing the Pareto percentages.
                    3. Include a chapter "## 🔢 MATHEMATICAL VERIFICATION" detailing the Global Totals and Unique Counts.
                    4. DO NOT include "Next Steps", "Roadmaps", or schedules.
                    5. No emojis (except in the title). Use executive terminology.
                    6. End strictly with the final strategic conclusion.

                    Embed these tables: \n${allTablesHtml}`
                }]
            })
        });

        const report = (await finalResponse.json()).choices[0].message.content;
        lastAuditMarkdown = report;

        document.getElementById('pareto-result-view').style.display = 'block';
        output.innerHTML = marked.parse(report);
        document.getElementById('pareto-status-bar').classList.add('hidden');
        document.getElementById('btn-pareto-to-chat').style.display = 'block';
        document.getElementById('btn-pareto-reset').style.display = 'block';
        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Pareto Audit Failed:", err);
        statusText.innerText = "Analysis interrupted. Check console for details.";
        runBtn.style.display = 'block';
    }
}

export function sendToChat() {
    if (!lastAuditMarkdown) return;
    window.dispatchEvent(new CustomEvent('send-viz-to-chat', { detail: lastAuditMarkdown }));
    window.closeAllModals();
}