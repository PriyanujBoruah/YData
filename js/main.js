// js/main.js

import { initDatabase, registerFile, runQuery, registerFromURL, getTableSchema, loadTableFromParquet, ingestJsonArray  } from './core/database.js';
import { showTablePreview, hideTablePreview } from './ui/overlays.js';
import { askAgentStream, streamDataStory, streamAdvancedNarrative, generateProactiveInsights, getSchemaOptimizationPlan, streamDeepResearch, getAiSchemaMapping } from './core/ai-agent.js';
import { initMenus } from './ui/input-bar.js';
import { initVizEngine } from './modules/viz-engine.js';
import { openPivotModal, executePivot, initPivotUI } from './modules/pivot-engine.js';
import { openPrivacyModal, runPrivacyScan, silentPrivacyScan, applyRedaction } from './modules/privacy.js';
import { openQualityModal, runHealthAudit, runAnomalySpotter, silentQualityAudit } from './modules/quality.js';
import { downloadCSV, downloadExcel } from './modules/export-engine.js';
import { initSidebar } from './ui/sidebar.js';
import { openSpreadsheet, closeSpreadsheet } from './modules/spreadsheet.js';
import { initPersonaUI } from './modules/personas.js';
import { initSettings } from './ui/settings.js';
import { initAuth, logout, supabaseClient } from './core/auth.js';
import { createKrataBook, fetchKrataBooks } from './modules/kratabook.js';
import { processInlineCharts, processMermaidCharts } from './ui/chat-viz.js'; 
import { updateDataSelector } from './ui/data-selector.js';
import { showSmartChips } from './ui/chat.js';
import { openHeadsUpModal, refreshHeadsUpList } from './modules/heads-up.js';
import { initAgenticBackground, openAgenticBgModal } from './modules/agentic-bg.js';
import { performOCR, structureText, getEmbeddings, synthesizeToUnifiedCSV } from './core/vision-agent.js';
import { loadAllFromStorage, deleteFromStorage, renameInStorage } from './core/storage.js';
import { fetchWithRetry } from './core/utils.js';
import { runAutoClean } from './modules/auto-clean.js';
import { initWorkspaceUI } from './modules/workspace.js';
import { initLibraryUI, saveToLibrary } from './modules/library.js';








/**
 * Global App State
 */
const state = {
    activeTable: null,
    allTables: [], // Track all ingested tables
    isDatabaseReady: false
};

/**
 * DOM Elements - Main Layout
 */
const chatContainer = document.getElementById('chat-container');
const introScreen = document.getElementById('intro-screen');
const messagesContainer = document.getElementById('messages');
const userPrompt = document.getElementById('user-prompt');
const filePicker = document.getElementById('file-picker');

/**
 * DOM Elements - Buttons & Modals
 */
const btnSend = document.getElementById('btn-send');
const btnPreview = document.getElementById('btn-preview');
const btnClosePreview = document.getElementById('close-preview');
const previewOverlay = document.getElementById('preview-overlay');

// Visualization Modal Elements
const vizModal = document.getElementById('viz-modal');
const btnCloseViz = document.getElementById('close-viz');
const btnRenderViz = document.getElementById('btn-generate-viz');
const btnVizBack = document.getElementById('btn-viz-back');
const btnVizSave = document.getElementById('btn-viz-save');
const vizConfigView = document.getElementById('viz-config-view');
const vizResultView = document.getElementById('viz-result-view');

/**
 * 1. APP INITIALIZATION
 */
let isBooting = false;

