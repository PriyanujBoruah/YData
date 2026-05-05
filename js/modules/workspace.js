// js/modules/workspace.js
import { supabaseClient } from '../core/auth.js';

/**
 * THEME HELPER: Returns colors and icons based on item type
 */
function getCardTheme(type) {
    if (type === 'chart') return { 
        bg: 'bg-blue-50', 
        border: 'border-blue-100', 
        text: 'text-blue-700', 
        icon: 'bar-chart-3' 
    };
    if (type === 'kratabook') return { 
        bg: 'bg-purple-50', 
        border: 'border-purple-100', 
        text: 'text-purple-700', 
        icon: 'file-text' 
    };
    if (type === 'chat') return { 
        bg: 'bg-green-50', 
        border: 'border-green-100', 
        text: 'text-green-700', 
        icon: 'message-square' 
    };
    return { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', icon: 'file' };
}

/**
 * SHARED LOGIC: Save an item to the workspace
 */
export async function shareToWorkspace(type, title, payload) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Capture B2B context and Social metadata
    const orgId = user.user_metadata?.org_id;
    const authorName = user.user_metadata?.display_name || user.user_metadata?.full_name || user.email.split('@')[0];
    const authorAvatar = user.user_metadata?.avatar_url || null;

    const { error } = await supabaseClient.from('workspace_items').insert([{
        user_id: user.id,
        org_id: orgId, 
        author_name: authorName,
        author_avatar: authorAvatar,
        type,
        title,
        payload
    }]);

    if (error) {
        alert("Sharing failed: " + error.message);
        throw error;
    }
}

/**
 * VIEW LOGIC: Render Org-filtered cards with Avatars
 */
