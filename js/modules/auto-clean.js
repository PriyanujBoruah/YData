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
            
            // 2. HARDENED TEMPORAL CLEANING
            // 2. HARDENED TEMPORAL CLEANING (Bharat Focused)
            else if (isTemporal) {
                // 🚀 THE FIX: A "Coalesce Chain" that tries Indian formats first
                const castChain = [
                    `TRY_CAST("${colName}" AS DATE)`,           // ISO Format
                    `strptime("${colName}", '%d-%m-%Y')`,      // Indian (21-03-2018)
                    `strptime("${colName}", '%d/%m/%Y')`,      // Indian Slash (21/03/2018)
                    `strptime(SUBSTRING("${colName}", 1, 15), '%a %b %d %Y')`, // Messy JS format
                    `'1970-01-01'::DATE`                        // Fallback
                ].join(', ');

                const casted = `COALESCE(${castChain})`;
                
                // Use window function to fill gaps with the last valid date
                selectClauses.push(`last_value(${casted} IGNORE NULLS) OVER (ORDER BY rowid) AS "${colName}"`);
                cleanActions.push(`Standardized Bharat-date formats in [${colName}]`);
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