async function init() {
    // 1. Initialize Auth first
    initAuth();

    // 2. Handle User Authentication
    window.addEventListener('user-authenticated', async (e) => {
        // --- THE LOCK ---
        // Prevents double-initialization if the event fires multiple times (e.g., during redirect)
        if (state.isDatabaseReady || isBooting) return;

        const user = e.detail;
        const email = user.email;

        // 🚀 B2B LOGIC: Handle metadata (Sign-up, Google OAuth, and Roles)
        const metadata = user.user_metadata;
        const displayName = metadata?.display_name || metadata?.full_name || email.split('@')[0];
        const organization = metadata?.org_id || "Personal Workspace";
        const role = metadata?.role || "user"; // 🚀 NEW: Extract Role (Admin/User)
        const avatarUrl = metadata?.avatar_url;
        const initial = displayName.charAt(0).toUpperCase();

        // 1. UI PERSONALIZATION (Do this FIRST so it's ready when the overlay fades)
        const intro = document.getElementById('intro-screen');
        const greeting = document.querySelector('#intro-screen h1');
        if (greeting) greeting.innerText = `Hi ${displayName},`;

        const avatarCircle = document.getElementById('user-avatar-circle');
        const largeAvatar = document.getElementById('profile-large-avatar');
        const emailDisplay = document.getElementById('profile-email-display');
        const orgDisplay = document.getElementById('profile-org-display');
        const greetingDisplay = document.getElementById('profile-greeting');

        // Avatar Image Logic (Google PFP Support)
        if (avatarUrl) {
            const imgHtml = `<img src="${avatarUrl}" alt="${displayName}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            if (avatarCircle) { avatarCircle.innerHTML = imgHtml; avatarCircle.style.background = 'transparent'; }
            if (largeAvatar) { largeAvatar.innerHTML = imgHtml; largeAvatar.style.background = 'transparent'; }
        } else {
            if (avatarCircle) avatarCircle.innerText = initial;
            if (largeAvatar) largeAvatar.innerText = initial;
        }

        if (emailDisplay) emailDisplay.innerText = email;
        
        // Show Admin Badge if applicable
        if (greetingDisplay) {
            greetingDisplay.innerHTML = `Hi, ${displayName}! ${role === 'admin' ? 
                '<span class="badge" style="font-size:10px; vertical-align:middle; margin-left:5px; background: #e8f0fe; color: #0b57d0; padding: 2px 6px; border-radius: 4px; font-weight: 800; border: 1px solid #c2e7ff; text-transform: uppercase;">Admin</span>' 
                : ''}`;
        }
        
        if (orgDisplay) orgDisplay.innerText = organization;

        // 2. THE ENGINE BOOT
        isBooting = true;
        console.log(`Verified Session for [${displayName}] in [${organization}] as [${role}]. Booting Engine...`);

        try {
            // Await the engine initialization fully
            await initDatabase(); 
            
            // Set the flag ONLY after the promise resolves
            state.isDatabaseReady = true;

            // ==========================================
            // AUTO-LOAD FROM PERSISTENT VAULT
            // ==========================================
            try {
                const savedTables = await loadAllFromStorage();
                if (savedTables.length > 0) {
                    console.log(`Found ${savedTables.length} saved datasets. Booting into RAM...`);
                    
                    for (const table of savedTables) {
                        await loadTableFromParquet(table.name, table.buffer);
                        state.allTables.push(table.name);
                    }
                    
                    // Set the last loaded table as active
                    state.activeTable = state.allTables[state.allTables.length - 1]; 
                    
                    // Hide intro screen and update UI immediately
                    userPrompt.placeholder = `Ask about ${state.activeTable}...`;
                    updateDataSelector(state);
                    await showSmartChips(state.activeTable, runQuery);
                }
            } catch (storageErr) {
                console.warn("Local vault is empty or failed to load:", storageErr);
            }
            // ==========================================


            // 3. SEQUENTIAL UI LOADING (DB-dependent functions)
            // These functions use runQuery(), so they MUST come after await initDatabase()
            initMenus();
            initSidebar();
            initSettings();
            initPersonaUI();
            initVizEngine();
            initWorkspaceUI();
            initLibraryUI();
            initPivotUI(() => state.activeTable);
            
            // These specific calls perform SQL queries immediately
            await initAgenticBackground(); 
            await refreshKrataBookSidebar(); 

            lucide.createIcons();
            setupEventListeners();

            console.log("Krata AI: Online & Database Initialized");
        } catch (err) {
            console.error("Critical Boot Error:", err);
            // If it fails, we reset flags so user can try again or refresh
            state.isDatabaseReady = false;
        } finally {
            isBooting = false;
        }
    });
}

/**
 * 2. EVENT LISTENERS
 */
function setupEventListeners() {
    
    // --- Data Ingestion & Proactive Insights (Batch Enabled) ---
    // --- Data Ingestion & Proactive Insights (Sequential Batch Enabled) ---
    filePicker.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        // 1. Safety Guard: Limit Batch Size
        if (files.length > 25) {
            alert("Batch limit exceeded. Please upload a maximum of 25 documents at once.");
            filePicker.value = ""; 
            return;
        }

        // 2. Identify File Types
        const unstructuredFiles = files.filter(f => ['png', 'jpg', 'jpeg', 'pdf'].includes(f.name.split('.').pop().toLowerCase()));
        const structuredFiles = files.filter(f => !['png', 'jpg', 'jpeg', 'pdf'].includes(f.name.split('.').pop().toLowerCase()));

        // ============================================================
        // BRANCH 1: MULTIMODAL BATCH PIPELINE (High-Fidelity Consolidation)
        // ============================================================
        if (unstructuredFiles.length > 0) {
            const batchUI = createBatchIngestionCard(unstructuredFiles.length);
            const masterTableName = `batch_unified_${Date.now().toString().slice(-4)}`;
            let masterDataPool = []; 
            let processedCount = 0;

            // STEP 1: INDIVIDUAL NEURAL EXTRACTION (Sequential for RAM safety)
            for (const file of unstructuredFiles) {
                const fileRow = batchUI.addFile(file.name);
                fileRow.querySelector('.status-label').innerText = 'Extracting...';

                try {
                    // A. Local OCR
                    const rawText = await performOCR(file);
                    
                    // B. Neural Structuring (Processed document-by-document for highest precision)
                    const structuredData = await structureText(rawText); 
                    
                    // C. Add Source Metadata (Crucial for Enterprise Audit trails)
                    if (Array.isArray(structuredData)) {
                        structuredData.forEach(row => {
                            row.source_document = file.name;
                            masterDataPool.push(row);
                        });
                    }

                    processedCount++;
                    batchUI.updateProgress(processedCount, unstructuredFiles.length);
                    batchUI.markFileDone(fileRow);

                } catch (err) {
                    console.error(`Failed ${file.name}:`, err);
                    fileRow.querySelector('.status-label').innerHTML = `<span class="text-red-500">Error</span>`;
                }
            }

            // STEP 2: DUCKDB CONSOLIDATION
            if (masterDataPool.length > 0) {
                try {
                    addSystemMessage(`📦 Consolidating ${processedCount} documents into high-fidelity vault...`);
                    
                    // Uses the robust injector to handle varying columns and create the table
                    await ingestJsonArray(masterTableName, masterDataPool);

                    state.activeTable = masterTableName;
                    if (!state.allTables.includes(masterTableName)) state.allTables.push(masterTableName);
                    
                    // Update UI State
                    introScreen.style.display = 'none';
                    userPrompt.placeholder = `Ask about this consolidated batch...`;
                    updateDataSelector(state);
                    
                    addSystemMessage(`✅ **Intelligence Complete.** Consolidated documents into unified table **${masterTableName}**.`);
                    
                    // Trigger Post-Ingestion Audit
                    setTimeout(() => triggerIntelligenceCheckup(masterTableName), 1000);

                    // Generate Insights for the new consolidated table
                    const schema = await getTableSchema(masterTableName);
                    setupProactivePills(masterTableName, schema);

                } catch (err) {
                    console.error("Batch Consolidation Error:", err);
                    addSystemMessage(`❌ Server is busy. Please try again.`, true);
                }
            }
        }

        // ============================================================
        // BRANCH 2: STRUCTURED PIPELINE (CSV/Excel/JSON/XML)
        // ============================================================
        for (const file of structuredFiles) {
            const tableName = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            userPrompt.placeholder = `Indexing ${file.name}...`;

            try {
                // Cleanup existing table to prevent catalog collisions
                if (state.allTables.includes(tableName)) {
                    await runQuery(`DROP TABLE IF EXISTS "${tableName}"`);
                }

                // Register the file into DuckDB
                await registerFile(file);
                const schema = await getTableSchema(tableName);

                // Update State
                state.activeTable = tableName;
                if (!state.allTables.includes(tableName)) state.allTables.push(tableName);

                // Update UI
                introScreen.style.display = 'none';
                userPrompt.placeholder = `Ask about ${tableName}...`;
                updateDataSelector(state); 
                
                await showSmartChips(tableName, runQuery);
                addSystemMessage(`✅ Successfully indexed **${file.name}**.`);
                
                // Trigger Post-Ingestion Audit
                setTimeout(() => triggerIntelligenceCheckup(tableName), 800);
                
                // Generate dynamic suggestion pills
                setupProactivePills(tableName, schema);

            } catch (err) {
                console.error("Structured Ingestion Error:", err);
                addSystemMessage(`❌ Server is busy. Please try again.`, true);
            }
        }

        // Clear file picker so the same files can be re-uploaded if needed
        filePicker.value = "";
    });

    /**
     * HELPER: Logic to generate and display proactive insights
     */
    async function setupProactivePills(tableName, schema) {
        const pillsContainer = document.getElementById('proactive-insights-container');
        const pillsList = document.getElementById('proactive-pills');
        
        if (pillsContainer && pillsList) {
            pillsContainer.classList.remove('hidden');
            pillsList.innerHTML = `<div class="p-4 text-xs italic text-gray-400">Analyzing schema for insights...</div>`;

            const insights = await generateProactiveInsights(tableName, schema);
            pillsList.innerHTML = insights.map(text => `<button class="proactive-pill">${text}</button>`).join('');

            document.querySelectorAll('.proactive-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const promptText = pill.innerText.replace(/[\u{1F300}-\u{1F6FF}]/gu, '').trim();
                    userPrompt.value = promptText;
                    handleSendMessage(); 
                });
            });
        }
    }

    // ==========================================
    // URL IMPORT LISTENERS
    // ==========================================

    // 1. Open the Modal from the Dropdown
    const btnImportMenu = document.getElementById('btn-import-url-menu');
    if (btnImportMenu) {
        btnImportMenu.addEventListener('click', () => {
            document.getElementById('menu-database').classList.add('hidden'); // Close dropdown
            window.openModal('url-import-modal');
        });
    }

    // 2. Execute the Import
    const btnRunImport = document.getElementById('btn-run-url-import');
    if (btnRunImport) {
        btnRunImport.addEventListener('click', async () => {
            const url = document.getElementById('import-url-input').value.trim();
            let tableName = document.getElementById('import-name-input').value.trim();

            if (!url || !tableName) return alert("Please provide both a URL and a table name.");

            // Sanitize table name (replace spaces with underscores, lowercase)
            tableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

            // UI Loading State
            const originalHtml = btnRunImport.innerHTML;
            btnRunImport.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Downloading...`;
            btnRunImport.disabled = true;
            lucide.createIcons();

            try {
                // Ingest from URL
                await registerFromURL(url, tableName);

                // Update App State
                state.activeTable = tableName;
                if (!state.allTables.includes(tableName)) state.allTables.push(tableName);

                // Update UI
                introScreen.style.display = 'none';
                userPrompt.placeholder = `Ask about ${tableName}...`;
                userPrompt.focus();
                
                updateDataSelector(state);
                await showSmartChips(tableName, runQuery);

                // Close Modal & Notify
                document.getElementById('url-import-modal').classList.remove('active');
                addSystemMessage(`Successfully imported **${tableName}** from the web. I'm ready to analyze it.`);

            } catch (err) {
                alert(`Import failed: ${err.message}\n\n(Note: The URL must be public and allow CORS).`);
            } finally {
                // Restore Button State
                btnRunImport.innerHTML = originalHtml;
                btnRunImport.disabled = false;
                lucide.createIcons();
                
                // Clear inputs for next time
                document.getElementById('import-url-input').value = "";
                document.getElementById('import-name-input').value = "";
            }
        });
    }

    window.addEventListener('agent-status-update', (e) => {
        // Find the latest status message in the chat and update it
        const statusEls = document.querySelectorAll('.status-msg');
        const latestStatus = statusEls[statusEls.length - 1];
        if (latestStatus) {
            latestStatus.innerText = e.detail;
        }
    });

    // --- Input Bar UX ---
    userPrompt.addEventListener('input', () => {
        userPrompt.style.height = 'auto';
        userPrompt.style.height = (userPrompt.scrollHeight) + 'px';
        userPrompt.value.trim().length > 0 ? btnSend.classList.remove('hidden') : btnSend.classList.add('hidden');
    });

    userPrompt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    btnSend.addEventListener('click', () => {
        const text = userPrompt.value.trim();
        if (text === "Execute Deep Research Protocol") {
            handleNarrator();
            return;
        } else {
            handleSendMessage(); // Trigger standard SQL/Chat logic
        }
    });


    // --- Eye Preview Logic ---
    btnPreview.addEventListener('click', () => {
        state.activeTable ? showTablePreview(state.activeTable) : addSystemMessage("Upload a dataset first.", true);
    });
    btnClosePreview.addEventListener('click', hideTablePreview);
    previewOverlay.addEventListener('click', (e) => { if (e.target.id === 'preview-overlay') hideTablePreview(); });

    // --- Pivot Table Listeners ---

    window.addEventListener('open-pivot', () => openPivotModal(state.activeTable));

    document.getElementById('btn-run-pivot').addEventListener('click', () => {
        executePivot(state.activeTable);
    });

    document.getElementById('close-pivot').addEventListener('click', () => {
        document.getElementById('pivot-modal').classList.add('overlay-hidden');
    });

    document.getElementById('btn-pivot-back').addEventListener('click', () => {
        document.getElementById('pivot-config-view').classList.remove('hidden');
        document.getElementById('pivot-result-view').classList.add('hidden');
    });

    document.getElementById('btn-pivot-chat').addEventListener('click', () => {
        const row = document.getElementById('pivot-row-select').value;
        const col = document.getElementById('pivot-col-select').value;
        
        addSystemMessage(`I've computed the pivot table for you, grouping by **${row}** across **${col}**. You can see the summarized trends in the Lab.`);
        document.getElementById('pivot-modal').classList.add('overlay-hidden');
    });

    // --- Privacy Hub Listeners ---
    
    window.addEventListener('open-privacy', () => openPrivacyModal());

    document.getElementById('btn-start-scan').addEventListener('click', () => {
        runPrivacyScan(state.activeTable);
    });

    document.getElementById('close-privacy').addEventListener('click', () => {
        document.getElementById('privacy-modal').classList.add('overlay-hidden');
        document.getElementById('privacy-modal').style.display = 'none';
    });

    document.getElementById('btn-privacy-done').addEventListener('click', () => {
        addSystemMessage("Privacy Audit complete. Sensitive data has been identified and neutralized locally.");
        document.getElementById('privacy-modal').classList.add('overlay-hidden');
        document.getElementById('privacy-modal').style.display = 'none';
    });

    // --- Quality Hub Listeners ---

    window.addEventListener('open-quality', () => openQualityModal());

    document.getElementById('btn-run-audit').addEventListener('click', () => runHealthAudit(state.activeTable));
    document.getElementById('btn-run-anomalies').addEventListener('click', () => runAnomalySpotter(state.activeTable));

    document.getElementById('btn-quality-back').addEventListener('click', () => {
        document.getElementById('quality-initial-view').classList.remove('hidden');
        document.getElementById('quality-results-view').classList.add('hidden');
        document.getElementById('quality-footer').classList.add('hidden');
    });

    document.getElementById('close-quality').addEventListener('click', () => {
        document.getElementById('quality-modal').classList.add('overlay-hidden');
        document.getElementById('quality-modal').style.display = 'none';
    });

    document.getElementById('btn-quality-chat').addEventListener('click', () => {
        addSystemMessage("I've analyzed the quality of your dataset. The **Health Audit** is visible in your lab, indicating column-wise completeness and uniqueness.");
        document.getElementById('quality-modal').classList.add('overlay-hidden');
        document.getElementById('quality-modal').style.display = 'none';
    });

    document.getElementById('btn-run-autoclean').addEventListener('click', () => {
        // Get currently active table name from the UI selector label
        const activeTable = document.getElementById('active-data-label').innerText;
        
        if (activeTable && activeTable !== "Select Data") {
            runAutoClean(activeTable);
        } else {
            alert("Please select a table to clean.");
        }
    });

    window.addEventListener('table-added', (e) => {
        const newTable = e.detail;
        if (!state.allTables.includes(newTable)) {
            state.allTables.push(newTable);
            updateDataSelector(state); // Refresh the pill dropdown
            addSystemMessage(`✨ AI has created a cleaned version of your data: **${newTable}**`);
        }
    });

    // --- Narrative Listeners ---

    window.addEventListener('trigger-narrator', () => handleNarrator());

    // --- Export Logic (Direct from Database Menu) ---
    const btnCsv = document.getElementById('btn-export-csv-menu');
    if (btnCsv) {
        btnCsv.addEventListener('click', () => {
            if (!state.activeTable) return alert("Upload a dataset first.");
            downloadCSV(state.activeTable);
            addSystemMessage(`Downloaded **${state.activeTable}** as CSV.`);
            document.getElementById('menu-database').classList.add('hidden');
        });
    }

    const btnExcel = document.getElementById('btn-export-excel-menu');
    if (btnExcel) {
        btnExcel.addEventListener('click', () => {
            if (!state.activeTable) return alert("Upload a dataset first.");
            downloadExcel(state.activeTable);
            addSystemMessage(`Downloaded **${state.activeTable}** as Excel.`);
            document.getElementById('menu-database').classList.add('hidden');
        });
    }

    // --- Spreadsheet Listeners ---

    document.getElementById('sidebar-spreadsheet-btn').addEventListener('click', () => {
        if (state.activeTable) {
            openSpreadsheet(state.activeTable);
        } else {
            addSystemMessage("Please upload a dataset first.", true);
        }
    });

    // Close Spreadsheet and Search
    document.getElementById('close-spreadsheet')?.addEventListener('click', closeSpreadsheet);

    // --- Persona Listeners ---

    document.getElementById('sidebar-personas-btn').addEventListener('click', () => {
        window.openModal('persona-modal');
    });

    // Listen for the change to show a toast
    window.addEventListener('persona-changed', (e) => {
        addSystemMessage(`AI Identity switched to: **${e.detail}**`);
        // Update Top Nav Center Text
        const personaDisplay = document.getElementById('active-persona-display');
        if (personaDisplay) {
            personaDisplay.innerText = e.detail;
        }
    });

    // Initialize the Persona UI logic
    initPersonaUI();

    // --- Table Switch Listener ---
    window.addEventListener('table-switched', (e) => {
        state.activeTable = e.detail;
        userPrompt.placeholder = `Ask about ${state.activeTable}...`;
        updateDataSelector(state);
        
        // If the chat history is empty, ensure the intro screen is visible
        if (messagesContainer.children.length === 0) {
            document.getElementById('intro-screen').style.display = 'block';
        }
        
        addSystemMessage(`Switched context to: **${state.activeTable}**`);
    });

    // --- Table Management Logic ---

    // Delete Table
    window.addEventListener('table-deleted', async (e) => {
        const tableName = e.detail;
        try {
            await runQuery(`DROP TABLE "${tableName}"`);
            
            // Sync: Remove from Persistent Storage
            await deleteFromStorage(tableName);
            
            state.allTables = state.allTables.filter(t => t !== tableName);
            if (state.activeTable === tableName) state.activeTable = state.allTables.length > 0 ? state.allTables[0] : null;
            refreshHeadsUpList(state.allTables);
            updateDataSelector(state);
            userPrompt.placeholder = state.activeTable ? `Ask about ${state.activeTable}...` : "Ask Krata AI...";
            
            if (!state.activeTable) document.getElementById('intro-screen').style.display = 'block';

            addSystemMessage(`Table **${tableName}** deleted successfully.`);
        } catch (err) { alert("Error deleting table: " + err.message); }
    });

    // Rename Table
    window.addEventListener('table-renamed', async (e) => {
        const { oldName, newName } = e.detail;
        const cleanNewName = newName.replace(/[^a-zA-Z0-9]/g, '_');
        try {
            await runQuery(`ALTER TABLE "${oldName}" RENAME TO "${cleanNewName}"`);
            
            // Sync: Update name in Persistent Storage
            await renameInStorage(oldName, cleanNewName);

            state.allTables = state.allTables.map(t => t === oldName ? cleanNewName : t);
            if (state.activeTable === oldName) state.activeTable = cleanNewName;
            refreshHeadsUpList(state.allTables);
            updateDataSelector(state);
            userPrompt.placeholder = `Ask about ${state.activeTable}...`;
            addSystemMessage(`Table renamed to **${cleanNewName}**.`);
        } catch (err) { alert("Error renaming table: " + err.message); }
    });


    // --- Top Menu: Persona ---
    document.getElementById('btn-top-persona').addEventListener('click', () => {
        document.getElementById('menu-top-options').classList.add('hidden'); // Close menu
        window.openModal('persona-modal');
    });

    // --- Top Menu: KrataBook ---
    document.getElementById('btn-top-kratabook').addEventListener('click', async () => {
        document.getElementById('menu-top-options').classList.add('hidden'); // Close dropdown
        
        // Simulate a click on the main sidebar button to reuse all the loader logic
        document.getElementById('btn-create-kratabook').click();
    });

    // --- Top Menu: Settings ---
    document.getElementById('btn-top-settings').addEventListener('click', (e) => {
        // Stop the click from bubbling to the global "click-away" listener
        e.stopPropagation(); 
        
        // Hide the top options menu
        document.getElementById('menu-top-options').classList.add('hidden');
        
        // Trigger the existing settings logic
        const settingsSidebarBtn = document.getElementById('btn-settings-sidebar');
        if (settingsSidebarBtn) {
            settingsSidebarBtn.click();
        }
    });

    // --- Top Menu: Clear Chat ---
    document.getElementById('btn-top-clear').addEventListener('click', () => {
        document.getElementById('menu-top-options').classList.add('hidden');
        
        if(confirm("Are you sure you want to clear the chat history?")) {
            messagesContainer.innerHTML = "";

            // 🚀 NEW: Wipe the AI's memory buffer
            import('./core/ai-agent.js').then(mod => mod.clearAgentContext());

            
            // Re-show the intro screen when the chat is emptied
            const introScreen = document.getElementById('intro-screen');
            if (introScreen) {
                introScreen.style.display = 'block';
            }
            
            // Optional: Re-show proactive insights if a table is active
            if (state.activeTable) {
                const proactiveContainer = document.getElementById('proactive-insights-container');
                if (proactiveContainer) proactiveContainer.classList.remove('hidden');
            }
        }
    });

    document.getElementById('btn-top-headsup').addEventListener('click', () => {
        openHeadsUpModal(state.allTables);
    });

    window.addEventListener('open-agentic-bg', () => {
        openAgenticBgModal();
        // Auto-close settings dropdown if it's open
        document.getElementById('settings-dropdown').classList.add('hidden');
    });

    // 1. The Sidebar Button: ONLY opens the Configuration Modal
    const btnSidebarKrata = document.getElementById('btn-create-kratabook');
    if (btnSidebarKrata) {
        btnSidebarKrata.addEventListener('click', () => {
            if (!state.activeTable) return alert("Please upload a dataset first.");
            
            // Populate the persona dropdown dynamically from our imported config
            const personaSelect = document.getElementById('kb-persona');
            import('./modules/personas.js').then(mod => {
                personaSelect.innerHTML = Object.entries(mod.PERSONA_CONFIGS).map(([id, p]) => 
                    `<option value="${id}">${p.name}</option>`
                ).join('');
            });

            window.openModal('kb-config-modal');
        });
    }

    // 2. The Modal "Generate" Button: Does the actual work
    const btnConfirmKB = document.getElementById('btn-confirm-generate-kb');
    if (btnConfirmKB) {
        btnConfirmKB.addEventListener('click', async () => {
            const loaderModal = document.getElementById('kb-loader-modal');
            const statusText = document.getElementById('kb-loader-status');
            
            // Gather user selection from the modal
            const config = {
                type: document.getElementById('kb-type').value,
                personaId: document.getElementById('kb-persona').value,
                branding: document.querySelector('input[name="kb-branding"]:checked').value
            };

            // Close config and show loader
            closeAllModals();
            loaderModal.classList.add('active');
            statusText.innerText = `Initializing ${config.type}...`;

            try {
                // Update status mid-way for effect
                setTimeout(() => { 
                    if(loaderModal.classList.contains('active')) 
                        statusText.innerText = "Synthesizing strategic insights..."; 
                }, 2500);

                // Critical: Pass both the table and the config object
                await createKrataBook(state.activeTable, config);
                
                await refreshKrataBookSidebar();
                addSystemMessage(`✨ **KrataBook Created.** Archetype: **${config.type}**. Checked into your local vault.`);

            } catch (e) {
                console.error("KrataBook Generation Error:", e);
                alert("Failed to generate KrataBook: " + e.message);
            } finally {
                loaderModal.classList.remove('active');
            }
        });
    }

    // --- User Profile Listeners ---

    // 1. Open Edit Profile Modal
    document.getElementById('btn-edit-profile').addEventListener('click', async () => {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;

        // Pre-fill inputs with current values
        document.getElementById('edit-username').value = user.user_metadata?.display_name || "";
        document.getElementById('edit-org').value = user.user_metadata?.org_id || "";

        // Close the profile dropdown and open the modal
        document.getElementById('menu-user-profile').classList.add('hidden');
        window.openModal('edit-profile-modal');
    });

    // 2. Save Profile Changes
    document.getElementById('btn-save-profile').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-profile');
        const newName = document.getElementById('edit-username').value.trim();
        const newOrg = document.getElementById('edit-org').value.trim();

        if (!newName || !newOrg) return alert("Fields cannot be empty.");

        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Saving...`;
        lucide.createIcons();

        try {
            const { updateUserProfile } = await import('./core/auth.js');
            await updateUserProfile(newName, newOrg);
            
            alert("Profile updated successfully! Refreshing to apply changes...");
            window.location.reload(); // Hard reload is the cleanest way to update all Org filters
        } catch (err) {
            alert("Update failed: " + err.message);
            btn.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i> Save Changes`;
            lucide.createIcons();
        }
    });


    // 3. Logout of Current User Profile
    const btnProfileLogout = document.getElementById('btn-profile-logout');
    if (btnProfileLogout) {
        btnProfileLogout.addEventListener('click', () => {
            if(confirm("Are you sure you want to sign out?")) {
                logout();
            }
        });
    }

    // --- Feedback Listener ---

    document.getElementById('btn-open-feedback').addEventListener('click', async () => {
        try {
            // 1. Get the current user from Supabase
            const { data: { user } } = await supabaseClient.auth.getUser();
            
            if (!user) return alert("Please sign in to send feedback.");

            // 2. Prepare the Metadata
            const userEmail = encodeURIComponent(user.email);
            const userOrg = encodeURIComponent(user.user_metadata?.org_id || 'Personal');

            // 3. Construct your specific Pre-filled URL
            // We use your ID: 1777337187 for Email and 1574410993 for Org
            const baseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSea6zMCDL_TuUSnsGOI_LcYsm5HrsYVy2eSM3WbUkKc7PhhxA/viewform?embedded=true";
            const prefilledUrl = `${baseUrl}&entry.1777337187=${userEmail}&entry.1574410993=${userOrg}`;

            // 4. Inject into Iframe and Open
            const iframe = document.getElementById('feedback-iframe');
            iframe.src = prefilledUrl;

            // Close the settings dropdown first
            document.getElementById('settings-dropdown').classList.add('hidden');
            
            // Open the modal
            window.openModal('feedback-modal');

        } catch (err) {
            console.error("Feedback error:", err);
        }
    });

    // ============================================================
    // DATA ENTRY & BATCH APPEND LOGIC
    // ============================================================

    /**
     * 1. TRIGGER: Manual Entry Form
     * Opens the modal and generates inputs based on active table schema.
     */
    document.getElementById('btn-manual-insert').addEventListener('click', async () => {
        if (!state.activeTable) return alert("Please select a dataset first.");

        const container = document.getElementById('insert-form-container');
        const subtitle = document.getElementById('insert-modal-subtitle');
        
        // Close the dropdown menu
        document.getElementById('menu-plus').classList.add('hidden');
        
        subtitle.innerText = `Adding record to: ${state.activeTable}`;
        container.innerHTML = `<div class="p-4 text-center text-xs italic text-gray-400">Inspecting schema...</div>`;
        
        window.openModal('insert-modal');

        try {
            // Fetch column info from DuckDB vault
            const columns = await runQuery(`PRAGMA table_info('${state.activeTable}')`);
            container.innerHTML = ""; // Clear loader

            columns.forEach(col => {
                // Internal DuckDB columns or rowid should not be manually edited
                if (['rowid', 'selection-col'].includes(col.name)) return;

                const group = document.createElement('div');
                group.className = "form-group mb-4";
                group.innerHTML = `
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">${col.name}</label>
                    <input type="text" class="insert-input custom-select" 
                        data-column="${col.name}" 
                        placeholder="Value for ${col.type}...">
                `;
                container.appendChild(group);
            });

        } catch (err) {
            console.error(err);
            container.innerHTML = `<div class="text-red-500 text-xs p-4">Server is busy. Please try again.</div>`;
        }
    });

    /**
     * 2. ACTION: Commit Manual Record
     * Generates and runs the SQL INSERT command.
     */
    document.getElementById('btn-save-record').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-record');
        const inputs = document.querySelectorAll('.insert-input');
        const originalHtml = btn.innerHTML;

        const columnNames = [];
        const values = [];

        inputs.forEach(input => {
            const val = input.value.trim();
            if (val !== "") {
                columnNames.push(`"${input.dataset.column}"`);
                // Escape single quotes to prevent SQL crashes
                values.push(`'${val.replace(/'/g, "''")}'`);
            }
        });

        if (columnNames.length === 0) return alert("Please fill at least one field.");

        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Committing...`;
        btn.disabled = true;
        if (window.lucide) lucide.createIcons();

        try {
            const sql = `INSERT INTO "${state.activeTable}" (${columnNames.join(', ')}) VALUES (${values.join(', ')})`;
            await runQuery(sql);

            btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> Committed!`;
            
            // Refresh Spreadsheet View if active
            const spreadsheetView = document.getElementById('spreadsheet-view');
            if (spreadsheetView && !spreadsheetView.classList.contains('view-hidden')) {
                const { openSpreadsheet } = await import('./modules/spreadsheet.js');
                await openSpreadsheet(state.activeTable);
            }

            setTimeout(() => {
                window.closeAllModals();
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                if (window.lucide) lucide.createIcons();
            }, 1200);

        } catch (err) {
            console.error(err);
            alert("Server is busy. Please try again.");
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }
    });

    /**
     * 3. TRIGGER: Batch File Append (CSV/XLSX)
     * Loads a file and appends it to the currently active table.
     */
    let tempAppendTable = null; // Tracks the new file's temp name

    /**
     * 🚀 STEP 1: INITIAL FILE PICK
     */
    document.getElementById('insert-file-picker').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !state.activeTable) return;

        document.getElementById('menu-plus').classList.add('hidden');
        
        try {
            const { registerFile } = await import('./core/database.js');
            // Register the new file as a temporary table
            tempAppendTable = await registerFile(file);
            
            // Fetch schemas for both tables
            const targetSchema = await runQuery(`PRAGMA table_info('${state.activeTable}')`);
            const sourceSchema = await runQuery(`PRAGMA table_info('${tempAppendTable}')`);
            
            renderMappingUI(targetSchema, sourceSchema);
            window.openModal('mapping-modal');
            
        } catch (err) {
            console.error(err);
            addSystemMessage("Server is busy. Please try again.", true);
        }
    });

    /**
     * 🚀 STEP 2: RENDER MAPPING UI
     */
    function renderMappingUI(targetSchema, sourceSchema) {
        const container = document.getElementById('mapping-container');
        container.innerHTML = "";

        // Create the options list once
        const sourceOptions = `<option value="">-- Skip Column --</option>` + 
            sourceSchema.map(s => `<option value="${s.name}">${s.name}</option>`).join('');

        targetSchema.forEach(target => {
            if (['rowid', 'selection-col'].includes(target.name)) return;

            const row = document.createElement('div');
            row.className = 'mapping-row';
            row.innerHTML = `
                <div class="target-col">
                    <span class="text-xs font-bold">${target.name}</span>
                    <span class="col-type-tag">${target.type}</span>
                </div>
                <i data-lucide="arrow-right" class="text-gray-300 w-4 h-4"></i>
                <div class="flex-1">
                    <!-- 🚀 ENSURE CLASS 'map-input' and 'data-target' ARE PRESENT -->
                    <select class="map-input custom-select-small" 
                            data-target="${target.name}" 
                            data-type="${target.type}">
                        ${sourceOptions}
                    </select>
                </div>
            `;
            
            // Initial auto-match by name
            const select = row.querySelector('select');
            const match = sourceSchema.find(s => s.name.toLowerCase() === target.name.toLowerCase());
            if (match) select.value = match.name;

            container.appendChild(row);
        });
        if (window.lucide) lucide.createIcons();
    }

    /**
     * 🚀 STEP 3: EXECUTE APPEND WITH FORCED CASTING
     */
    document.getElementById('btn-execute-append').addEventListener('click', async () => {
        const btn = document.getElementById('btn-execute-append');
        const mappings = document.querySelectorAll('.map-input');
        const originalHtml = btn.innerHTML;

        let targetCols = [];
        let selectCasts = [];

        mappings.forEach(select => {
            const sourceCol = select.value;
            const targetCol = select.dataset.target;
            const targetType = select.dataset.type;

            if (sourceCol) {
                targetCols.push(`"${targetCol}"`);
                // 🚀 THE FORCE-CAST: We use TRY_CAST to convert types safely.
                // If it can't convert (e.g. "ABC" to INT), it results in NULL instead of an error.
                selectCasts.push(`TRY_CAST("${sourceCol}" AS ${targetType})`);
            }
        });

        if (targetCols.length === 0) return alert("Please map at least one column.");

        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Merging...`;
        btn.disabled = true;

        try {
            const sql = `
                INSERT INTO "${state.activeTable}" (${targetCols.join(', ')})
                SELECT ${selectCasts.join(', ')} FROM "${tempAppendTable}"
            `;
            
            await runQuery(sql);
            await runQuery(`DROP TABLE "${tempAppendTable}"`);

            addSystemMessage(`✅ **Neural Merge Complete.** Data from new file has been type-casted and appended to **${state.activeTable}**.`);
            
            // Refresh Spreadsheet
            const { openSpreadsheet } = await import('./modules/spreadsheet.js');
            await openSpreadsheet(state.activeTable);

            setTimeout(() => {
                window.closeAllModals();
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }, 1200);

        } catch (err) {
            console.error(err);
            alert("Server is busy. Please try again.");
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });

    document.getElementById('btn-ai-match').addEventListener('click', async () => {
        const btn = document.getElementById('btn-ai-match');
        const originalHtml = btn.innerHTML;

        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Matching...`;
        btn.disabled = true;
        if (window.lucide) lucide.createIcons();

        try {
            const { getAiSchemaMapping } = await import('./core/ai-agent.js');
            const mapping = await getAiSchemaMapping(state.activeTable, tempAppendTable);
            
            console.log("AI Proposed Mapping:", mapping); // Debug log

            // 1. Get all dropdowns
            const selects = document.querySelectorAll('.map-input');
            
            // 2. Clean current selections
            selects.forEach(s => s.value = "");

            // 3. Normalized Matcher Loop
            // We iterate through our ACTUAL dropdowns, not the AI's keys
            selects.forEach(select => {
                const targetColName = select.dataset.target;
                
                // Find if the AI provided a match for this specific target column
                // We use case-insensitive keys because AI might return lowercase keys
                const aiMatchKey = Object.keys(mapping).find(k => 
                    k.toLowerCase().trim().replace(/_/g, '') === targetColName.toLowerCase().trim().replace(/_/g, '')
                );

                if (aiMatchKey) {
                    const sourceColRecommended = mapping[aiMatchKey];
                    
                    // Now find the option that matches the recommended source column
                    const options = Array.from(select.options);
                    const bestOption = options.find(opt => 
                        opt.value.toLowerCase().trim() === sourceColRecommended.toLowerCase().trim()
                    );

                    if (bestOption) {
                        select.value = bestOption.value;
                        
                        // Visual feedback "Glow"
                        select.style.transition = "all 0.4s";
                        select.style.border = "2px solid #0b57d0";
                        select.style.backgroundColor = "#e8f0fe";
                        select.style.boxShadow = "0 0 10px rgba(11, 87, 208, 0.2)";
                        
                        setTimeout(() => {
                            select.style.border = "";
                            select.style.backgroundColor = "";
                            select.style.boxShadow = "";
                        }, 3000);
                    }
                }
            });

            addSystemMessage("✨ AI Auto-Match: I have linked columns by analyzing data patterns and semantics.");

        } catch (err) {
            console.error("AI Match Error:", err);
            alert("Server is busy. Please try again.");
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }
    });

    /**
     * 🚀 UNSTRUCTURED APPEND (PDF/Image)
     * Performs OCR -> Structuring -> Mapping Modal
     */
    document.getElementById('append-unstructured-picker').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !state.activeTable) return;

        document.getElementById('menu-plus').classList.add('hidden');
        addSystemMessage(`🧠 **Neural Extraction in progress...** Reading **${file.name}** to append to **${state.activeTable}**.`);

        try {
            // 1. Perform Local OCR
            const { performOCR, structureText } = await import('./core/vision-agent.js');
            const rawText = await performOCR(file);

            // 2. Perform Neural Structuring (Mistral)
            const structuredData = await structureText(rawText);

            if (!structuredData || structuredData.length === 0) {
                throw new Error("No tabular data could be identified in this document.");
            }

            // 3. Ingest JSON into a temporary table to enable the Mapping UI
            const { ingestJsonArray } = await import('./core/database.js');
            tempAppendTable = `temp_unstructured_${Date.now().toString().slice(-4)}`;
            await ingestJsonArray(tempAppendTable, structuredData);

            // 4. Fetch schemas for the Mapping UI
            const targetSchema = await runQuery(`PRAGMA table_info('${state.activeTable}')`);
            const sourceSchema = await runQuery(`PRAGMA table_info('${tempAppendTable}')`);

            // 5. Open the Mapping Modal (reusing existing UI logic)
            renderMappingUI(targetSchema, sourceSchema);
            window.openModal('mapping-modal');
            
            addSystemMessage("✨ Extraction complete. Use **AI Auto-Match** to link the document fields to your vault.");

        } catch (err) {
            console.error("Unstructured Append Error:", err);
            addSystemMessage("❌ **Extraction failed.** Server is busy. Please try again.", true);
        } finally {
            e.target.value = ""; // Reset picker
        }
    });

    // Open the Modal
    window.addEventListener('trigger-auto-pareto', () => {
        import('./modules/pareto-engine.js').then(mod => mod.openParetoModal());
    });

    // Run the Logic
    document.getElementById('btn-run-pareto-auto').addEventListener('click', () => {
        import('./modules/pareto-engine.js').then(mod => mod.runAutonomousAudit(state.activeTable));
    });

    // Send to Chat
    document.getElementById('btn-pareto-to-chat').addEventListener('click', () => {
        import('./modules/pareto-engine.js').then(mod => mod.sendToChat());
    });

    // Reset
    document.getElementById('btn-pareto-reset').addEventListener('click', () => {
        import('./modules/pareto-engine.js').then(mod => mod.openParetoModal());
    });


}


