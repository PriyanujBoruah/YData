// js/modules/viz-engine.js
import { getTableSchema, getDeepTableProfile } from '../core/database.js';
import { fetchWithRetry } from '../core/utils.js';

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY;  
const API_URL = "https://api.mistral.ai/v1/chat/completions";
const VIZ_MODEL = "mistral-small-2603";

// DOM Elements
const modal = document.getElementById('viz-modal');
const configView = document.getElementById('viz-config-view');
const resultView = document.getElementById('viz-result-view');
const mermaidContainer = document.getElementById('modal-mermaid-container');
const refineInput = document.getElementById('viz-refine-input');

// State Management
let selectedType = 'pie';
export let lastMermaidCode = null;

// ============================================================================
// UI INITIALIZATION & EVENT LISTENERS
// ============================================================================

export function initVizEngine() {
    const trigger = document.getElementById('viz-dropdown-trigger');
    const optionsMenu = document.getElementById('viz-dropdown-options');
    const optionItems = document.querySelectorAll('.opt-item');

    // 1. CUSTOM DROPDOWN LOGIC
    // --------------------------------------------------------
    
    // Toggle Menu Visibility
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevents immediate close from the document listener
        optionsMenu.classList.toggle('hidden');
    });

    // Handle Option Selection
    optionItems.forEach(item => {
        item.addEventListener('click', () => {
            const value = item.dataset.value;
            const iconName = item.dataset.icon;
            const label = item.querySelector('span').innerText;

            // A. Update internal state for the AI Router
            selectedType = value;

            // B. Update the Trigger UI (Icon + Text)
            const triggerContent = trigger.querySelector('.trigger-content');
            triggerContent.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i> <span>${label}</span>`;
            
            // C. Visual Feedback: Toggle 'active' class in list
            optionItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // D. Close and Refresh
            optionsMenu.classList.add('hidden');
            if (window.lucide) lucide.createIcons();
        });
    });

    // Close dropdown if user clicks anywhere else on the screen
    document.addEventListener('click', () => {
        optionsMenu?.classList.add('hidden');
    });


    // 2. GENERATION & REFINEMENT
    // --------------------------------------------------------

    // Main Generation Button
    document.getElementById('btn-generate-viz')?.addEventListener('click', () => {
        const activeTable = document.getElementById('active-data-label').innerText;
        if (activeTable && activeTable !== "Select Data") {
            renderModalChart(activeTable);
        } else {
            alert("Please select or upload a dataset first.");
        }
    });

    // Iteration / Refinement Button
    document.getElementById('btn-refine-viz')?.addEventListener('click', () => {
        const instruction = refineInput.value.trim();
        const activeTable = document.getElementById('active-data-label').innerText;
        if (instruction && activeTable && activeTable !== "Select Data") {
            renderModalChart(activeTable, instruction);
        }
    });

    // Refinement via 'Enter' key
    refineInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-refine-viz').click();
        }
    });


    // 3. NAVIGATION & EXPORT
    // --------------------------------------------------------

    // Close Modal
    document.getElementById('close-viz')?.addEventListener('click', () => {
        modal.classList.add('overlay-hidden');
    });

    // Back to Configuration View
    document.getElementById('btn-viz-back')?.addEventListener('click', () => {
        configView.classList.remove('hidden');
        resultView.classList.add('hidden');
    });

    // Send the generated Mermaid markdown to the chat interface
    document.getElementById('btn-viz-save')?.addEventListener('click', () => {
        if (lastMermaidCode) {
            const markdown = `I've generated this visual insight for you:\n\n\`\`\`mermaid\n${lastMermaidCode}\n\`\`\``;
            
            // Dispatch custom event to main.js
            window.dispatchEvent(new CustomEvent('send-viz-to-chat', { detail: markdown }));
            modal.classList.add('overlay-hidden');
        }
    });

    // Export current SVG as high-res PNG
    document.getElementById('btn-viz-export')?.addEventListener('click', exportDiagramAsPNG);


    // 4. GLOBAL TRIGGER
    // --------------------------------------------------------

    // Listen for events from menus or sidebar to open the lab
    window.addEventListener('open-viz', () => {
        const activeTable = document.getElementById('active-data-label').innerText;
        openVizModal(activeTable !== "Select Data" ? activeTable : null);
    });

    // --------------------------------------------------------
    // NEW: SAVE TO LIBRARY (PRIVATE)
    // --------------------------------------------------------
    document.getElementById('btn-viz-library')?.addEventListener('click', async (e) => {
        if (!lastMermaidCode) return;

        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        const title = document.getElementById('viz-goal').value || "Private Visual Insight";

        try {
            btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> <span>Saving...</span>`;
            btn.disabled = true;
            if (window.lucide) lucide.createIcons();

            // Dynamically import library logic
            const { saveToLibrary } = await import('./library.js');

            // Save to 'library_items'
            await saveToLibrary('chart', title, { code: lastMermaidCode });

            // Success State (Blue)
            btn.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-blue-600"></i> <span class="text-blue-700">Saved</span>`;
            btn.style.borderColor = '#0d6efd';
            btn.style.backgroundColor = '#e7f1ff';
            if (window.lucide) lucide.createIcons();

            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.style = ''; 
                btn.disabled = false;
                if (window.lucide) lucide.createIcons();
            }, 2000);

        } catch (err) {
            console.error("Library save failed:", err);
            alert("Failed to save to Library.");
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }
    });

    // --------------------------------------------------------
    // NEW: ADD TO WORKSPACE
    // --------------------------------------------------------
    document.getElementById('btn-viz-workspace')?.addEventListener('click', async (e) => {
        if (!lastMermaidCode) return;

        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        // Use the user's prompt as the title, or fallback to a generic name
        const title = document.getElementById('viz-goal').value || "Visual Insight";

        try {
            // Show Loading State
            btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> <span>Saving...</span>`;
            btn.disabled = true;
            if (window.lucide) lucide.createIcons();

            // Dynamically import workspace logic
            const { shareToWorkspace } = await import('./workspace.js');

            // Save payload to the 'workspace_items' table.
            // Note: We use { code: lastMermaidCode } because that is what openWorkspaceItem expects
            await shareToWorkspace('chart', title, { code: lastMermaidCode });

            // Show Success State (Green Check)
            btn.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 text-green-600"></i> <span class="text-green-700">Added</span>`;
            btn.style.borderColor = '#137333';
            btn.style.backgroundColor = '#e6f4ea';
            if (window.lucide) lucide.createIcons();

            // Restore to original state after 2 seconds
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.style = ''; // clear inline styles
                btn.disabled = false;
                if (window.lucide) lucide.createIcons();
            }, 2000);

        } catch (err) {
            console.error("Workspace sharing failed:", err);
            alert("Could not share to workspace. Check connection.");
            
            // Restore button on error
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }
    });
}

