// js/ui/input-bar.js

export function initMenus() {
    const menus = {
        'btn-database': 'menu-database',
        'btn-tools': 'menu-tools',
        'btn-plus-menu': 'menu-plus',
        'btn-settings-sidebar': 'settings-dropdown',
        'btn-data-selector': 'data-dropdown',
        'btn-top-options': 'menu-top-options',
        'user-avatar-circle': 'menu-user-profile'
    };

    // 1. Global Click-Away (Closes menus when clicking outside)
    document.addEventListener('click', (e) => {
        Object.entries(menus).forEach(([btnId, menuId]) => {
            const menu = document.getElementById(menuId);
            const btn = document.getElementById(btnId);
            
            // Only process if the menu actually exists and is currently open
            if (menu && !menu.classList.contains('hidden')) {
                // 🚀 FIX: Use .contains() to handle clicks on inner SVG icons properly
                const clickedInsideMenu = menu.contains(e.target);
                const clickedOnButton = btn && btn.contains(e.target);

                if (!clickedInsideMenu && !clickedOnButton) {
                    menu.classList.add('hidden');
                }
            }
        });
    });

    // 2. Toggle Menus (Handles button clicks)
    Object.entries(menus).forEach(([btnId, menuId]) => {
        const btn = document.getElementById(btnId);
        const targetMenu = document.getElementById(menuId);
        
        if (btn && targetMenu) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent the global click-away from firing immediately
                
                const isCurrentlyHidden = targetMenu.classList.contains('hidden');
                
                // Close ALL menus first for a clean state
                Object.values(menus).forEach(mId => { 
                    const m = document.getElementById(mId);
                    if (m) m.classList.add('hidden'); 
                });
                
                // If it was hidden, open it (otherwise it stays closed)
                if (isCurrentlyHidden) {
                    targetMenu.classList.remove('hidden');
                }
            });
        }
    });

    // 3. Dispatch Custom Events for Tool Selections
    const toolMap = {
        'menu-viz': 'open-viz',
        'menu-pivot': 'open-pivot',
        'menu-pareto': 'trigger-auto-pareto',
        'menu-narrator': 'trigger-narrator',
        'menu-quality': 'open-quality',
        'menu-privacy': 'open-privacy'
    };

    Object.entries(toolMap).forEach(([elementId, eventName]) => {
        const el = document.getElementById(elementId);
        if (el) {
            el.addEventListener('click', () => {
                // Dispatch the event to be caught by main.js
                window.dispatchEvent(new CustomEvent(eventName));
                
                // Auto-close the tools menu after selection
                const toolsMenu = document.getElementById('menu-tools');
                if (toolsMenu) toolsMenu.classList.add('hidden');
            });
        }
    });
}
