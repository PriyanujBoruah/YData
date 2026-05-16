// js/modules/kratabook.js
import { supabaseClient } from '../core/auth.js';
import { getDeepTableProfile } from '../core/database.js';
import { PERSONA_CONFIGS } from './personas.js';
import { getAgenticContextString } from './agentic-bg.js';

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY;  
const API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * GENERATE AND SAVE REPORT
 */
export async function createKrataBook(activeTable, config) {
    if (!config) throw new Error("Report configuration is missing.");

    // 1. Get user session
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("User session expired.");

    const orgId = user.user_metadata?.org_id;

    // 2. Get the Data Profile
    const profile = await getDeepTableProfile(activeTable);
    
    // 3. Resolve Persona and Context
    const persona = PERSONA_CONFIGS[config.personaId] || PERSONA_CONFIGS['data_analyst'];
    const companyContext = getAgenticContextString();

    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: "mistral-medium-latest",
            messages: [{
                role: "system",
                content: `You are a Senior ${persona.name}. Write a ${config.type} report for the table: ${activeTable}.
                
                --- BUSINESS CONTEXT ---
                ${config.branding === 'agentic' ? companyContext : 'Standard analytical context.'}
                
                --- DATA PROFILE ---
                ${profile.columns.join('\n')}
                
                RULES:
                - Focus strictly on ${config.type} objectives.
                - Use professional Markdown.
                - Flag missing data as a strategic risk.
                -STRICT NEGATIVE CONSTRAINT: Do not include "Next Steps", "Implementation Plans", or "Roadmaps".
                End the document with a high-level summary of findings.`
            }],
            temperature: 0.3
        })
    });

    const data = await response.json();
    const reportContent = data.choices[0].message.content;

    // 4. Save to Supabase with Org ID
    const { error } = await supabaseClient.from('kratabooks').insert([{ 
        user_id: user.id, 
        org_id: orgId, // 🚀 Saved to Org
        title: `${config.type}: ${activeTable}`, 
        content: reportContent,
        metadata: config 
    }]);

    if (error) throw error;
    return true;
}

/**
 * FETCH REPORTS FOR THE ORG
 * Fixed the ReferenceError by fetching user session first.
 */
export async function fetchKrataBooks() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return [];

        // 🚀 THE FIX: Filter by user_id, NOT org_id
        // This ensures the sidebar list is private to the individual.
        const { data, error } = await supabaseClient
            .from('kratabooks')
            .select('*')
            .eq('user_id', user.id) 
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        return data || [];

    } catch (err) {
        console.error("Error fetching KrataBooks:", err);
        return [];
    }
}