/**
 * Ensures the Custom Dropdown resets to default when opening the modal.
 */
function openVizModal(tableName) {
    if (!tableName) return alert("Please upload a dataset first.");
    
    // Switch views
    configView.classList.remove('hidden');
    resultView.classList.add('hidden');
    
    // Reset Inputs
    document.getElementById('viz-goal').value = "";
    if (refineInput) refineInput.value = "";
    
    // Reset Custom Dropdown to 'Pie Chart' (Default)
    selectedType = 'pie';
    const triggerContent = document.querySelector('#viz-dropdown-trigger .trigger-content');
    if (triggerContent) {
        triggerContent.innerHTML = `<i data-lucide="pie-chart" class="w-4 h-4"></i> <span>Distribution (Pie Chart)</span>`;
    }
    
    // Clear active state and set default
    document.querySelectorAll('.opt-item').forEach(i => i.classList.remove('active'));
    document.querySelector('.opt-item[data-value="pie"]')?.classList.add('active');

    lastMermaidCode = null; 
    modal.classList.remove('overlay-hidden');
    
    // Hydrate icons
    if (window.lucide) lucide.createIcons();
}

// ============================================================================
// CORE ENGINE: Orchestrator
// ============================================================================

/**
 * CORE ENGINE: Orchestrator for AI Diagram Generation & Refinement.
 * Handles specialized prompt routing and Mermaid.js rendering.
 */
