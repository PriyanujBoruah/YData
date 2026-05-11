// js/modules/agentic-bg.js
import { supabaseClient } from '../core/auth.js';

const modal = document.getElementById('agentic-bg-modal');
const toggle = document.getElementById('bg-toggle');
const companyInput = document.getElementById('bg-company-name');
const industryInput = document.getElementById('bg-industry');
const descInput = document.getElementById('bg-description');
const charCount = document.getElementById('bg-char-count');
const saveBtn = document.getElementById('btn-save-bg');

// Store current state in memory for fast access by the AI
let currentBackground = {
    is_enabled: false,
    company_name: '',
    industry: '',
    description: ''
};

export async function initAgenticBackground() {
    // 1. Fetch existing data on boot
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const orgId = user.user_metadata?.org_id;
    if (!orgId) return;

    const { data, error } = await supabaseClient
        .from('Background')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle(); // We use .single() because there is only 1 row per user

    if (data) {
        currentBackground = data;
        
        // Hydrate UI
        toggle.checked = data.is_enabled;
        companyInput.value = data.company_name || '';
        industryInput.value = data.industry || '';
        descInput.value = data.description || '';
        charCount.innerText = descInput.value.length;
    }

    // 2. Character Counter Listener
    descInput.addEventListener('input', () => {
        charCount.innerText = descInput.value.length;
    });

    // 3. Save Button Listener
    saveBtn.addEventListener('click', async () => {
        saveBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Saving...`;
        lucide.createIcons();

        const updatedData = {
            org_id: orgId,
            user_id: user.id,
            is_enabled: toggle.checked,
            company_name: companyInput.value.trim(),
            industry: industryInput.value.trim(),
            description: descInput.value.trim()
        };

        // Upsert will insert if missing, or update if user_id exists
        const { error } = await supabaseClient.from('Background').upsert(updatedData, { onConflict: 'org_id' });

        if (error) {
            alert("Failed to save background: " + error.message);
        } else {
            currentBackground = updatedData;
            modal.classList.remove('active'); // Close modal
        }

        saveBtn.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i> Save Context`;
        lucide.createIcons();
    });
}

export function openAgenticBgModal() {
    modal.classList.add('active');
}

/**
 * Provides the formatted string to be injected into the AI's prompt.
 * If disabled, returns an empty string.
 */
export function getAgenticContextString() {
    if (!currentBackground.is_enabled) return "";
    
    return `
    --- AGENTIC BACKGROUND (COMPANY CONTEXT) ---
    Company Name: ${currentBackground.company_name}
    Industry/Sector: ${currentBackground.industry}
    Business Description: ${currentBackground.description}
    
    CRITICAL: Tailor your strategic insights, tone, and recommendations SPECIFICALLY to align with this company's business model and industry.
    --------------------------------------------
    `;
}