export async function loadItems(filterType = 'all') {
    const grid = document.getElementById('workspace-content-grid');
    grid.innerHTML = '<div class="text-xs text-gray-400 col-span-full">Syncing with team vault...</div>';

    // 1. Fetch user
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    if (!user) return;

    // 🚀 DEBUG: Add this log to your console (F12)
    const orgId = user.user_metadata?.org_id;
    console.log("Current Session OrgID:", orgId);

    if (!orgId) {
        grid.innerHTML = '<div class="text-xs text-orange-500 col-span-full">No Organization linked to this account. Please go to Edit Profile.</div>';
        return;
    }

    // 2. Query filtered by Org
    let query = supabaseClient.from('workspace_items')
        .select('*')
        .eq('org_id', orgId); 
    if (filterType !== 'all') query = query.eq('type', filterType);
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error || !data) {
        grid.innerHTML = '<div class="text-xs text-red-500 col-span-full">Failed to load items.</div>';
        return;
    }

    if (data.length === 0) {
        grid.innerHTML = '<div class="text-xs text-gray-400 col-span-full text-center py-8">No shared items in your organization yet.</div>';
        return;
    }

    grid.innerHTML = data.map(item => {
        const theme = getCardTheme(item.type);
        const isOwner = item.user_id === user.id;
        const authorDisplay = isOwner ? 'You' : (item.author_name || 'Team Member');

        // Logic for card avatar (Google Image or Colored Initial)
        const avatarContent = item.author_avatar 
            ? `<img src="${item.author_avatar}" class="w-full h-full object-cover" referrerpolicy="no-referrer">`
            : authorDisplay.charAt(0).toUpperCase();

        return `
            <div class="workspace-card ${theme.bg} ${theme.border}" id="card-${item.id}">
                
                <div class="card-header">
                    <div class="flex items-center gap-2">
                        <!-- User Avatar + Username -->
                        <div class="w-6 h-6 rounded-full bg-white flex items-center justify-center overflow-hidden shadow-sm border border-white/50 text-[10px] font-bold ${theme.text}">
                            ${avatarContent}
                        </div>
                        <span class="text-[12px] font-bold ${theme.text}">${authorDisplay}</span>
                        <!-- Item Type Icon -->
                        <div class="ml-1 opacity-40">
                             <i data-lucide="${theme.icon}" style="width:18px; height:18px; padding-top: 16px;"></i>
                        </div>
                    </div>

                    ${isOwner ? `
                        <button class="delete-workspace-item text-gray-400 hover:text-red-600 hover:bg-red-50" 
                            onclick="event.stopPropagation(); removeItemFromWorkspace('${item.id}')">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    ` : ''}
                </div>

                <div onclick="openWorkspaceItem('${item.id}')" class="mt-4" style="flex:1">
                    <strong class="text-sm text-gray-900 block line-clamp-2 leading-tight">${item.title}</strong>
                    <p class="text-[10px] text-gray-500 mt-2 flex items-center gap-1.5 opacity-80" style="font-size: small;">
                        <i data-lucide="clock" style="width: 10px; height: 10px;"></i> 
                        ${new Date(item.created_at).toLocaleDateString()}
                    </p>
                </div>
                
            </div>
        `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();
}

/**
 * INITIALIZATION: Setup filters and listeners
 */
export async function initWorkspaceUI() {
    const filters = document.querySelectorAll('.filter-pill');

    filters.forEach(f => {
        f.onclick = () => {
            filters.forEach(btn => btn.classList.remove('active'));
            f.classList.add('active');
            loadItems(f.dataset.filter);
        };
    });

    const workspaceBtn = document.getElementById('sidebar-workspace-btn');
    if (workspaceBtn) {
        workspaceBtn.onclick = () => {
            window.openModal('workspace-modal');
            loadItems('all');
        };
    }
}

/**
 * REMOVE LOGIC
 */
export async function removeItemFromWorkspace(itemId) {
    if (!confirm("Are you sure you want to remove this item from the organization workspace?")) return;

    const { error } = await supabaseClient.from('workspace_items').delete().eq('id', itemId);

    if (error) {
        alert("Failed to remove item: " + error.message);
    } else {
        const activeFilter = document.querySelector('.filter-pill.active')?.dataset.filter || 'all';
        loadItems(activeFilter);
    }
}

/**
 * OPEN SHARED ITEM: Renders content and Mermaid diagrams
 */
window.openWorkspaceItem = async (itemId) => {
    try {
        const { data, error } = await supabaseClient
            .from('workspace_items')
            .select('*')
            .eq('id', itemId)
            .single();

        if (error || !data) throw error;
        document.getElementById('workspace-modal').classList.remove('active');

        // ROUTE 1: KRATABOOKS
        if (data.type === 'kratabook') {
            const contentArea = document.getElementById('kratabook-content-area');
            contentArea.innerHTML = `<div class="text-xs text-gray-400 mb-4 border-b pb-2">Shared Workspace Report • Pinned by ${data.author_name}</div>` + marked.parse(data.payload.content);
            document.getElementById('kratabook-title-display').innerText = data.title;
            
            const headerActions = document.getElementById('kb-header-actions');
            if (headerActions) headerActions.innerHTML = '';

            document.getElementById('kratabook-view').classList.remove('view-hidden');
            if (window.lucide) lucide.createIcons();
        } 
        
        // ROUTE 2: CHATS & CHARTS
        else if (data.type === 'chat' || data.type === 'chart') {
            const rawMarkdown = data.payload.content 
                ? data.payload.content 
                : `\n\`\`\`mermaid\n${data.payload.code}\n\`\`\`\n`;

            const parsedHtml = marked.parse(rawMarkdown);
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message bot-message';
            msgDiv.innerHTML = `
                <div class="bot-avatar"><img src="assets/logo.png" alt="Krata AI"></div>
                <div class="bubble w-full">
                    <div class="workspace-export-header flex items-center gap-2 mb-4 p-2.5 bg-blue-50 border border-blue-100 rounded-lg text-blue-700 text-xs font-bold w-fit">
                        <i data-lucide="layout-dashboard" class="w-4 h-4"></i>
                        Shared from Workspace: ${data.title}
                    </div>
                    <div class="response-text">${parsedHtml}</div>
                </div>
            `;
            
            document.getElementById('messages').appendChild(msgDiv);
            
            // Trigger Mermaid renderer safely
            requestAnimationFrame(() => {
                if (window.processMermaidCharts) {
                    window.processMermaidCharts(msgDiv).then(() => {
                        const scrollArea = document.getElementById('chat-history-container');
                        if (scrollArea) scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
                    });
                }
            });
            
            if (window.lucide) lucide.createIcons();
        }
    } catch (err) {
        console.error("Failed to open item:", err);
    }
};

window.removeItemFromWorkspace = removeItemFromWorkspace;
window.refreshWorkspace = loadItems;