async function renderModalChart(tableName, instruction = null) {
    const goal = document.getElementById('viz-goal').value || "Summarize the key metrics.";
    const schema = await getTableSchema(tableName);
    const profile = await getDeepTableProfile(tableName);
    
    // Provide AI with the first 10 columns of statistics for high-accuracy reasoning
    const dataContext = profile.columns.slice(0, 10).join('\n'); 

    // UI Reference & Loading States
    const btnGenerate = document.getElementById('btn-generate-viz');
    const btnRefine = document.getElementById('btn-refine-viz');
    
    // Create a unique ID for this specific render attempt (used for cleanup on failure)
    const renderId = 'viz-render-' + Date.now();

    if (instruction) {
        btnRefine.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i>`;
    } else {
        btnGenerate.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4 mr-2 inline"></i> Generating...`;
    }
    if (window.lucide) lucide.createIcons();

    try {
        let code = "";
        const ctx = { tableName, schema, dataContext, goal, instruction, lastMermaidCode };

        // 1. ROUTE: Send to specialized AI Micro-Agent
        if (instruction && lastMermaidCode) {
            // Edit existing diagram logic
            code = await AI_ROUTERS['refine'](ctx);
        } else {
            // Create new diagram logic based on dropdown selection
            const aiCall = AI_ROUTERS[selectedType] || AI_ROUTERS['fallback'];
            code = await aiCall(ctx);
        }

        // 2. SANITIZE: Remove any markdown code block wrappers injected by the LLM
        code = code.replace(/```mermaid/g, '').replace(/```/g, '').trim();
        lastMermaidCode = code; 

        // 3. RENDER: Use global Mermaid instance to generate SVG
        // window.mermaid.render is async in v10+
        const { svg } = await window.mermaid.render(renderId, code);
        
        // Inject SVG into the UI
        mermaidContainer.innerHTML = svg;

        // 4. UI TRANSITION: Show the result and hide the config form
        configView.classList.add('hidden');
        resultView.classList.remove('hidden');
        
        // Clear the refinement input for the next round
        if (refineInput) refineInput.value = ""; 

    } catch (err) {
        // 🚀 THE FIX: Use 'err' (matching the catch variable)
        console.error("Visualization Rendering Failed:", err);
    
        // 🚀 THE FIX: Correctly identify and remove the Mermaid "Ghost" Error element
        // Mermaid v10+ injects a div with ID "d" + your renderId when it fails
        const ghostError = document.getElementById('d' + renderId);
        if (ghostError) ghostError.remove();

        // 🚀 THE FIX: Provide localized fallback UI inside the Mermaid container
        mermaidContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 text-center bg-red-50 rounded-xl border border-red-100">
                <i data-lucide="alert-circle" class="text-red-500 w-8 h-8 mb-3"></i>
                <div class="text-red-800 font-bold">Logic Too Complex</div>
                <div class="text-red-600 text-xs mt-1">The AI generated code that Mermaid couldn't render. Try a simpler goal or instruction.</div>
                <code class="text-[10px] mt-4 p-2 bg-white rounded border text-gray-400 block w-full overflow-auto max-h-24">
                    ${lastMermaidCode || "No code generated."}
                </code>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        // If it was an initial generation, don't swap views so the user can edit the goal
        if (instruction) {
            configView.classList.add('hidden');
            resultView.classList.remove('hidden');
        }
    } finally {
        // Restore Button UI
        btnGenerate.innerText = "Generate Visual Intelligence";
        btnRefine.innerHTML = `<i data-lucide="refresh-cw"></i>`;
        if (window.lucide) lucide.createIcons();
    }
}

// ============================================================================
// AI MICROSERVICES (15 Dedicated Prompts + 1 Refiner)
// ============================================================================

async function fetchMermaid(systemPrompt, temp = 0.2) {
    const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: VIZ_MODEL,
            messages:[{ role: "system", content: systemPrompt }],
            temperature: temp
        })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}

