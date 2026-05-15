// js/modules/pivot-engine.js
import { runQuery } from '../core/database.js';
import { getAiPivotSettings } from '../core/ai-agent.js';


const modal = document.getElementById('pivot-modal');
const configView = document.getElementById('pivot-config-view');
const resultView = document.getElementById('pivot-result-view');

export async function openPivotModal(tableName) {
    if (!tableName) return alert("Upload data first");

    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    const options = schema.map(col => `<option value="${col.name}">${col.name}</option>`).join('');
    
    document.getElementById('pivot-row-select').innerHTML = options;
    document.getElementById('pivot-col-select').innerHTML = options;
    document.getElementById('pivot-val-select').innerHTML = options;

    configView.classList.remove('hidden');
    resultView.classList.add('hidden');
    modal.classList.remove('overlay-hidden');
    lucide.createIcons();
}

export async function executePivot(tableName) {
    const row = document.getElementById('pivot-row-select').value;
    const col = document.getElementById('pivot-col-select').value;
    const agg = document.getElementById('pivot-agg-select').value;
    const val = document.getElementById('pivot-val-select').value;

    // DuckDB Native Pivot Syntax
    const sql = `PIVOT "${tableName}" ON "${col}" USING ${agg}("${val}") GROUP BY "${row}"`;
    
    try {
        const data = await runQuery(sql);
        renderPivotGrid(data);
        
        configView.classList.add('hidden');
        resultView.classList.remove('hidden');
    } catch (err) {
        alert("Pivot Error: " + err.message);
    }
}

function renderPivotGrid(data) {
    const head = document.getElementById('pivot-head');
    const body = document.getElementById('pivot-body');

    if (data.length === 0) return;

    const columns = Object.keys(data[0]);
    head.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    
    body.innerHTML = data.map(row => {
        return `<tr>${columns.map(c => `<td>${row[c] !== null ? row[c] : '-'}</td>`).join('')}</tr>`;
    }).join('');
}

export function initPivotUI(activeTable) {
    const btnAi = document.getElementById('btn-ai-pivot');
    
    btnAi?.addEventListener('click', async () => {
        const goal = document.getElementById('pivot-ai-goal').value.trim();
        if (!goal) return alert("Please enter a goal for the AI.");

        // 1. Loading State
        const originalHtml = btnAi.innerHTML;
        btnAi.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Architecting...`;
        btnAi.disabled = true;
        lucide.createIcons();

        try {
            // 2. Get Settings from AI
            const settings = await getAiPivotSettings(activeTable(), goal);

            // 3. Auto-configure the UI dropdowns
            document.getElementById('pivot-row-select').value = settings.row;
            document.getElementById('pivot-col-select').value = settings.col;
            document.getElementById('pivot-val-select').value = settings.val;
            document.getElementById('pivot-agg-select').value = settings.agg;

            // 4. Execute the Pivot
            await executePivot(activeTable());
            
            // Success Feedback
            btnAi.innerHTML = originalHtml;
            btnAi.disabled = false;
            lucide.createIcons();

        } catch (err) {
            console.error(err);
            btnAi.innerHTML = originalHtml;
            btnAi.disabled = false;
            alert("Server is busy. Please try again.");
        }
    });
}