/**
 * 3. CHAT LOGIC (2-Stage Agentic AI)
 */
/**
 * REFINED CHAT HANDLER
 * @param {string} overridePrompt - If provided, uses this text instead of the textarea value.
 * @param {boolean} isSilent - If true, skips adding the User's message bubble to the UI.
 */
async function handleSendMessage(overridePrompt = null, isSilent = false) {
    // 🚀 Logic: Use the automated prompt if provided, otherwise grab from the input box
    const text = overridePrompt || userPrompt.value.trim();
    
    // Safety check: Don't proceed if there is no text, DB isn't ready, or no data is selected
    if (!text || !state.isDatabaseReady || !state.activeTable) return;

    // Hide the intro screen and proactive insights immediately on first interaction
    const introScreen = document.getElementById('intro-screen');
    const proactiveContainer = document.getElementById('proactive-insights-container');
    
    if (introScreen) introScreen.style.display = 'none';
    if (proactiveContainer) proactiveContainer.classList.add('hidden');

    // 1. Only add User Message bubble if NOT a silent/automated trigger
    if (!isSilent) {
        addUserMessage(text);
        userPrompt.value = "";
        userPrompt.style.height = 'auto';
        btnSend.classList.add('hidden');
    }
    
    // 2. Lock UI & Show Shimmer Effect (Thinking state)
    const inputPill = document.getElementById('input-pill');
    userPrompt.disabled = true;
    userPrompt.placeholder = "Krata is thinking...";
    inputPill.classList.add('input-pill-thinking');

    // 3. Create Bot Message Shell
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message';
    msgDiv.dataset.prompt = text; // Save prompt for potential regeneration

    msgDiv.innerHTML = `
        <div class="bot-avatar">
            <img src="assets/logo.png" alt="Krata AI">
        </div>
        <div class="bubble w-full">
            <details class="sql-debug hidden">
                <summary>Show thinking</summary>
                <div class="thinking-content">
                    <div class="status-msg italic text-sm text-gray-500 mb-2">Analyzing requirements...</div>
                    <code class="sql-code"></code>
                </div>
            </details>
            <!-- Add 'prose' class for consistent report styling -->
            <div class="response-text prose max-w-none"></div>
            
            <!-- Chat Action Bar (Initially hidden) -->
            <div class="chat-action-bar hidden">
                <button class="chat-action-btn" title="Copy Response" onclick="copyChatResponse(this)">
                    <i data-lucide="copy"></i>
                </button>
                <button class="chat-action-btn" title="Add to Library" onclick="saveChatToLibrary(this)">
                    <i data-lucide="bookmark"></i>
                </button>
                <button class="chat-action-btn" title="Add to Workspace" onclick="shareChatToWorkspace(this)">
                    <i data-lucide="layout-dashboard"></i>
                </button>
                <button class="chat-action-btn" title="Regenerate" onclick="regenerateChatResponse(this)">
                    <i data-lucide="refresh-cw"></i>
                </button>
                <button class="chat-action-btn delete-btn" title="Delete Response" onclick="deleteChatResponse(this)">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        </div>
    `;
    messagesContainer.appendChild(msgDiv);
    lucide.createIcons();
    scrollToBottom();

    const statusEl = msgDiv.querySelector('.status-msg');
    const textEl = msgDiv.querySelector('.response-text');
    const sqlContainer = msgDiv.querySelector('.sql-debug');
    const sqlCodeEl = msgDiv.querySelector('.sql-code');
    const actionBar = msgDiv.querySelector('.chat-action-bar');

    let fullResponse = "";
    try {
        // 4. Call Agent Stream with the resolved text
        const stream = askAgentStream(text, state.activeTable);
        
        for await (const chunk of stream) {
            if (chunk.type === 'status') {
                if (statusEl) statusEl.innerText = chunk.content;
            } else if (chunk.type === 'sql') {
                if (sqlContainer) sqlContainer.classList.remove('hidden');
                if (sqlCodeEl) sqlCodeEl.innerText = chunk.content;
            } else if (chunk.type === 'text') {
                if (statusEl) statusEl.style.display = 'none'; // Hide status when text starts
                fullResponse += chunk.content;
                textEl.innerHTML = marked.parse(fullResponse); 
                scrollToBottom();
            } else if (chunk.type === 'modification_complete') {
                // Refresh data views if AI edited the database
                const spreadsheetView = document.getElementById('spreadsheet-view');
                if (spreadsheetView && !spreadsheetView.classList.contains('view-hidden')) {
                    const { openSpreadsheet } = await import('./modules/spreadsheet.js');
                    await openSpreadsheet(state.activeTable);
                }
            } else if (chunk.type === 'error') {
                throw new Error(chunk.content); // Trigger catch block
            }
        }

        // ==========================================
        // FINAL HYDRATION (POST-STREAM)
        // ==========================================
        
        // Handle custom [CHART_START] JSON blocks
        textEl.innerHTML = processInlineCharts(textEl.innerHTML, textEl);
        
        // Handle Markdown Mermaid blocks (Must be awaited)
        await processMermaidCharts(textEl); 
        
        lucide.createIcons();
        scrollToBottom();

    } catch (err) {
        console.error("Agent Error:", err);
        // Clean, polite B2B error masking
        textEl.innerHTML = `
            <div class="p-3 bg-gray-50 border border-gray-100 rounded-xl text-gray-600 text-sm flex items-center gap-2">
                <i data-lucide="info" class="w-4 h-4 text-gray-400"></i>
                <span>Server is busy. Please try again.</span>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } finally {
        // 5. Unlock UI & Remove Shimmer Effect
        inputPill.classList.remove('input-pill-thinking');
        userPrompt.disabled = false;
        userPrompt.placeholder = `Ask about ${state.activeTable}...`;
        
        // Reveal the action bar
        if (actionBar) actionBar.classList.remove('hidden');
        
        lucide.createIcons();
        
        // Auto-focus back on the input for the next question
        setTimeout(() => userPrompt.focus(), 50);
    }
}

/**
 * 4. UI RENDER HELPERS
 */
function renderChartInChat(config) {
    const chartId = 'chart-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message';
    msgDiv.innerHTML = `
        <div class="bot-avatar">
            <img src="assets/logo.png" alt="Krata AI">
        </div>
        <div class="bubble">
            <p>Analysis Result: <strong>${config.title}</strong></p>
            <div id="${chartId}" class="chart-container"></div>
        </div>
    `;
    messagesContainer.appendChild(msgDiv);
    
    // Deep clone config to avoid reference issues
    const trace = {
        x: config.labels,
        y: config.values,
        type: config.type === 'pie' ? 'pie' : (config.type === 'scatter' ? 'scatter' : config.type),
        mode: config.type === 'scatter' ? 'markers' : undefined,
        labels: config.type === 'pie' ? config.labels : undefined,
        values: config.type === 'pie' ? config.values : undefined,
        marker: { color: '#0b57d0' }
    };

    const layout = {
        height: 280,
        margin: { t: 20, b: 40, l: 50, r: 20 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Segoe UI', size: 10 }
    };

    Plotly.newPlot(chartId, [trace], layout, { responsive: true, displayModeBar: false });
    scrollToBottom();
}

function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user-message';
    div.innerHTML = `<div class="bubble">${text}</div>`;
    messagesContainer.appendChild(div);
    scrollToBottom();
}

function addSystemMessage(text, isError = false) {
    const div = document.createElement('div');
    div.className = `message bot-message ${isError ? 'error' : ''}`;
    const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    div.innerHTML = `
        <div class="bot-avatar">
            <img src="assets/logo.png" alt="Krata AI">
        </div>
        <div class="bubble">${formattedText}</div>
    `;
    messagesContainer.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const scrollArea = document.getElementById('chat-history-container');
    if (scrollArea) {
        scrollArea.scrollTo({
            top: scrollArea.scrollHeight,
            behavior: 'smooth'
        });
    }
}

/**
 * Triggers the Deep Research Narrative
 */
async function handleNarrator() {
    if (!state.activeTable) return alert("Please upload a dataset first.");

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message narrator-container'; 
    msgDiv.dataset.prompt = "Execute Deep Research Protocol"; // Virtual prompt for regenerate

    msgDiv.innerHTML = `
        <div class="bot-avatar"><img src="/assets/logo.png" alt="Krata AI"></div>
        <div class="bubble premium-report w-full">
            <div class="report-header">
                <i data-lucide="shield-plus" class="text-purple-600"></i>
                <span>DEEP RESEARCH DOSSIER</span>
            </div>
            
            <div class="status-msg italic text-xs text-gray-400 mt-2">Connecting to Expert Network...</div>
            <div class="response-text prose prose-sm max-w-none text-gray-800"></div>

            <div class="chat-action-bar hidden">
                <button class="chat-action-btn" title="Copy" onclick="copyChatResponse(this)"><i data-lucide="copy"></i></button>
                <button class="chat-action-btn" title="Save to Library" onclick="saveChatToLibrary(this)"><i data-lucide="bookmark"></i></button>
                <button class="chat-action-btn" title="Add to Workspace" onclick="shareChatToWorkspace(this)"><i data-lucide="layout-dashboard"></i></button>
                <button class="chat-action-btn" title="Regenerate" onclick="regenerateChatResponse(this)"><i data-lucide="refresh-cw"></i></button>
                <button class="chat-action-btn delete-btn" title="Delete" onclick="deleteChatResponse(this)"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(msgDiv);
    lucide.createIcons();
    scrollToBottom();

    const statusEl = msgDiv.querySelector('.status-msg');
    const textEl = msgDiv.querySelector('.response-text');
    const actionBar = msgDiv.querySelector('.chat-action-bar');

    let fullStory = "";
    try {
        // 🚀 Switch to the NEW Deep Research stream
        for await (const chunk of streamDeepResearch(state.activeTable)) {
            if (chunk.type === 'status') {
                statusEl.innerText = chunk.content;
            } else if (chunk.type === 'text') {
                statusEl.style.display = 'none';
                fullStory += chunk.content;
                
                // Advanced Professional Formatting
                textEl.innerHTML = marked.parse(fullStory);
                // 🚀 CRITICAL: Continuous scroll for long reports
                const scrollArea = document.getElementById('chat-history-container');
                scrollArea.scrollTop = scrollArea.scrollHeight;

                scrollToBottom();
            }
        }
    } catch (err) {
        console.error(err);
        textEl.innerHTML = `<span class="text-gray-500 italic">Server is busy. Please try again.</span>`;
    } finally {
        if (actionBar) actionBar.classList.remove('hidden');
        lucide.createIcons();
    }
}

// A robust helper to open any modal
window.openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        // Add listener to close when clicking the dark background
        modal.onclick = (e) => {
            if (e.target === modal) closeAllModals();
        };
    }
};