const AI_ROUTERS = {
    // --- 1. GROWTH & MARKETING ---
    'xychart': async (ctx) => fetchMermaid(`
        TASK: Build an India-localized Bar/Line chart using Mermaid xychart syntax.
        
        SYNTAX PATTERN:
        xychart
            title "Chart Title"
            x-axis [Label1, Label2, Label3]
            y-axis "Y-Axis Title" [Min] --> [Max]
            bar [val1, val2, val3]
            line [val1, val2, val3]

        SYNTAX EXAMPLE:
        xychart
            title "Monthly Revenue Growth (₹ Lakhs)"
            x-axis [Apr, May, Jun, Jul, Aug, Sep]
            y-axis "Revenue in Lakhs" 0 --> 150
            bar [45, 52, 91, 85, 70, 110]
            line [45, 52, 91, 85, 70, 110]

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use Lakhs (L) and Crores (Cr) for large values to align with Indian business reporting.
        2. Use the ₹ (INR) prefix for currency-related titles or axis labels.
        3. Prioritize the Indian Fiscal Year (starting April) for the x-axis if months are detected.
        4. Output ONLY the raw mermaid code. No markdown code blocks, no backticks, and no conversational text.
        5. Ensure the x-axis labels inside the brackets [ ] are separated by commas or spaces.
    `),

    'sankey': async (ctx) => fetchMermaid(`
        TASK: Build a Bharat-localized Sankey diagram to show distribution or flow.
        
        STRICT SYNTAX RULES:
        1. The first line must be ONLY the word: sankey
        2. Every data relationship must be on a NEW LINE.
        3. Format: "Source", "Target", Value
        CRITICAL: The word "sankey" MUST be on its own line. Use exactly one newline (\\n) before starting data.

        SYNTAX EXAMPLE:
        sankey
            "Gross Revenue", "GST (18%)", 180000
            "Gross Revenue", "Net Realized", 820000
            "Net Realized", "Logistics", 150000
            "Net Realized", "Marketing", 200000
            "Net Realized", "Profit", 470000

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for visualizing Cash Flow, Tax (GST/TDS) breakdowns, or Lead to Sale conversions.
        2. Ensure values are mapped logically from source to target.
        3. Output ONLY raw mermaid code. No markdown code blocks.
    `),

    'journey': async (ctx) => fetchMermaid(`
        TASK: Build a User Journey map for Indian digital funnels.
        
        SYNTAX PATTERN:
        journey
            title "Journey Title"
            section Section Name
              Task: Score: Actor1, Actor2

        SYNTAX EXAMPLE:
        journey
            title "Click-to-WhatsApp Purchase Flow"
            section Discovery
              See Instagram Ad: 5: Customer
              Click 'Message Us': 4: Customer
            section Engagement
              WhatsApp Auto-reply: 5: Bot
              Product Catalog Shared: 3: Bot, Sales_Agent
            section Conversion
              UPI Payment Link: 5: Customer
              Delivery Update: 4: Shiprocket

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Actors should reflect the Indian ecosystem (e.g., Customer, Delivery_Partner, UPI_App, WhatsApp_Bot).
        2. Satisfaction scores range from 0 to 5.
        3. Focus on "Trust Points" like UPI payment, COD verification, and vernacular support.
        4. Output ONLY raw mermaid code.
    `),

    'pie': async (ctx) => fetchMermaid(`
        TASK: Build an India-localized Pie chart for distribution analysis.
        
        SYNTAX PATTERN:
        pie title "Chart Title"
            "Label 1" : Value1
            "Label 2" : Value2

        SYNTAX EXAMPLE:
        pie title "Category-wise Sales (₹ Lakhs)"
            "Smartphones" : 450
            "Accessories" : 120
            "Wearables" : 85

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for GST slab distribution (5%, 12%, 18%), Regional splits (Tier 1 vs Tier 2), or Category share.
        2. Always wrap labels in double quotes (" ").
        3. If values are large, format them in Lakhs or Crores in the labels.
        4. Output ONLY the raw mermaid code. No markdown backticks.
    `),

    // --- 2. E-COMMERCE OPERATIONS ---
    'state': async (ctx) => fetchMermaid(`
        TASK: Build an India-localized Order or Process lifecycle diagram.
        
        SYNTAX PATTERN:
        stateDiagram-v2
            [*] --> State1
            State1 --> State2 : Action/Event
            State2 --> [*]

        SYNTAX EXAMPLE:
        stateDiagram-v2
            [*] --> Order_Placed
            Order_Placed --> UPI_Verification : Customer Pays
            UPI_Verification --> Out_for_Delivery : Payment Verified
            Out_for_Delivery --> Delivered : Successfully Received
            Out_for_Delivery --> RTO_Initiated : Customer Refused/Address Issue
            RTO_Initiated --> Returned_to_Warehouse
            Delivered --> [*]
            Returned_to_Warehouse --> [*]

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Focus on the unique Indian delivery lifecycle (COD, UPI Verification, RTO, NDR).
        2. Use underscores (_) instead of spaces in State names to avoid syntax errors.
        3. Use descriptive labels after the colon (:) for clarity.
        4. Output ONLY raw mermaid code.
    `),

    'er': async (ctx) => fetchMermaid(`
        TASK: Build an Entity Relationship Diagram (ERD) for Indian business data mapping.
        
        SYNTAX PATTERN:
        erDiagram
            ENTITY1 ||--o{ ENTITY2 : "Label"
            ENTITY1 {
                type field_name
            }

        SYNTAX EXAMPLE:
        erDiagram
            GST_INVOICE ||--|{ LINE_ITEMS : contains
            GST_INVOICE }|--|| VENDOR : issued_by
            VENDOR ||--o{ TDS_CHALLAN : requires
            GST_INVOICE {
                string gst_number
                float taxable_value
                float igst_18_pct
            }

        DATA CONTEXT: ${ctx.schema}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Map relationships like "Customer to UPI_Transaction," "Invoice to GST_Slab," or "Distributor to Kirana."
        2. Use underscores (_) for entity and field names to ensure syntax stability.
        3. Use this to help users understand how their disparate Tally, E-com, and Bank data link together.
        4. Output ONLY raw mermaid code.
    `),

    'timeline': async (ctx) => fetchMermaid(`
        TASK: Build a Bharat-localized business timeline.
        
        SYNTAX PATTERN:
        timeline
            title "Timeline Title"
            Period 1 : Event : Sub-event
            Period 2 : Event

        SYNTAX EXAMPLE:
        timeline
            title "Indian Festive Sales Cycle"
            Sept : Prep : Inventory Stocking
            Oct : Navratri : Dussehra Sale
            Nov : Diwali Peak : Bhai Dooj
            Dec : Year-end Clearout : Wedding Season

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Prioritize the Indian Fiscal Year (April-March) or the Festive Calendar (Sept-Jan).
        2. Group multiple events under the same period using colons ( : ).
        3. Use this for tracking project milestones, tax filing deadlines, or historical growth.
        4. Output ONLY raw mermaid code.
    `),

    'radar': async (ctx) => fetchMermaid(`
        TASK: Build a Bharat-localized Performance Audit (Radar Chart).
        
        SYNTAX PATTERN:
        radar-beta
          title "Chart Title"
          axis label1["Name"], label2["Name"]
          curve a["Series A"]{val1, val2}
          max [MaxValue]

        SYNTAX EXAMPLE:
        radar-beta
          title "Logistics Partner Performance"
          axis speed["Last-mile Speed"], rto["Low RTO %"], cod["COD Remittance"], support["Support"]
          curve a["Delhivery"]{4.5, 3.8, 4.2, 3.5}
          curve b["BlueDart"]{4.8, 4.5, 4.0, 4.8}
          curve c["Ecom Express"]{3.5, 4.0, 4.5, 3.0}
          max 5

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Perfect for comparing Indian courier partners (Delhivery, BlueDart), Bank Gateways, or Regional Sales performance.
        2. Always define a "max" value (e.g., 5 or 100) to keep the scale consistent.
        3. Output ONLY raw mermaid code. No markdown formatting.
    `),

    'gantt': async (ctx) => fetchMermaid(`
        TASK: Build a Bharat-localized Logistics or Project timeline (Gantt Chart).
        
        SYNTAX PATTERN:
        gantt
            title "Chart Title"
            dateFormat YYYY-MM-DD
            section Section Name
                Task Name : [status], [id], [start_date], [duration]
                Follow-up Task : after [id], [duration]

        SYNTAX EXAMPLE:
        gantt
            title "Diwali Inventory & Prep (FY24)"
            dateFormat YYYY-MM-DD
            section Procurement
                Factory Production : p1, 2024-09-01, 25d
                Customs & Transit : after p1, 10d
            section Distribution
                Warehouse Stocking : active, d1, 2024-10-05, 15d
                Last-mile to Kiranas : after d1, 20d

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for tracking Supply Chain lead times (Mundra Port to City), Festive Season stocking, or March Audit cycles.
        2. Ensure date formats match YYYY-MM-DD.
        3. Output ONLY the raw mermaid code.
    `),

    'treemap': async (ctx) => fetchMermaid(`
        TASK: Build a hierarchical Treemap for India-localized spending or category analysis.
        
        SYNTAX PATTERN:
        treemap
        "Root Category"
            "Sub-Category A": Value
            "Sub-Category B": Value

        SYNTAX EXAMPLE:
        treemap
        "Total FY24 Budget (₹ Crores)"
            "Marketing (Meta & Google)": 45
            "Operations": 30
            "Salaries & HR": 20
            "GST & Compliance": 5

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Indentation is CRITICAL. Sub-items must be indented under their parent.
        2. Use double quotes (" ") for all labels containing spaces or special characters.
        3. Format values in Lakhs (L) or Crores (Cr) to keep the labels readable.
        4. Output ONLY raw mermaid code.
    `),

    // --- 3. STRATEGIC INTELLIGENCE ---
    'mindmap': async (ctx) => fetchMermaid(`
        TASK: Build a strategic Bharat-centric Mindmap.
        
        SYNTAX PATTERN:
        mindmap
          root(([Title]))
            Category 1
              Sub-item A
              Sub-item B
            Category 2
              Sub-item C

        SYNTAX EXAMPLE:
        mindmap
          root((Bharat Growth Strategy))
            Tier 2 Expansion
              Lucknow Hub
              Indore Logistics
              Jaipur Marketing
            Vernacular Content
              Hindi Ad Copies
              Tamil Support
              Marathi Catalog
            Payment Trust
              UPI Cashback
              No-cost EMI

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Focus on "Bharat-First" strategies (Tier 2/3 cities, vernacular marketing, UPI adoption).
        2. Use root(( )) for the central goal and indented lines for hierarchy.
        3. Output ONLY raw mermaid code.
    `),

    'kanban': async (ctx) => fetchMermaid(`
        TASK: Build a Bharat-localized Kanban board for operations or task tracking.
        
        SYNTAX PATTERN:
        kanban
          Section Name
            [Item Label]
            id[Item Label]@{ priority: 'High', assigned: 'Name' }

        SYNTAX EXAMPLE:
        kanban
          Pending Audits
            [GST Feb Reconciliation]
            tds[Verify TDS Challans]@{ priority: 'High', assigned: 'CA_Ankit' }
          In Progress
            id1[Dispatching Diwali Hampers]
          Done
            id2[March Closing Verified]@{ priority: 'Very High' }

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for tracking Lead Status, Audit progress, or Inventory movement.
        2. Items inside brackets [] can contain spaces. 
        3. Priority levels: 'Low', 'Medium', 'High', 'Very High'.
        4. Output ONLY raw mermaid code.
    `),

    'quadrant': async (ctx) => fetchMermaid(`
        TASK: Build a strategy matrix (Quadrant Chart) for Bharat market analysis.
        
        SYNTAX PATTERN:
        quadrantChart
            title "Chart Title"
            x-axis [Low Label] --> [High Label]
            y-axis [Low Label] --> [High Label]
            quadrant-1 [Strategic Label]
            quadrant-2 [Strategic Label]
            quadrant-3 [Strategic Label]
            quadrant-4 [Strategic Label]
            "Item A": [x_value, y_value]

        SYNTAX EXAMPLE:
        quadrantChart
            title "Market Prioritization (Tier 2/3 Cities)"
            x-axis "Low Sales Volume" --> "High Sales Volume"
            y-axis "High RTO Risk" --> "Low RTO Risk"
            quadrant-1 "Aggressive Scale"
            quadrant-2 "Improve Logistics"
            quadrant-3 "Niche/High Margin"
            quadrant-4 "Avoid/Fix RTO"
            "Indore": [0.85, 0.9]
            "Lucknow": [0.7, 0.4]
            "Patna": [0.4, 0.2]

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for segmenting regions by Volume vs RTO (Return to Origin), or Channels by CPL vs Quality.
        2. Values for x and y must be between 0.0 and 1.0.
        3. Output ONLY the raw mermaid code.
    `),

    'flowchart': async (ctx) => fetchMermaid(`
        TASK: Build an India-specific logic or process Flowchart.
        
        SYNTAX PATTERN:
        flowchart TD
            NodeID[Label] -->|Transition| DecisionID{Decision?}
            DecisionID -->|Option 1| SuccessID[Success]

        SYNTAX EXAMPLE:
        flowchart TD
            A[Purchase Recorded] --> B{GST Invoice?}
            B -->|Yes| C[Check GSTR-2B]
            B -->|No| D[Flag for Tax Risk]
            C --> E{Credit Visible?}
            E -->|Yes| F[Claim ITC]
            E -->|No| G[Follow up with Vendor]
            F --> H[Monthly Filing Done]

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use TD (Top-Down) for deep processes or LR (Left-Right) for horizontal funnels.
        2. Nodes inside {} should represent decisions (like "UPI Success?", "Is MSME?", "COD Verified?").
        3. Ensure edge labels (-->|text|) clearly describe the condition.
        4. Output ONLY raw mermaid code.
    `),

    'sequence': async (ctx) => fetchMermaid(`
        TASK: Build an India-localized process flow or system interaction (Sequence Diagram).
        
        SYNTAX PATTERN:
        sequenceDiagram
            participant ID as "Display Name"
            ID1 ->> ID2: Message Text
            ID2 -->> ID1: Response Text

        SYNTAX EXAMPLE:
        sequenceDiagram
            participant C as "Customer"
            participant U as "UPI App (PhonePe)"
            participant B as "Bank (HDFC)"
            participant M as "Merchant"

            C ->> U: Initiate Payment (₹1,500)
            U ->> B: Authenticate PIN
            B -->> U: Success (UTR: 402923)
            U ->> M: Settle Credits
            M -->> C: Order Confirmed

        DATA CONTEXT: ${ctx.dataContext}
        USER GOAL: ${ctx.goal}

        STRICT BHARAT RULES:
        1. Use for explaining UPI payment loops, Tally-to-Cloud syncs, or Lead-to-Sale handoffs.
        2. Actors/Participants should reflect the Indian ecosystem (e.g., UPI_Gateway, Warehouse_Godown, CA_Internal).
        3. Use arrows (->>) for synchronous calls and dashed arrows (-->>) for responses.
        4. Output ONLY raw mermaid code. No markdown formatting.
    `),

    // --- CORE FALLBACKS ---
    'fallback': async (ctx) => fetchMermaid(`Build a Mermaid diagram for Goal: ${ctx.goal}. Data: ${ctx.dataContext}. Output raw code.`, 0.3),
    
    'refine': async (ctx) => fetchMermaid(`You are refining an existing Mermaid diagram.
    CURRENT CODE: \n${ctx.lastMermaidCode}\n
    USER INSTRUCTION: "${ctx.instruction}"
    GOAL: Update the code to fulfill the instruction perfectly. Output ONLY the raw Mermaid code. No backticks.`, 0.2)
};

// ============================================================================
// EXPORT CAPABILITY (SVG to High-Res PNG)
// ============================================================================

async function exportDiagramAsPNG() {
    const svg = mermaidContainer.querySelector('svg');
    if (!svg) return alert("No diagram found to export.");

    const width = svg.viewBox.baseVal.width || svg.clientWidth || 800;
    const height = svg.viewBox.baseVal.height || svg.clientHeight || 600;
    
    const scale = 2; // High-DPI Output
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
        ctx.fillStyle = "white"; // Solid background for presentations
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, width * scale, height * scale);
        
        const pngUrl = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngUrl;
        downloadLink.download = `Krata_Insight_${Date.now()}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
    };
    img.src = url;
}
