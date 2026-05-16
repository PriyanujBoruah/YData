// js/modules/auto-clean.js
import { runQuery } from '../core/database.js';

export async function runAutoClean(tableName) {
    const resultsView = document.getElementById('quality-results-view');
    const initialView = document.getElementById('quality-initial-view');
    const details = document.getElementById('quality-details');
    const scoreContainer = document.getElementById('quality-score-container');
    const footer = document.getElementById('quality-footer');

    initialView.classList.add('hidden');
    resultsView.classList.remove('hidden');
    footer.classList.add('hidden');
    
    scoreContainer.innerHTML = `<h4 class="font-bold text-blue-600 animate-pulse">Deep Type-Inference & Scrubbing...</h4>`;

    try {
        const columns = await runQuery(`PRAGMA table_info('${tableName}')`);
        let selectClauses = [];
        let cleanActions = [];

        for (const col of columns) {
            const colName = col.name;
            const colType = col.type.toUpperCase();
            
            const isNumeric = /price|amount|cost|qty|count|total|quantity|age|score/i.test(colName);
            const isTemporal = /date|time|timestamp/i.test(colName);
            const isID = /id|key|uuid|ref|code/i.test(colName);

            // 1. HARDENED NUMERIC CLEANING
            if (isNumeric && !isID) {
                // Logic: 1. Convert to Double, 2. Calc Mean, 3. Fill Nulls, 4. Absolute Value
                // We use NULLIF to turn empty strings into real NULLs first
                const casted = `TRY_CAST(NULLIF(TRIM("${colName}"), '') AS DOUBLE)`;
                selectClauses.push(`ABS(COALESCE(${casted}, AVG(${casted}) OVER())) AS "${colName}"`);
                cleanActions.push(`Standardized and imputed Mean in [${colName}]`);
            } 
            
            // 2. HARDENED TEMPORAL CLEANING (Multi-Format Support)
            // 2. HARDENED TEMPORAL CLEANING (V1.1 - Multi-Format & Trailing Character Safe)
            else if (isTemporal) {
                /**
                 * 🚀 THE STRATEGY:
                 * 1. Use try_strptime: It returns NULL instead of crashing if the format is wrong.
                 * 2. Consume Trailing Characters: Add %H:%M or similar to handle time stamps.
                 * 3. Substring extraction: If all else fails, grab just the first 10 characters (the date).
                 */
                const castChain = [
                    // 1. Try native timestamp (Very good at guessing 12/1/2010 8:26)
                    `TRY_CAST("${colName}" AS TIMESTAMP)`,
                    
                    // 2. Try US/Retail format with time (12/1/2010 8:26)
                    `try_strptime("${colName}", '%m/%d/%Y %H:%M')`,
                    
                    // 3. Try UK/India format with time (21/03/2018 14:30)
                    `try_strptime("${colName}", '%d/%m/%Y %H:%M')`,
                    
                    // 4. Try Indian format with dashes (21-03-2018)
                    // We take the first 10 chars to ensure "trailing characters" don't kill it
                    `try_strptime(SUBSTRING("${colName}", 1, 10), '%d-%m-%Y')`,
                    
                    // 5. Try Indian format with slashes (21/03/2018)
                    `try_strptime(SUBSTRING("${colName}", 1, 10), '%d/%m/%Y')`,
                    
                    // 6. Hard Fallback
                    `'1970-01-01'::DATE`
                ].join(', ');

                const casted = `COALESCE(${castChain})`;
                
                // Fill gaps using Last Value Observed (LOCF)
                selectClauses.push(`last_value(${casted} IGNORE NULLS) OVER (ORDER BY rowid) AS "${colName}"`);
                cleanActions.push(`Standardized mixed temporal patterns in [${colName}]`);
            }

            // 3. HARDENED TEXT & EMOJI SCRUBBING
            else if (!isID) {
                // Logic: 1. Trim, 2. Lower, 3. Unicode Scrub, 4. Mode Impute
                const modeSubquery = `(SELECT "${colName}" FROM "${tableName}" WHERE "${colName}" != '' AND "${colName}" IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1)`;
                
                // This regex specifically targets everything outside standard Latin/Punctuation
                const scrubbed = `regexp_replace(COALESCE(NULLIF(TRIM(LOWER("${colName}")), ''), ${modeSubquery}), '[^\\x00-\\x7F]+', '', 'g')`;
                
                selectClauses.push(`${scrubbed} AS "${colName}"`);
                cleanActions.push(`Sanitized and imputed Mode in [${colName}]`);
            }

            // 4. ID PRESERVATION
            else {
                selectClauses.push(`TRIM("${colName}") AS "${colName}"`);
                cleanActions.push(`Preserved identifier integrity in [${colName}]`);
            }
        }

        const cleanedTableName = `${tableName}_cleaned`;
        await runQuery(`DROP TABLE IF EXISTS "${cleanedTableName}"`);
        const finalSql = `CREATE TABLE "${cleanedTableName}" AS SELECT * EXCLUDE (${columns.map(c => '"' + c.name + '"').join(', ')}), 
        ${selectClauses.join(', ')} 
        FROM "${tableName}"`;
        await runQuery(finalSql);

        // Success UI
        scoreContainer.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="p-3 bg-green-100 rounded-full mb-3"><i data-lucide="shield-check" class="text-green-600"></i></div>
                <div class="text-green-800 font-bold text-lg">Statistical Scrubbing Success</div>
                <div class="text-xs text-gray-500">Fixed types, signs, emojis, and missing values.</div>
            </div>
        `;

        details.innerHTML = `
            <div class="p-4">
                <div class="space-y-2">
                    ${cleanActions.map(action => `
                        <div class="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl text-xs shadow-sm">
                            <i data-lucide="zap" class="w-3 h-3 text-yellow-500"></i>
                            <span class="text-gray-700">${action}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        window.dispatchEvent(new CustomEvent('table-added', { detail: cleanedTableName }));
        footer.classList.remove('hidden');
        lucide.createIcons();

    } catch (err) {
        console.error(err);
        scoreContainer.innerHTML = `<h4 class="font-bold text-red-600">Refining Error</h4>`;
        details.innerHTML = `<div class="p-6 text-red-700 text-xs font-mono">${err.message}</div>`;
        footer.classList.remove('hidden');
    }
}