// A robust helper to close all modals
window.closeAllModals = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
};



/**
 * 5. KRATABOOK FUNCTIONS AND HELPERS
 */

async function refreshKrataBookSidebar() {
    const list = document.getElementById('kratabook-list');
    const books = await fetchKrataBooks();
    
    // 🚀 Added title="${book.title}" for native hover tooltips
    list.innerHTML = books.map(book => `
        <div class="kratabook-item" onclick="viewKrataBook('${book.id}')">
            <i data-lucide="file-text" style="width:14px"></i>
            <span class="truncate" title="${book.title}">${book.title}</span>
        </div>
    `).join('');
    lucide.createIcons();
}

/**
 * VIEW KRATABOOK
 * Renders the full report and injects the "Share to Workspace" button into the sticky header.
 */
window.viewKrataBook = async (id) => {
    // 1. Fetch the book data
    const books = await fetchKrataBooks();
    const book = books.find(b => b.id === id);
    if (!book) return;

    // 2. Set the Title dynamically in the sticky header
    document.getElementById('kratabook-title-display').innerText = book.title;

    // 3. Inject the "Add to Workspace" button into the header's right side
    // Note: We pass 'this' so the function can animate the button clicked
    document.getElementById('kb-header-actions').innerHTML = `
        <button class="secondary-btn text-[12px] py-1.5 px-3 flex items-center gap-2" 
            onclick="exportKrataBookToPDF(this)">
            <i data-lucide="download-cloud" class="w-3.5 h-3.5"></i> Export PDF
        </button>
        <button class="secondary-btn text-[12px] py-1.5 px-3 flex items-center gap-2" 
            onclick="handleSaveKrataBookToLibrary('${book.id}', this)">
            <i data-lucide="bookmark" class="w-3.5 h-3.5"></i> Library
        </button>
        <button class="secondary-btn text-[12px] py-1.5 px-3 flex items-center gap-2" 
            onclick="handleShareKrataBookToWorkspace('${book.id}', this)">
            <i data-lucide="layout-dashboard" class="w-3.5 h-3.5"></i> Workspace
        </button>
    `;

    // 4. Define the Branding Header (for the document content)
    let headerHtml = `<div class="text-xs text-gray-400 mb-4 border-b pb-2">Krata AI Intelligence Report</div>`;
    
    if (book.metadata?.branding === 'agentic') {
        headerHtml = `
            <div class="bg-gray-900 text-white p-6 rounded-xl mb-6">
                <h1 class="text-xl font-bold m-0">CONFIDENTIAL STRATEGY DOCUMENT</h1>
                <p class="text-xs opacity-70">Generated via Agentic Background Protocol</p>
            </div>`;
    }

    // 5. Render to the content area
    const contentArea = document.getElementById('kratabook-content-area');
    contentArea.innerHTML = headerHtml + marked.parse(book.content);
    
    // 6. Open the view and refresh icons
    document.getElementById('kratabook-view').classList.remove('view-hidden');
    if (window.lucide) lucide.createIcons();
};

/**
 * HELPER: Handles saving KrataBook to Workspace with Visual Feedback
 */
window.handleShareKrataBookToWorkspace = async (bookId, btn) => {
    // Save original button state for restoration
    const originalHtml = btn.innerHTML;

    try {
        // Show Loading State
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-3.5 h-3.5"></i> Sharing...`;
        btn.disabled = true;
        lucide.createIcons();

        const books = await fetchKrataBooks();
        const book = books.find(b => b.id === bookId);
        if (!book) return;

        // Dynamically import the workspace module
        const { shareToWorkspace } = await import('./modules/workspace.js');

        // Share to the unified workspace logic
        await shareToWorkspace('kratabook', book.title, {
            content: book.content,
            metadata: book.metadata
        });
        
        // Show Success State (Green Check)
        btn.innerHTML = `<i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Added`;
        btn.style.color = '#137333';
        btn.style.borderColor = '#137333';
        btn.style.background = '#e6f4ea';
        lucide.createIcons();
        
        // Restore to original state after 2.5 seconds
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style = ''; // clear inline styles
            btn.disabled = false;
            lucide.createIcons();
        }, 2500);

    } catch (err) {
        console.error("Failed to share KrataBook:", err);
        alert("Could not share to workspace. Check connection.");
        
        // Restore button on error
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
};

document.getElementById('close-kratabook').addEventListener('click', () => {
    document.getElementById('kratabook-view').classList.add('view-hidden');
});

/**
 * 6. UI HELPER: Creates a live-updating ingestion progress card in the chat.
 */

function createIngestionProgressCard(fileName) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message';
    
    // Unique ID for this specific ingestion session
    const idPrefix = 'ingest-' + Date.now();
    
    msgDiv.innerHTML = `
        <div class="bot-avatar"><img src="assets/logo.png" alt="Krata AI"></div>
        <div class="bubble">
            <div class="ingestion-card">
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Neural Ingestion: ${fileName}</div>
                
                <div id="${idPrefix}-step1" class="step-item active">
                    <div class="step-icon"><i data-lucide="scan-eye"></i></div>
                    <div class="step-text">Local OCR Recognition</div>
                </div>
                
                <div id="${idPrefix}-step2" class="step-item">
                    <div class="step-icon"><i data-lucide="brain-circuit"></i></div>
                    <div class="step-text">Neural Data Structuring</div>
                </div>
                
                <div id="${idPrefix}-step3" class="step-item">
                    <div class="step-icon"><i data-lucide="milestone"></i></div>
                    <div class="step-text">Vector Embedding Generation</div>
                </div>
                
                <div id="${idPrefix}-step4" class="step-item">
                    <div class="step-icon"><i data-lucide="database"></i></div>
                    <div class="step-text">Committing to Local Vault</div>
                </div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(msgDiv);
    lucide.createIcons();
    scrollToBottom();

    return {
        updateStep: (stepNum, status) => {
            const el = document.getElementById(`${idPrefix}-step${stepNum}`);
            if (!el) return;
            el.classList.remove('active', 'completed');
            if (status === 'active') el.classList.add('active');
            if (status === 'completed') {
                el.classList.add('completed');
                el.querySelector('.step-icon').innerHTML = '<i data-lucide="check-circle-2" style="width:18px; color:#137333;"></i>';
                lucide.createIcons();
            }
        }
    };
}

/**
 * UI HELPER: Creates a sophisticated card to track 25-doc batches
 */
function createBatchIngestionCard(fileCount) {
    const idPrefix = 'batch-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message';
    msgDiv.innerHTML = `
        <div class="bot-avatar"><img src="/assets/logo.png" alt="Krata AI"></div>
        <div class="bubble">
            <div class="ingestion-card" style="max-width: 450px;">
                <div class="flex justify-between items-center mb-4">
                    <div class="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Neural Batch Process</div>
                    <div class="text-[10px] font-bold text-gray-400" id="${idPrefix}-count">0 / ${fileCount} Documents</div>
                </div>
                
                <!-- Overall Progress Bar -->
                <div class="util-bg mb-4" style="height: 4px; background: #e8f0fe;">
                    <div id="${idPrefix}-progress" class="util-fill" style="width: 0%; background: #0b57d0; height: 100%; transition: width 0.3s;"></div>
                </div>

                <div id="${idPrefix}-file-list" class="space-y-2 max-h-40 overflow-y-auto pr-2">
                    <!-- Individual files injected here -->
                </div>
            </div>
        </div>
    `;
    document.getElementById('messages').appendChild(msgDiv);
    lucide.createIcons();
    scrollToBottom();

    return {
        updateProgress: (current, total) => {
            const pct = (current / total) * 100;
            document.getElementById(`${idPrefix}-progress`).style.width = `${pct}%`;
            document.getElementById(`${idPrefix}-count`).innerText = `${current} / ${total} Documents`;
        },
        addFile: (fileName) => {
            const fileId = btoa(fileName).substring(0, 8);
            const row = document.createElement('div');
            row.id = `${idPrefix}-${fileId}`;
            row.className = 'flex justify-between items-center text-[11px] p-2 bg-gray-50 rounded-lg border border-gray-100';
            row.innerHTML = `
                <span class="truncate max-w-[200px]">${fileName}</span>
                <span class="status-label text-gray-400">Waiting...</span>
            `;
            document.getElementById(`${idPrefix}-file-list`).appendChild(row);
            return row;
        },
        markFileDone: (fileRow) => {
            fileRow.classList.add('bg-green-50', 'border-green-100');
            fileRow.querySelector('.status-label').innerHTML = '<i data-lucide="check" class="text-green-600 w-3 h-3"></i>';
            lucide.createIcons();
        }
    };
}

/**
 * EXECUTES SCHEMA MERGE & NOISE REDUCTION (Hardened against Hallucinations)
 */
async function applySchemaOptimization(tableName, plan) {
    try {
        // 🚀 THE FIX: Get the ACTUAL columns currently in the table
        const columnsData = await runQuery(`PRAGMA table_info('${tableName}')`);
        const actualCols = new Set(columnsData.map(c => c.name)); 

        const mergedCols = new Set();
        let selectClauses = [];

        // 1. Process Merges with Existence Check
        if (plan.merge) {
            for (const [newName, oldCols] of Object.entries(plan.merge)) {
                // 🚀 Ensure we only try to merge columns that REALLY exist
                const validOldCols = oldCols.filter(c => actualCols.has(c));
                
                if (validOldCols.length > 0) {
                    const safeOldCols = validOldCols.map(c => `"${c}"`).join(', ');
                    selectClauses.push(`COALESCE(${safeOldCols}) AS "${newName}"`);
                    validOldCols.forEach(c => mergedCols.add(c));
                }
            }
        }

        // 2. Filter Deletes with Existence Check
        const deleteCols = new Set((plan.delete || []).filter(c => actualCols.has(c)));

        // 3. Keep originals (Un-merged & Un-deleted)
        for (const col of actualCols) {
            if (!mergedCols.has(col) && !deleteCols.has(col)) {
                selectClauses.push(`"${col}"`);
            }
        }

        if (selectClauses.length === 0) return; 

        const tempTable = `${tableName}_optimized`;
        await runQuery(`CREATE TABLE "${tempTable}" AS SELECT ${selectClauses.join(', ')} FROM "${tableName}"`);
        await runQuery(`DROP TABLE "${tableName}"`);
        await runQuery(`ALTER TABLE "${tempTable}" RENAME TO "${tableName}"`);
        
        console.log("Schema Optimization Complete.");
    } catch (e) {
        console.error("Optimization Error:", e);
    }
}

/**
 * 7. MOVE VISUALS TO CHAT
 */

window.addEventListener('send-viz-to-chat', (e) => {
    const markdown = e.detail;
    
    // 1. Add to chat UI
    addSystemMessage(markdown);
    
    // 2. Trigger the mermaid processor on the new message
    setTimeout(async () => {
        const messages = document.querySelectorAll('.bot-message');
        const lastMessage = messages[messages.length - 1];
        if (window.processMermaidCharts) {
            await processMermaidCharts(lastMessage);
        }
    }, 100);
});

/**
 * 8. ADVANCED INTELLIGENCE CHECKUP ENGINE
 * Performs Math Forensics, LLM Schema Mapping, and Strategic Discovery.
 */

/**
 * ADVANCED INTELLIGENCE CHECKUP ENGINE
 * Performs Math Forensics, LLM Schema Mapping, and Schema Optimization (Merge + Noise Reduction).
 */
async function triggerIntelligenceCheckup(tableName) {
    // 1. Run All Diagnostics in Parallel for High Performance
    const [privacy, quality, forensics, whales, schemaMapping, optPlan] = await Promise.all([
        silentPrivacyScan(tableName),        // PII Shielding
        silentQualityAudit(tableName),       // Cleaning & Standardization
        runForensicAudit(tableName),         // Benford's Law
        detectWhales(tableName),             // Pareto 80/20 Rule
        getSmartSchemaMapping(tableName),    // LLM Semantic Translation
        getSchemaOptimizationPlan(tableName) // NEW: Schema Merge & Noise Reduction Plan
    ]);

    const cardId = `plan-${Date.now()}`;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot-message';

    // 🚀 LOGIC: Determine if Optimization is needed (Merge or Delete)
    const hasMergePotential = optPlan.merge && Object.keys(optPlan.merge).length > 0;
    const hasDeletePotential = optPlan.delete && optPlan.delete.length > 0;
    const needsOptimization = hasMergePotential || hasDeletePotential;

    // Calculate total columns targeted for removal/merge
    const mergeCount = hasMergePotential ? Object.values(optPlan.merge).flat().length : 0;
    const deleteCount = hasDeletePotential ? optPlan.delete.length : 0;

    msgDiv.innerHTML = `
        <div class="bot-avatar"><img src="/assets/logo.png" alt="Krata AI"></div>
        <div class="bubble">
            <div class="ingestion-card" style="max-width: 550px; padding: 24px; border-radius: 24px; border: 1px solid #eef2f6;">
                <h3 class="text-sm font-bold mb-6 flex items-center gap-2">
                    <i data-lucide="sparkles" class="text-blue-600 w-4 h-4"></i>
                    Intelligence Plan: ${tableName}
                </h3>

                <div class="intelligence-plan">
                    <!-- Step 1: Privacy & Compliance -->
                    <div class="plan-step" id="${cardId}-step-privacy">
                        <div class="step-icon-dot"><i data-lucide="shield-check" class="w-4 h-4 ${privacy.length > 0 ? 'text-red-500' : 'text-green-500'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Privacy & Compliance</span>
                            <span class="step-desc">${privacy.length > 0 ? `Detected ${privacy.length} sensitive columns. I recommend masking PII before further analysis.` : 'Standard scan confirms no sensitive PII patterns detected.'}</span>
                            ${privacy.length > 0 ? `<div class="step-actions"><button class="text-btn" id="${cardId}-fix-privacy">Apply Masking</button></div>` : ''}
                        </div>
                    </div>

                    <!-- Step 2: Schema Optimization (Consolidation & Noise Reduction) -->
                    <div class="plan-step" id="${cardId}-step-optimize">
                        <div class="step-icon-dot"><i data-lucide="git-merge" class="w-4 h-4 ${needsOptimization ? 'text-blue-500' : 'text-gray-400'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Schema Optimization</span>
                            <span class="step-desc">
                                ${needsOptimization 
                                    ? `Identified redundant data. I can consolidate <strong>${mergeCount}</strong> fields ${hasDeletePotential ? `and remove <strong>${deleteCount}</strong> OCR noise columns` : ''}.` 
                                    : 'Table schema is already lean and normalized.'}
                            </span>
                            ${needsOptimization ? `<div class="step-actions"><button class="text-btn" id="${cardId}-fix-optimize">Optimize Schema</button></div>` : ''}
                        </div>
                    </div>

                    <!-- Step 3: Forensic Integrity -->
                    <div class="plan-step" id="${cardId}-step-forensics">
                        <div class="step-icon-dot"><i data-lucide="fingerprint" class="w-4 h-4 ${forensics ? 'text-orange-500' : 'text-gray-400'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Forensic Audit</span>
                            <span class="step-desc">${forensics ? `Unusual digit distribution in <strong>${forensics.column}</strong>. May indicate manual manipulation.` : 'Benford’s Law scan indicates natural numerical distribution.'}</span>
                        </div>
                    </div>

                    <!-- Step 4: Quality & Cleansing -->
                    <div class="plan-step" id="${cardId}-step-quality">
                        <div class="step-icon-dot"><i data-lucide="microscope" class="w-4 h-4 ${quality.nulls > 0 ? 'text-blue-500' : 'text-gray-400'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Quality Engineering</span>
                            <span class="step-desc">${quality.nulls > 0 ? `Detected ${quality.nulls} gaps in data. Statistical imputation recommended for <strong>${quality.columnCount}</strong> columns.` : 'Table integrity passed. All required values are present.'}</span>
                            ${quality.nulls > 0 ? `<div class="step-actions"><button class="text-btn" id="${cardId}-fix-quality">Auto-Clean</button></div>` : ''}
                        </div>
                    </div>

                    <!-- Step 5: Strategic Discovery -->
                    <div class="plan-step">
                        <div class="step-icon-dot"><i data-lucide="target" class="w-4 h-4 ${whales ? 'text-purple-600' : 'text-gray-400'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Segment Discovery</span>
                            <span class="step-desc">${whales ? `Pareto Skew Detected: Top 20% of rows drive <strong>${whales.ratio}%</strong> of total value in <strong>${whales.column}</strong>.` : 'Statistical distribution is balanced across segments.'}</span>
                        </div>
                    </div>

                    <!-- Step 6: Semantic Mapping -->
                    <div class="plan-step" id="${cardId}-step-schema">
                        <div class="step-icon-dot"><i data-lucide="type" class="w-4 h-4 ${schemaMapping ? 'text-blue-600' : 'text-gray-400'}"></i></div>
                        <div class="step-content">
                            <span class="step-title">Semantic Translation</span>
                            <span class="step-desc">${schemaMapping ? `I've mapped technical headers to business terms.` : 'Column headers are already descriptive and analysis-ready.'}</span>
                            ${schemaMapping ? `<div class="step-actions"><button class="text-btn" id="${cardId}-fix-schema">Rename All</button></div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="plan-footer">
                    <div class="flex-1 flex items-center gap-2 text-[10px] text-gray-400">
                        <i data-lucide="clock" class="w-3 h-3"></i> Ready in < 1 min
                    </div>
                    <button class="secondary-btn px-6 border-none" onclick="this.closest('.message').remove()">Dismiss</button>
                    <button id="${cardId}-apply-all" class="primary-btn px-6 w-auto" style="background: #0b57d0;">Apply All Intelligence</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('messages').appendChild(msgDiv);
    lucide.createIcons();
    scrollToBottom();

    // --- BUTTON LOGIC ---

    // 1. APPLY ALL
    document.getElementById(`${cardId}-apply-all`).addEventListener('click', async () => {
        const btn = document.getElementById(`${cardId}-apply-all`);
        btn.disabled = true;
        btn.innerText = "Executing Plan...";

        // Modification Chain (Optimization runs before cleaning for best efficiency)
        if (privacy.length > 0) for (let p of privacy) await applyRedaction(tableName, p.column);
        if (needsOptimization) await applySchemaOptimization(tableName, optPlan);
        if (quality.nulls > 0) await runAutoClean(tableName);
        if (schemaMapping) await applySchemaRenaming(tableName, schemaMapping);
        
        // Refresh UI
        updateDataSelector(state); 
        const spreadsheetView = document.getElementById('spreadsheet-view');
        if (spreadsheetView && !spreadsheetView.classList.contains('view-hidden')) {
            import('./modules/spreadsheet.js').then(mod => mod.openSpreadsheet(tableName));
        }

        btn.innerText = "Plan Executed";
        addSystemMessage(`✅ **Intelligence Plan Executed.** ${tableName} has been secured and normalized.`);
        if (window.lucide) lucide.createIcons();
        setTimeout(() => msgDiv.remove(), 2000);
    });

    // 2. Individual Fix: Privacy
    document.getElementById(`${cardId}-fix-privacy`)?.addEventListener('click', async (e) => {
        e.target.innerText = "Masking...";
        for (let p of privacy) await applyRedaction(tableName, p.column);
        e.target.innerText = "Completed";
        e.target.disabled = true;
    });

    // 3. Individual Fix: Optimize (Merge + Noise Removal)
    document.getElementById(`${cardId}-fix-optimize`)?.addEventListener('click', async (e) => {
        const originalText = e.target.innerText;
        e.target.innerText = "Optimizing...";
        await applySchemaOptimization(tableName, optPlan);
        e.target.innerText = "Completed";
        e.target.disabled = true;
        updateDataSelector(state);
    });

    // 4. Individual Fix: Schema Rename
    document.getElementById(`${cardId}-fix-schema`)?.addEventListener('click', async (e) => {
        e.target.innerText = "Renaming...";
        await applySchemaRenaming(tableName, schemaMapping);
        e.target.innerText = "Completed";
        e.target.disabled = true;
    });
}

/**
 * 9. ADVANCED DIAGNOSTIC HELPERS
 */

async function getSmartSchemaMapping(tableName) {
    const cols = await runQuery(`PRAGMA table_info('${tableName}')`);
    const technicalCols = cols.map(c => c.name).filter(name => /^[A-Z0-9_]+$/.test(name) || name.includes('_'));
    
    if (technicalCols.length === 0) return null;
    
    const sample = await runQuery(`SELECT ${technicalCols.slice(0,3).map(c => `"${c}"`).join(', ')} FROM "${tableName}" LIMIT 3`);
    
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
            body: JSON.stringify({
                model: "mistral-small-latest",
                messages: [{
                    role: "system",
                    content: `Analyze these column names and sample data: ${JSON.stringify(sample)}. 
                    If the names are technical/cryptic, provide friendly Business Names.
                    Return ONLY JSON: {"tech_name": "Business Name"}`
                }],
                response_format: { type: "json_object" }
            })
        });
        const result = await response.json();
        return JSON.parse(result.choices[0].message.content);
    } catch(e) { return null; }
}

async function detectWhales(tableName) {
    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    const numCol = schema.find(c => ['DOUBLE', 'INTEGER', 'BIGINT'].includes(c.type));
    if (!numCol) return null;

    const sql = `
        WITH buckets AS (
            SELECT "${numCol.name}" as val, NTILE(5) OVER (ORDER BY "${numCol.name}" DESC) as b FROM "${tableName}"
        )
        SELECT b, SUM(val) as s FROM buckets GROUP BY 1 ORDER BY 1
    `;
    const res = await runQuery(sql);
    const top20Sum = Number(res[0].s);
    const totalSum = res.reduce((a, b) => a + Number(b.s), 0);
    const ratio = Math.round((top20Sum / totalSum) * 100);

    return ratio > 70 ? { column: numCol.name, ratio } : null;
}

async function runForensicAudit(tableName) {
    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    const numCol = schema.find(c => ['DOUBLE', 'INTEGER'].includes(c.type));
    if (!numCol) return null;

    const sql = `
        SELECT CAST(SUBSTRING(CAST(ABS("${numCol.name}") AS VARCHAR), 1, 1) AS INTEGER) as d,
        COUNT(*) * 100.0 / (SELECT COUNT(*) FROM "${tableName}") as p
        FROM "${tableName}" WHERE "${numCol.name}" > 0 GROUP BY 1 ORDER BY 1
    `;
    const dist = await runQuery(sql);
    const firstDigit = dist.find(d => d.d === 1);
    
    if (firstDigit && (firstDigit.p < 20 || firstDigit.p > 45)) {
        return { column: numCol.name, confidence: "Medium-High" };
    }
    return null;
}

async function applySchemaRenaming(tableName, mapping) {
    for (const [oldName, newName] of Object.entries(mapping)) {
        const cleanNewName = newName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        await runQuery(`ALTER TABLE "${tableName}" RENAME COLUMN "${oldName}" TO "${cleanNewName}"`);
    }
}

/**
 * 10. CHAT ACTION BAR LOGIC
 */

// 1. Copy to Clipboard
window.copyChatResponse = (btn) => {
    const responseContainer = btn.closest('.bubble').querySelector('.response-text');
    const textToCopy = responseContainer.innerText; // Extracts clean text, ignoring HTML
    
    navigator.clipboard.writeText(textToCopy);
    
    // Visual feedback fix
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="check" class="text-green-600"></i>`;
    lucide.createIcons();
    
    setTimeout(() => {
        btn.innerHTML = originalHtml;
        lucide.createIcons();
    }, 2000);
};

// 2. Add to Workspace
window.shareChatToWorkspace = async (btn) => {
    try {
        const botMsg = btn.closest('.message');
        const prompt = botMsg.dataset.prompt || "AI Insight";
        const contentHTML = botMsg.querySelector('.response-text').innerHTML;

        const { shareToWorkspace } = await import('./modules/workspace.js');
        
        // Share to the unified workspace logic
        await shareToWorkspace('chat', prompt, { content: contentHTML });
        
        // Visual feedback fix
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="check-circle-2" class="text-green-600"></i>`;
        lucide.createIcons();
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            lucide.createIcons();
        }, 2000);
        
    } catch (e) {
        console.error("Workspace sharing failed:", e);
        alert("Failed to pin to Workspace.");
    }
};

// 3. Regenerate Response
window.regenerateChatResponse = (btn) => {
    const botMsg = btn.closest('.message');
    const prompt = botMsg.dataset.prompt;
    
    if (prompt) {
        // Delete the current bot message and the user's previous message
        const prevMsg = botMsg.previousElementSibling;
        if (prevMsg && prevMsg.classList.contains('user-message')) {
            prevMsg.remove();
        }
        botMsg.remove();
        
        // Put the text back in the input box and fire the send sequence
        const promptInput = document.getElementById('user-prompt');
        promptInput.value = prompt;
        
        // We trigger the send button programmatically to restart the chain
        document.getElementById('btn-send').click();
    }
};

// 4. Delete Response
window.deleteChatResponse = (btn) => {
    const botMsg = btn.closest('.message');
    const prevMsg = botMsg.previousElementSibling;
    
    // Optionally remove the user's prompt that triggered this response to keep chat clean
    if (prevMsg && prevMsg.classList.contains('user-message')) {
        prevMsg.remove();
    }
    botMsg.remove();
};

// 4. Add to Library
window.saveChatToLibrary = async (btn) => {
    const botMsg = btn.closest('.message');
    const prompt = botMsg.dataset.prompt || "Private Insight";
    const contentHTML = botMsg.querySelector('.response-text').innerHTML;
    
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i>`;
    lucide.createIcons();

    try {
        await saveToLibrary('chat', prompt, { content: contentHTML });
        btn.innerHTML = `<i data-lucide="check" class="text-green-600"></i>`;
        lucide.createIcons();
    } catch (e) { alert("Save failed"); btn.innerHTML = originalHtml; lucide.createIcons(); }
};

/**
 * 11. KRATABOOK ACTIONS LOGIC
 */

// Handles saving a KrataBook to the personal Library with Visual Feedback
window.handleSaveKrataBookToLibrary = async (bookId, btn) => {
    // Save original button state for restoration
    const originalHtml = btn.innerHTML;

    try {
        // 1. Show Loading State
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-3.5 h-3.5"></i> Saving...`;
        btn.disabled = true;
        if (window.lucide) lucide.createIcons();

        // 2. Find the book content
        const books = await fetchKrataBooks();
        const book = books.find(b => b.id === bookId);
        if (!book) throw new Error("Report not found");

        // 3. Dynamically import library logic
        const { saveToLibrary } = await import('./modules/library.js');

        // 4. Save to the 'library_items' table
        await saveToLibrary('kratabook', book.title, {
            content: book.content,
            metadata: book.metadata
        });
        
        // 5. Show Success State
        btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i> Saved`;
        btn.style.color = '#0d6efd';       // Krata Blue
        btn.style.borderColor = '#0d6efd';
        btn.style.background = '#e7f1ff';
        if (window.lucide) lucide.createIcons();
        
        // 6. Restore to original state after 2.5 seconds
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style = ''; 
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }, 2500);

    } catch (err) {
        console.error("Library save failed:", err);
        alert("Failed to save to Library.");
        
        // Restore button on error
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
};

// Export Kratabook as PDF
window.exportKrataBookToPDF = async (btn) => {
    const originalHtml = btn.innerHTML;
    const reportElement = document.getElementById('kratabook-content-area');
    const reportTitle = document.getElementById('kratabook-title-display').innerText;

    try {
        // 1. UI Loading State
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-3.5 h-3.5"></i> Generating...`;
        btn.disabled = true;
        if (window.lucide) lucide.createIcons();

        // 2. Hide non-printable elements (like the "Share to Workspace" bar)
        const actionsBar = reportElement.querySelector('.bg-gray-50');
        if (actionsBar) actionsBar.style.display = 'none';

        // 3. PDF Configuration
        const opt = {
            margin:       [15, 15],
            filename:     `${reportTitle.replace(/[^a-z0-9]/gi, '_')}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
        };

        // 4. Run Conversion
        // We use html2pdf to capture the 'report-content' div
        await html2pdf().set(opt).from(reportElement).save();

        // 5. Restore UI
        if (actionsBar) actionsBar.style.display = 'flex';
        btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i> Downloaded`;
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }, 3000);

    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("Failed to generate PDF. Please try again.");
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
};

// Initialize Global Mermaid.js Engine
window.processMermaidCharts = processMermaidCharts;

// Start Application
init();
